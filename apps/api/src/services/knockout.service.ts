import {
  KnockoutGenerationMode,
  KnockoutGenerationStatus,
  MatchStatus,
  Prisma,
  ScoreType,
} from '@prisma/client';
import type { UpsertKnockoutBracketInput, UpsertKnockoutSimulationInput } from '@bolao/shared';
import { knockoutFixtureSeeds, firstKnockoutStartsAt } from '../data/knockout-fixtures.js';
import { AppError } from '../http/errors.js';
import { prisma } from '../prisma.js';
import { emitSse } from '../realtime/sse.js';
import {
  buildPartialRoundOf32Participants,
  buildRoundOf32Participants,
  groupProjectionIsResolved,
  materializeBracket,
  projectGroupStandings,
  type GroupQualification,
  type ProjectionMatch,
  type ProjectionTeam,
} from './prediction-board.logic.js';
import { matchPredictionState } from './prediction.service.js';
import { getPredictionCloseMinutes, predictionCloseAt } from './prediction-settings.service.js';
import { refreshRankingSnapshot } from './ranking.service.js';
import { WORLD_CUP_CONTEXT } from '../domain/world-cup-context.js';
import {
  resolvePoolSeasonRules,
  scoreCalculationKey,
  stableHash,
} from '../modules/scoring/scoring-rules.service.js';
import { recomputePoolSeasonEngagement } from '../modules/engagement/engagement.service.js';
import { serializableTransaction } from '../prisma-transaction.js';
import { observeLegacyKnockoutTieShadows } from '../modules/ties/legacy-knockout-tie.adapter.js';

const PROVISIONAL_KNOCKOUT_CLOSES_AT = new Date('2026-06-19T02:59:59.000Z');

type GroupScoreOverride = NonNullable<UpsertKnockoutBracketInput['groupScores']>[number];

type EditableGeneration = {
  id: string;
  status: KnockoutGenerationStatus;
  closesAt: Date | null;
};

function normalizeGroupScoreOverrides(scores: readonly GroupScoreOverride[] = []) {
  const byMatchId = new Map<string, GroupScoreOverride>();
  for (const score of scores) {
    byMatchId.set(score.matchId, {
      matchId: score.matchId,
      predictedHomeScore: score.predictedHomeScore,
      predictedAwayScore: score.predictedAwayScore,
    });
  }
  return [...byMatchId.values()];
}

function mergeGroupScoreOverrides(
  savedScores: readonly GroupScoreOverride[],
  scoreOverrides?: readonly GroupScoreOverride[],
) {
  if (!scoreOverrides) return normalizeGroupScoreOverrides(savedScores);
  return normalizeGroupScoreOverrides([...savedScores, ...scoreOverrides]);
}

function generationIsOpen(generation: EditableGeneration, now = new Date()) {
  return (
    generation.status === KnockoutGenerationStatus.ACTIVE &&
    (!generation.closesAt || generation.closesAt > now)
  );
}

function assertGenerationIsOpen(generation: EditableGeneration) {
  if (!generationIsOpen(generation)) {
    throw new AppError(
      409,
      'O prazo para salvar a chave foi encerrado.',
      'KNOCKOUT_BRACKET_CLOSED',
    );
  }
}

function pickInputChanged(
  current: {
    homeTeamId: string;
    awayTeamId: string;
    advancingTeamId: string;
    predictedHomeScore: number;
    predictedAwayScore: number;
  },
  next: {
    homeTeamId?: string;
    awayTeamId?: string;
    advancingTeamId: string;
    predictedHomeScore: number;
    predictedAwayScore: number;
  },
) {
  return (
    (next.homeTeamId != null && current.homeTeamId !== next.homeTeamId) ||
    (next.awayTeamId != null && current.awayTeamId !== next.awayTeamId) ||
    current.advancingTeamId !== next.advancingTeamId ||
    current.predictedHomeScore !== next.predictedHomeScore ||
    current.predictedAwayScore !== next.predictedAwayScore
  );
}

function fixtureIsEditableForPrediction(
  fixture: { startsAt: Date; status: MatchStatus },
  now = new Date(),
) {
  return fixture.status === MatchStatus.SCHEDULED && fixture.startsAt > now;
}

function actualKnockoutWinnerId(fixture: {
  homeTeamId: string | null;
  awayTeamId: string | null;
  winnerTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
}) {
  if (fixture.winnerTeamId) return fixture.winnerTeamId;
  const homeScore = fixture.finalHomeScore ?? fixture.homeScore;
  const awayScore = fixture.finalAwayScore ?? fixture.awayScore;
  if (
    !fixture.homeTeamId ||
    !fixture.awayTeamId ||
    homeScore == null ||
    awayScore == null ||
    homeScore === awayScore
  ) {
    return null;
  }
  return homeScore > awayScore ? fixture.homeTeamId : fixture.awayTeamId;
}

async function assertCanSaveKnockout(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });
  if (!user || user.status !== 'ACTIVE') {
    throw new AppError(403, 'Usuario sem permissao para salvar a chave.', 'USER_NOT_ALLOWED');
  }
}

function jsonString(value: Prisma.JsonValue | null | undefined, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = (value as Record<string, unknown>)[key];
  return typeof result === 'string' && result.trim() ? result : null;
}

function groupForTeam(team: { metadata: Prisma.JsonValue | null }) {
  return jsonString(team.metadata, 'group') ?? 'Sem grupo';
}

function firstKnockoutClosesAt(closeMinutes: number) {
  return predictionCloseAt(firstKnockoutStartsAt, closeMinutes);
}

function generationClosesAt(mode: KnockoutGenerationMode, closeMinutes: number) {
  return mode === KnockoutGenerationMode.PROVISIONAL
    ? PROVISIONAL_KNOCKOUT_CLOSES_AT
    : firstKnockoutClosesAt(closeMinutes);
}

function generationStatusFor(closesAt: Date, now = new Date()) {
  return closesAt > now ? KnockoutGenerationStatus.ACTIVE : KnockoutGenerationStatus.LOCKED;
}

export async function ensureKnockoutInfrastructure() {
  const predictionCloseMinutes = await getPredictionCloseMinutes();
  for (const fixture of knockoutFixtureSeeds) {
    await prisma.knockoutFixture.upsert({
      where: { matchNumber: fixture.matchNumber },
      update: {
        seasonId: WORLD_CUP_CONTEXT.seasonId,
        stage: fixture.stage,
        startsAt: new Date(fixture.startsAt),
        homeSource: fixture.homeSource,
        awaySource: fixture.awaySource,
      },
      create: {
        seasonId: WORLD_CUP_CONTEXT.seasonId,
        matchNumber: fixture.matchNumber,
        stage: fixture.stage,
        startsAt: new Date(fixture.startsAt),
        homeSource: fixture.homeSource,
        awaySource: fixture.awaySource,
      },
    });
  }

  const groupMatches = await prisma.match.findMany({ select: { status: true } });
  const groupStageComplete =
    groupMatches.length >= 72 &&
    groupMatches.every((match) => match.status === MatchStatus.FINISHED);
  let active = await prisma.knockoutGeneration.findFirst({
    where: { status: { not: KnockoutGenerationStatus.RESET } },
    orderBy: { sequence: 'desc' },
  });

  if (!active) {
    const latest = await prisma.knockoutGeneration.findFirst({ orderBy: { sequence: 'desc' } });
    const mode = groupStageComplete
      ? KnockoutGenerationMode.OFFICIAL
      : KnockoutGenerationMode.PROVISIONAL;
    const closesAt = generationClosesAt(mode, predictionCloseMinutes);
    active = await prisma.knockoutGeneration.create({
      data: {
        seasonId: WORLD_CUP_CONTEXT.seasonId,
        sequence: (latest?.sequence ?? 0) + 1,
        mode,
        closesAt,
        status: generationStatusFor(closesAt),
      },
    });
  }

  const closesAt = generationClosesAt(active.mode, predictionCloseMinutes);
  const status = generationStatusFor(closesAt);
  if (
    active.seasonId !== WORLD_CUP_CONTEXT.seasonId ||
    active.closesAt?.getTime() !== closesAt.getTime() ||
    active.status !== status
  ) {
    active = await prisma.knockoutGeneration.update({
      where: { id: active.id },
      data: { seasonId: WORLD_CUP_CONTEXT.seasonId, closesAt, status },
    });
  }

  if (groupStageComplete || active.mode === KnockoutGenerationMode.OFFICIAL) {
    await syncOfficialKnockoutParticipants();
  }

  return { generation: active, groupStageComplete, predictionCloseMinutes };
}

async function loadProjectionGroups(
  userId: string | null,
  scoreOverrides: GroupScoreOverride[] = [],
) {
  const [teams, matches] = await Promise.all([
    prisma.team.findMany({ orderBy: { name: 'asc' } }),
    prisma.match.findMany({
      orderBy: { startsAt: 'asc' },
      include: {
        matchDay: true,
        homeTeam: true,
        awayTeam: true,
        predictions: {
          where: userId ? { userId } : { id: '__none__' },
        },
      },
    }),
  ]);

  const projectionTeams = new Map<string, ProjectionTeam>(
    teams.map((team) => [
      team.id,
      {
        id: team.id,
        name: team.name,
        code: team.code,
        fifaRank: team.fifaRank,
        flagUrl: team.flagUrl,
        metadata: team.metadata,
      },
    ]),
  );
  const scoreOverrideByMatchId = new Map(scoreOverrides.map((score) => [score.matchId, score]));
  const groups = new Map<string, { teams: ProjectionTeam[]; matches: ProjectionMatch[] }>();

  for (const team of teams) {
    const group = groupForTeam(team);
    if (group === 'Sem grupo') continue;
    const current = groups.get(group) ?? { teams: [], matches: [] };
    current.teams.push(projectionTeams.get(team.id)!);
    groups.set(group, current);
  }

  for (const match of matches) {
    const group = jsonString(match.rawPayload, 'group') ?? groupForTeam(match.homeTeam);
    if (group === 'Sem grupo') continue;
    const current = groups.get(group) ?? { teams: [], matches: [] };
    const prediction = match.predictions[0];
    const scoreOverride = scoreOverrideByMatchId.get(match.id);
    current.matches.push({
      id: match.id,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      status: match.status,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      finalHomeScore: match.finalHomeScore,
      finalAwayScore: match.finalAwayScore,
      predictedHomeScore:
        scoreOverride?.predictedHomeScore ?? prediction?.predictedHomeScore ?? null,
      predictedAwayScore:
        scoreOverride?.predictedAwayScore ?? prediction?.predictedAwayScore ?? null,
    });
    groups.set(group, current);
  }

  const qualifications: GroupQualification[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, value]) => ({
      group,
      rows: projectGroupStandings(value.teams, value.matches),
      isResolved: groupProjectionIsResolved(value.matches),
    }));

  return { teams, matches, qualifications };
}

async function loadSavedGroupSimulationScores(userId: string, generationId: string) {
  const scores = await prisma.knockoutGroupSimulationScore.findMany({
    where: { userId, generationId },
    select: {
      matchId: true,
      predictedHomeScore: true,
      predictedAwayScore: true,
    },
  });
  return normalizeGroupScoreOverrides(scores);
}

async function replaceSavedGroupSimulationScores(
  userId: string,
  generationId: string,
  scoreOverrides: readonly GroupScoreOverride[] = [],
) {
  const scores = normalizeGroupScoreOverrides(scoreOverrides);
  const matchIds = scores.map((score) => score.matchId);

  return prisma.$transaction(async (tx) => {
    const [user, generation] = await Promise.all([
      tx.user.findUnique({
        where: { id: userId },
        select: { status: true },
      }),
      tx.knockoutGeneration.findUnique({
        where: { id: generationId },
        select: { id: true, status: true, closesAt: true },
      }),
    ]);
    if (!user || user.status !== 'ACTIVE') {
      throw new AppError(403, 'Usuário sem permissão para salvar a chave.', 'USER_NOT_ALLOWED');
    }
    if (!generation) {
      throw new AppError(404, 'Geração da chave não encontrada.', 'KNOCKOUT_GENERATION_NOT_FOUND');
    }
    assertGenerationIsOpen(generation);

    if (matchIds.length) {
      const validMatches = await tx.match.findMany({
        where: { id: { in: matchIds } },
        select: { id: true },
      });
      if (validMatches.length !== matchIds.length) {
        throw new AppError(
          400,
          'A simulacao contem partidas invalidas.',
          'INVALID_GROUP_SIMULATION',
        );
      }
    }

    await tx.knockoutGroupSimulationScore.deleteMany({
      where: {
        userId,
        generationId,
        ...(matchIds.length ? { matchId: { notIn: matchIds } } : {}),
      },
    });

    for (const score of scores) {
      await tx.knockoutGroupSimulationScore.upsert({
        where: {
          userId_generationId_matchId: {
            userId,
            generationId,
            matchId: score.matchId,
          },
        },
        update: {
          poolSeasonId: WORLD_CUP_CONTEXT.poolSeasonId,
          predictedHomeScore: score.predictedHomeScore,
          predictedAwayScore: score.predictedAwayScore,
        },
        create: {
          userId,
          generationId,
          matchId: score.matchId,
          poolSeasonId: WORLD_CUP_CONTEXT.poolSeasonId,
          predictedHomeScore: score.predictedHomeScore,
          predictedAwayScore: score.predictedAwayScore,
        },
      });
    }

    return scores;
  });
}

async function roundOf32ForGeneration(
  mode: KnockoutGenerationMode,
  userId: string,
  scoreOverrides: GroupScoreOverride[] = [],
) {
  const projection = await loadProjectionGroups(
    mode === KnockoutGenerationMode.PROVISIONAL ? userId : null,
    mode === KnockoutGenerationMode.PROVISIONAL ? scoreOverrides : [],
  );
  const participants = buildRoundOf32Participants(projection.qualifications);
  if (!participants) {
    throw new AppError(
      409,
      'Ainda não há dados suficientes para gerar os classificados da fase de grupos.',
      'QUALIFIERS_NOT_READY',
    );
  }
  return { ...projection, participants };
}

function sourceTeamId(
  source: string,
  fixtures: Map<
    number,
    { homeTeamId: string | null; awayTeamId: string | null; winnerTeamId: string | null }
  >,
) {
  const sourceFixture = fixtures.get(Number(source.slice(1)));
  if (!sourceFixture?.homeTeamId || !sourceFixture.awayTeamId || !sourceFixture.winnerTeamId)
    return null;
  if (source.startsWith('W')) return sourceFixture.winnerTeamId;
  return sourceFixture.winnerTeamId === sourceFixture.homeTeamId
    ? sourceFixture.awayTeamId
    : sourceFixture.homeTeamId;
}

export async function syncOfficialKnockoutParticipants() {
  const projection = await loadProjectionGroups(null);
  const roundOf32 = buildRoundOf32Participants(projection.qualifications);
  if (!roundOf32) return;

  const fixtures = await prisma.knockoutFixture.findMany({ orderBy: { matchNumber: 'asc' } });
  const byNumber = new Map(fixtures.map((fixture) => [fixture.matchNumber, fixture]));
  const changedFixtureIds: string[] = [];
  for (const fixture of fixtures) {
    const seeded = roundOf32.get(fixture.matchNumber);
    const homeTeamId = seeded?.homeTeamId ?? sourceTeamId(fixture.homeSource, byNumber);
    const awayTeamId = seeded?.awayTeamId ?? sourceTeamId(fixture.awaySource, byNumber);
    if (homeTeamId === fixture.homeTeamId && awayTeamId === fixture.awayTeamId) continue;
    const updated = await prisma.knockoutFixture.update({
      where: { id: fixture.id },
      data: { homeTeamId, awayTeamId },
    });
    changedFixtureIds.push(updated.id);
    byNumber.set(updated.matchNumber, updated);
  }

  if (changedFixtureIds.length) {
    for (const fixtureId of changedFixtureIds) {
      await recalculateKnockoutScoresForFixture(fixtureId, { refreshRanking: false });
    }
    await refreshRankingSnapshot();
  }
}

export async function getPredictionBoard(userId: string, scoreOverrides?: GroupScoreOverride[]) {
  const { generation, groupStageComplete, predictionCloseMinutes } =
    await ensureKnockoutInfrastructure();
  const [savedSimulationScores, publicMatches, viewer] = await Promise.all([
    loadSavedGroupSimulationScores(userId, generation.id),
    prisma.match.findMany({
      orderBy: { startsAt: 'asc' },
      include: {
        matchDay: true,
        homeTeam: true,
        awayTeam: true,
        predictions: {
          where: { user: { role: { in: ['USER', 'ADMIN'] }, status: 'ACTIVE' } },
          include: { user: { select: { id: true, nickname: true, avatarUrl: true } } },
          orderBy: { user: { nickname: 'asc' } },
        },
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { status: true } }),
  ]);
  const groupScoreOverrides = mergeGroupScoreOverrides(savedSimulationScores, scoreOverrides);
  const projection = await loadProjectionGroups(userId, groupScoreOverrides);
  const now = new Date();
  const simulationScoreByMatchId = new Map(
    groupScoreOverrides.map((score) => [score.matchId, score]),
  );
  const qualificationByGroup = new Map(
    projection.qualifications.map((qualification) => [qualification.group, qualification]),
  );
  const groupedMatches = new Map<string, typeof publicMatches>();
  for (const match of publicMatches) {
    const group = jsonString(match.rawPayload, 'group') ?? groupForTeam(match.homeTeam);
    const list = groupedMatches.get(group) ?? [];
    list.push(match);
    groupedMatches.set(group, list);
  }

  const groups = [...groupedMatches.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, matches]) => ({
      group,
      standings: qualificationByGroup.get(group)?.rows ?? [],
      matches: matches.map((match) => {
        const predictionState = matchPredictionState(match.startsAt, now, predictionCloseMinutes);
        const ownPrediction =
          match.predictions.find((prediction) => prediction.userId === userId) ?? null;
        return {
          id: match.id,
          matchDayId: match.matchDayId,
          startsAt: match.startsAt,
          status: match.status,
          ...predictionState,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          finalHomeScore: match.finalHomeScore,
          finalAwayScore: match.finalAwayScore,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          round: jsonString(match.rawPayload, 'round'),
          ownPrediction,
          simulationScore: simulationScoreByMatchId.get(match.id) ?? null,
          publicPredictions: predictionState.predictionsArePublic ? match.predictions : [],
        };
      }),
    }));

  const roundOf32 = buildPartialRoundOf32Participants(projection.qualifications);
  const resolvedGroups = projection.qualifications
    .filter((qualification) => qualification.isResolved)
    .map((qualification) => qualification.group);
  const [fixtures, savedBracket] = await Promise.all([
    prisma.knockoutFixture.findMany({
      orderBy: { matchNumber: 'asc' },
      include: { homeTeam: true, awayTeam: true, winnerTeam: true },
    }),
    prisma.knockoutBracket.findUnique({
      where: { userId_generationId: { userId, generationId: generation.id } },
      include: {
        picks: { orderBy: { fixture: { matchNumber: 'asc' } }, include: { fixture: true } },
      },
    }),
  ]);
  const effectiveFixtures = await observeLegacyKnockoutTieShadows(fixtures);

  return {
    checkedAt: now.toISOString(),
    predictionCloseMinutes,
    canPredict: viewer?.status === 'ACTIVE',
    groupStageComplete,
    groups,
    knockout: {
      generation: {
        id: generation.id,
        sequence: generation.sequence,
        mode: generation.mode,
        status: generation.status,
        closesAt: generation.closesAt,
        isOpen: generationIsOpen(generation, now),
      },
      fixtures: effectiveFixtures,
      roundOf32: roundOf32
        ? [...roundOf32.entries()].map(([matchNumber, participants]) => ({
            matchNumber,
            ...participants,
          }))
        : [],
      resolvedGroups,
      savedBracket: savedBracket
        ? {
            submittedAt: savedBracket.submittedAt,
            picks: savedBracket.picks.map((pick) => ({
              matchNumber: pick.fixture.matchNumber,
              homeTeamId: pick.homeTeamId,
              awayTeamId: pick.awayTeamId,
              advancingTeamId: pick.advancingTeamId,
              predictedHomeScore: pick.predictedHomeScore,
              predictedAwayScore: pick.predictedAwayScore,
            })),
          }
        : null,
    },
  };
}

export async function saveGroupSimulationScores(
  userId: string,
  input: UpsertKnockoutSimulationInput,
) {
  await assertCanSaveKnockout(userId);
  const { generation } = await ensureKnockoutInfrastructure();
  assertGenerationIsOpen(generation);
  const groupScores = await replaceSavedGroupSimulationScores(
    userId,
    generation.id,
    input.groupScores,
  );
  return getPredictionBoard(userId, groupScores);
}

export async function saveKnockoutBracket(userId: string, input: UpsertKnockoutBracketInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });
  if (!user || user.status !== 'ACTIVE') {
    throw new AppError(403, 'Usuário sem permissão para salvar a chave.', 'USER_NOT_ALLOWED');
  }

  const { generation } = await ensureKnockoutInfrastructure();

  const groupScores = input.groupScores
    ? await replaceSavedGroupSimulationScores(userId, generation.id, input.groupScores)
    : await loadSavedGroupSimulationScores(userId, generation.id);
  const fixtures = await prisma.knockoutFixture.findMany({
    select: {
      id: true,
      matchNumber: true,
      startsAt: true,
      status: true,
      homeTeamId: true,
      awayTeamId: true,
      winnerTeamId: true,
      homeScore: true,
      awayScore: true,
      finalHomeScore: true,
      finalAwayScore: true,
    },
  });
  const existingBracket = await prisma.knockoutBracket.findUnique({
    where: { userId_generationId: { userId, generationId: generation.id } },
    include: { picks: { include: { fixture: true } } },
  });
  const editableMatchNumbers = new Set(
    fixtures
      .filter((fixture) => fixtureIsEditableForPrediction(fixture))
      .map((fixture) => fixture.matchNumber),
  );
  if (editableMatchNumbers.size === 0) {
    throw new AppError(
      409,
      'Nao ha jogos futuros abertos para edicao na chave.',
      'KNOCKOUT_BRACKET_CLOSED',
    );
  }

  const existingByMatch = new Map(
    (existingBracket?.picks ?? []).map((pick) => [pick.fixture.matchNumber, pick]),
  );
  const mergedByMatch = new Map<number, UpsertKnockoutBracketInput['picks'][number]>();
  let editablePickCount = 0;

  for (const pick of input.picks) {
    const fixture = fixtures.find((item) => item.matchNumber === pick.matchNumber);
    if (!fixture) {
      throw new AppError(400, `Jogo ${pick.matchNumber} inválido.`, 'INVALID_KNOCKOUT_BRACKET');
    }

    const existing = existingByMatch.get(pick.matchNumber);
    if (!editableMatchNumbers.has(pick.matchNumber)) {
      if (
        !existing ||
        pickInputChanged(existing, {
          advancingTeamId: pick.advancingTeamId,
          predictedHomeScore: pick.predictedHomeScore,
          predictedAwayScore: pick.predictedAwayScore,
        })
      ) {
        throw new AppError(
          409,
          `O jogo ${pick.matchNumber} já iniciou ou foi encerrado e não pode mais ser editado.`,
          'KNOCKOUT_FIXTURE_LOCKED',
        );
      }
      continue;
    }

    editablePickCount += 1;
    mergedByMatch.set(pick.matchNumber, pick);
  }

  if (editablePickCount === 0) {
    throw new AppError(
      400,
      'Preencha pelo menos um jogo futuro para salvar a chave.',
      'EMPTY_KNOCKOUT_BRACKET',
    );
  }

  const sanitizedPicks = [...mergedByMatch.values()];
  const requestedMatchNumbers = new Set(sanitizedPicks.map((pick) => pick.matchNumber));
  const { participants } = await roundOf32ForGeneration(generation.mode, userId, groupScores);
  const fixedParticipants = new Map(participants);
  for (const fixture of fixtures) {
    if (fixture.homeTeamId && fixture.awayTeamId) {
      fixedParticipants.set(fixture.matchNumber, {
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
      });
    }
  }
  const contextInputsByMatch = new Map<number, UpsertKnockoutBracketInput['picks'][number]>();
  for (const fixture of fixtures) {
    const winnerTeamId = actualKnockoutWinnerId(fixture);
    const homeScore = fixture.finalHomeScore ?? fixture.homeScore;
    const awayScore = fixture.finalAwayScore ?? fixture.awayScore;
    if (
      fixture.status === MatchStatus.FINISHED &&
      fixture.homeTeamId &&
      fixture.awayTeamId &&
      winnerTeamId &&
      homeScore != null &&
      awayScore != null
    ) {
      contextInputsByMatch.set(fixture.matchNumber, {
        matchNumber: fixture.matchNumber,
        predictedHomeScore: homeScore,
        predictedAwayScore: awayScore,
        advancingTeamId: winnerTeamId,
      });
    }
  }
  for (const pick of existingBracket?.picks ?? []) {
    const matchNumber = pick.fixture.matchNumber;
    if (contextInputsByMatch.has(matchNumber) || requestedMatchNumbers.has(matchNumber)) continue;
    const fixture = fixtures.find((item) => item.matchNumber === matchNumber);
    if (!fixture || !editableMatchNumbers.has(matchNumber)) continue;
    const fixed = fixedParticipants.get(matchNumber);
    if (!fixed?.homeTeamId || !fixed.awayTeamId) continue;
    const advancingTeamId =
      pick.predictedHomeScore === pick.predictedAwayScore
        ? pick.advancingTeamId
        : pick.predictedHomeScore > pick.predictedAwayScore
          ? fixed.homeTeamId
          : fixed.awayTeamId;
    if (![fixed.homeTeamId, fixed.awayTeamId].includes(advancingTeamId)) continue;
    contextInputsByMatch.set(matchNumber, {
      matchNumber,
      predictedHomeScore: pick.predictedHomeScore,
      predictedAwayScore: pick.predictedAwayScore,
      advancingTeamId,
    });
  }
  for (const pick of sanitizedPicks) {
    contextInputsByMatch.set(pick.matchNumber, pick);
  }

  let materialized;
  try {
    materialized = materializeBracket(
      [...contextInputsByMatch.values()],
      fixedParticipants,
      undefined,
      {
        allowPartial: true,
      },
    );
  } catch (error) {
    throw new AppError(
      400,
      error instanceof Error ? error.message : 'Chave eliminatória inválida.',
      'INVALID_KNOCKOUT_BRACKET',
    );
  }

  const fixtureIdByNumber = new Map(fixtures.map((fixture) => [fixture.matchNumber, fixture.id]));
  const editableMaterialized = materialized.filter((pick) =>
    requestedMatchNumbers.has(pick.matchNumber),
  );
  const bracket = await prisma.$transaction(async (tx) => {
    const transactionNow = new Date();
    const [currentGeneration, currentFixtures] = await Promise.all([
      tx.knockoutGeneration.findUnique({
        where: { id: generation.id },
        select: { id: true, status: true, closesAt: true },
      }),
      tx.knockoutFixture.findMany({
        where: { matchNumber: { in: [...requestedMatchNumbers] } },
        select: { matchNumber: true, startsAt: true, status: true },
      }),
    ]);
    if (!currentGeneration || !generationIsOpen(currentGeneration, transactionNow)) {
      throw new AppError(
        409,
        'O prazo para salvar a chave foi encerrado.',
        'KNOCKOUT_BRACKET_CLOSED',
      );
    }
    const currentByNumber = new Map(
      currentFixtures.map((fixture) => [fixture.matchNumber, fixture]),
    );
    for (const matchNumber of requestedMatchNumbers) {
      const fixture = currentByNumber.get(matchNumber);
      if (!fixture || !fixtureIsEditableForPrediction(fixture, transactionNow)) {
        throw new AppError(
          409,
          `O jogo ${matchNumber} já iniciou ou foi encerrado e não pode mais ser editado.`,
          'KNOCKOUT_FIXTURE_LOCKED',
        );
      }
    }

    const saved = await tx.knockoutBracket.upsert({
      where: { userId_generationId: { userId, generationId: generation.id } },
      update: {
        poolSeasonId: WORLD_CUP_CONTEXT.poolSeasonId,
        submittedAt: new Date(),
      },
      create: {
        userId,
        generationId: generation.id,
        poolSeasonId: WORLD_CUP_CONTEXT.poolSeasonId,
      },
    });
    for (const pick of editableMaterialized) {
      const fixtureId = fixtureIdByNumber.get(pick.matchNumber)!;
      await tx.knockoutPick.upsert({
        where: { bracketId_fixtureId: { bracketId: saved.id, fixtureId } },
        update: {
          poolSeasonId: WORLD_CUP_CONTEXT.poolSeasonId,
          homeTeamId: pick.homeTeamId,
          awayTeamId: pick.awayTeamId,
          advancingTeamId: pick.advancingTeamId,
          predictedHomeScore: pick.predictedHomeScore,
          predictedAwayScore: pick.predictedAwayScore,
        },
        create: {
          bracketId: saved.id,
          fixtureId,
          poolSeasonId: WORLD_CUP_CONTEXT.poolSeasonId,
          homeTeamId: pick.homeTeamId,
          awayTeamId: pick.awayTeamId,
          advancingTeamId: pick.advancingTeamId,
          predictedHomeScore: pick.predictedHomeScore,
          predictedAwayScore: pick.predictedAwayScore,
        },
      });
    }
    return saved;
  });

  emitSse('knockout.updated', {
    userId,
    generationId: generation.id,
    submittedAt: bracket.submittedAt.toISOString(),
  });
  await recomputePoolSeasonEngagement(WORLD_CUP_CONTEXT.poolSeasonId);
  return getPredictionBoard(userId, groupScores);
}

export async function listPublicKnockoutBrackets() {
  const { generation } = await ensureKnockoutInfrastructure();
  if (generation.status === KnockoutGenerationStatus.ACTIVE) {
    throw new AppError(
      403,
      'As chaves oficiais serão publicadas após o encerramento do prazo.',
      'KNOCKOUT_BRACKETS_PRIVATE',
    );
  }

  const brackets = await prisma.knockoutBracket.findMany({
    where: {
      generationId: generation.id,
      user: { role: { in: ['USER', 'ADMIN'] }, status: 'ACTIVE' },
    },
    orderBy: { user: { nickname: 'asc' } },
    include: {
      user: { select: { id: true, nickname: true, avatarUrl: true } },
      picks: {
        orderBy: { fixture: { matchNumber: 'asc' } },
        include: { fixture: true, homeTeam: true, awayTeam: true, advancingTeam: true },
      },
    },
  });
  return { generation, brackets };
}

export async function recalculateKnockoutScoresForFixture(
  fixtureId: string,
  options: { refreshRanking?: boolean } = {},
) {
  const contexts = await serializableTransaction(async (tx) => {
    const fixture = await tx.knockoutFixture.findUnique({
      where: { id: fixtureId },
      include: {
        picks: {
          where: { bracket: { generation: { status: { not: KnockoutGenerationStatus.RESET } } } },
          orderBy: { id: 'asc' },
          include: {
            bracket: true,
            score: true,
            poolSeason: { select: { id: true, poolId: true, seasonId: true } },
          },
        },
      },
    });
    if (!fixture) return [];
    const byPool = new Map<string, { poolSeasonId: string; poolId: string; seasonId: string }>();
    const sourceRevision = fixture.updatedAt.toISOString();
    const available =
      fixture.status === MatchStatus.FINISHED && Boolean(fixture.homeTeamId && fixture.awayTeamId);
    const winnerTeamId = available ? actualKnockoutWinnerId(fixture) : null;
    const actualTeamIds = new Set(
      [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean) as string[],
    );

    for (const pick of fixture.picks) {
      const poolSeasonId = pick.poolSeasonId ?? WORLD_CUP_CONTEXT.poolSeasonId;
      const context = pick.poolSeason
        ? { poolSeasonId, poolId: pick.poolSeason.poolId, seasonId: pick.poolSeason.seasonId }
        : WORLD_CUP_CONTEXT;
      byPool.set(poolSeasonId, context);
      const ruleSet = (await resolvePoolSeasonRules(poolSeasonId, tx)).scoring;
      const beforeScore = pick.score
        ? ({
            points: pick.score.points,
            scoreType: pick.score.scoreType,
            isFinal: pick.score.isFinal,
            scoringRuleSetVersionId: pick.score.scoringRuleSetVersionId,
            scoringVersion: pick.score.scoringVersion,
            breakdown: pick.score.breakdown,
            calculationKey: pick.score.calculationKey,
            resultRevision: pick.score.resultRevision,
            calculatedAt: pick.score.calculatedAt.toISOString(),
          } as Prisma.InputJsonValue)
        : Prisma.JsonNull;
      if (!available) {
        if (pick.score) {
          const auditKey = stableHash({
            targetId: pick.id,
            sourceRevision,
            before: pick.score.calculationKey,
            after: null,
          });
          await tx.scoreRecomputationAudit.createMany({
            data: [
              {
                poolSeasonId,
                userId: pick.bracket.userId,
                targetType: 'KNOCKOUT_PICK',
                targetId: pick.id,
                sourceRevision,
                scoringRuleSetVersionId: ruleSet.id,
                before: beforeScore,
                after: Prisma.JsonNull,
                reason: 'RESULT_UNAVAILABLE',
                idempotencyKey: auditKey,
              },
            ],
            skipDuplicates: true,
          });
          await tx.knockoutPredictionScore.delete({ where: { pickId: pick.id } });
        }
        continue;
      }
      const winnerHit = Boolean(winnerTeamId && pick.advancingTeamId === winnerTeamId);
      const matchedTeamCount = [pick.homeTeamId, pick.awayTeamId].filter((teamId) =>
        actualTeamIds.has(teamId),
      ).length;
      const score = winnerHit
        ? { points: 15, scoreType: 'RESULT' as const, criterion: 'ADVANCING_TEAM' }
        : matchedTeamCount > 0
          ? { points: 7, scoreType: 'ONE_TEAM_GOALS' as const, criterion: 'PARTICIPATING_TEAM' }
          : { points: 0, scoreType: 'MISS' as const, criterion: 'MISS' };
      const calculationKey = scoreCalculationKey({
        targetId: pick.id,
        resultRevision: sourceRevision,
        scoringRuleSetVersionId: ruleSet.id,
        actualHomeScore: fixture.finalHomeScore ?? 0,
        actualAwayScore: fixture.finalAwayScore ?? 0,
        isFinal: true,
        resultIdentity: {
          homeTeamId: fixture.homeTeamId,
          awayTeamId: fixture.awayTeamId,
          winnerTeamId,
        },
        predictionIdentity: {
          homeTeamId: pick.homeTeamId,
          awayTeamId: pick.awayTeamId,
          advancingTeamId: pick.advancingTeamId,
        },
      });
      if (pick.score?.calculationKey === calculationKey) continue;
      const breakdown = {
        criterion: score.criterion,
        awardedPoints: score.points,
        winnerHit,
        matchedTeamCount,
        rule: { advancingTeam: 15, participatingTeam: 7, miss: 0 },
      };
      const next = {
        poolSeasonId,
        points: score.points,
        scoreType: score.scoreType as ScoreType,
        isFinal: true,
        scoringRuleSetVersionId: ruleSet.id,
        scoringVersion: ruleSet.version,
        breakdown,
        calculationKey,
        resultRevision: sourceRevision,
        calculatedAt: fixture.updatedAt,
      };
      const afterScore = {
        ...next,
        calculatedAt: fixture.updatedAt.toISOString(),
      } as unknown as Prisma.InputJsonValue;
      await tx.knockoutPredictionScore.upsert({
        where: { pickId: pick.id },
        update: next,
        create: { ...next, pickId: pick.id, fixtureId: fixture.id, userId: pick.bracket.userId },
      });
      const auditKey = stableHash({
        targetId: pick.id,
        sourceRevision,
        before: pick.score?.calculationKey ?? null,
        after: calculationKey,
      });
      await tx.scoreRecomputationAudit.createMany({
        data: [
          {
            poolSeasonId,
            userId: pick.bracket.userId,
            targetType: 'KNOCKOUT_PICK',
            targetId: pick.id,
            sourceRevision,
            scoringRuleSetVersionId: ruleSet.id,
            before: beforeScore,
            after: afterScore,
            reason: pick.score ? 'RESULT_CORRECTION_OR_REPLAY' : 'INITIAL_CALCULATION',
            idempotencyKey: auditKey,
          },
        ],
        skipDuplicates: true,
      });
    }
    return [...byPool.values()];
  });

  if (options.refreshRanking !== false) {
    for (const context of contexts) {
      await refreshRankingSnapshot(context);
      await recomputePoolSeasonEngagement(context.poolSeasonId);
    }
  }
}
