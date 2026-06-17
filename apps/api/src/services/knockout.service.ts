import {
  KnockoutGenerationMode,
  KnockoutGenerationStatus,
  MatchStatus,
  Prisma,
  ScoreType,
} from '@prisma/client';
import type { UpsertKnockoutBracketInput } from '@bolao/shared';
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

const PROVISIONAL_KNOCKOUT_CLOSES_AT = new Date('2026-06-18T16:00:00.000Z');

type GroupScoreOverride = NonNullable<UpsertKnockoutBracketInput['groupScores']>[number];

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
        stage: fixture.stage,
        startsAt: new Date(fixture.startsAt),
        homeSource: fixture.homeSource,
        awaySource: fixture.awaySource,
      },
      create: {
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
        sequence: (latest?.sequence ?? 0) + 1,
        mode,
        closesAt,
        status: generationStatusFor(closesAt),
      },
    });
  }

  const closesAt = generationClosesAt(active.mode, predictionCloseMinutes);
  const status = generationStatusFor(closesAt);
  if (active.closesAt?.getTime() !== closesAt.getTime() || active.status !== status) {
    active = await prisma.knockoutGeneration.update({
      where: { id: active.id },
      data: { closesAt, status },
    });
  }

  if (groupStageComplete || active.mode === KnockoutGenerationMode.OFFICIAL) {
    await syncOfficialKnockoutParticipants();
  }

  return { generation: active, groupStageComplete, predictionCloseMinutes };
}

async function loadProjectionGroups(userId: string | null, scoreOverrides: GroupScoreOverride[] = []) {
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
      predictedHomeScore: scoreOverride?.predictedHomeScore ?? prediction?.predictedHomeScore ?? null,
      predictedAwayScore: scoreOverride?.predictedAwayScore ?? prediction?.predictedAwayScore ?? null,
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

export async function getPredictionBoard(userId: string, scoreOverrides: GroupScoreOverride[] = []) {
  const [
    { generation, groupStageComplete, predictionCloseMinutes },
    projection,
    publicMatches,
    viewer,
  ] = await Promise.all([
    ensureKnockoutInfrastructure(),
    loadProjectionGroups(userId, scoreOverrides),
    prisma.match.findMany({
      orderBy: { startsAt: 'asc' },
      include: {
        matchDay: true,
        homeTeam: true,
        awayTeam: true,
        predictions: {
          where: { user: { role: 'USER', status: 'ACTIVE' } },
          include: { user: { select: { id: true, nickname: true, avatarUrl: true } } },
          orderBy: { user: { nickname: 'asc' } },
        },
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } }),
  ]);
  const now = new Date();
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

  return {
    checkedAt: now.toISOString(),
    predictionCloseMinutes,
    canPredict: viewer?.role === 'USER' && viewer.status === 'ACTIVE',
    groupStageComplete,
    groups,
    knockout: {
      generation: {
        id: generation.id,
        sequence: generation.sequence,
        mode: generation.mode,
        status: generation.status,
        closesAt: generation.closesAt,
        isOpen:
          generation.status === KnockoutGenerationStatus.ACTIVE &&
          (!generation.closesAt || generation.closesAt > now),
      },
      fixtures,
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

export async function saveKnockoutBracket(userId: string, input: UpsertKnockoutBracketInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });
  if (!user || user.status !== 'ACTIVE' || user.role !== 'USER') {
    throw new AppError(403, 'Usuário sem permissão para salvar a chave.', 'USER_NOT_ALLOWED');
  }

  const { generation } = await ensureKnockoutInfrastructure();
  if (
    generation.status !== KnockoutGenerationStatus.ACTIVE ||
    (generation.closesAt && generation.closesAt <= new Date())
  ) {
    throw new AppError(
      409,
      'O prazo para salvar a chave foi encerrado.',
      'KNOCKOUT_BRACKET_CLOSED',
    );
  }

  const { participants } = await roundOf32ForGeneration(generation.mode, userId, input.groupScores);
  let materialized;
  try {
    materialized = materializeBracket(input.picks, participants, undefined, { allowPartial: true });
  } catch (error) {
    throw new AppError(
      400,
      error instanceof Error ? error.message : 'Chave eliminatória inválida.',
      'INVALID_KNOCKOUT_BRACKET',
    );
  }

  const fixtures = await prisma.knockoutFixture.findMany({
    select: { id: true, matchNumber: true },
  });
  const fixtureIdByNumber = new Map(fixtures.map((fixture) => [fixture.matchNumber, fixture.id]));
  const bracket = await prisma.$transaction(async (tx) => {
    const saved = await tx.knockoutBracket.upsert({
      where: { userId_generationId: { userId, generationId: generation.id } },
      update: { submittedAt: new Date() },
      create: { userId, generationId: generation.id },
    });
    await tx.knockoutPick.deleteMany({ where: { bracketId: saved.id } });
    await tx.knockoutPick.createMany({
      data: materialized.map((pick) => ({
        bracketId: saved.id,
        fixtureId: fixtureIdByNumber.get(pick.matchNumber)!,
        homeTeamId: pick.homeTeamId,
        awayTeamId: pick.awayTeamId,
        advancingTeamId: pick.advancingTeamId,
        predictedHomeScore: pick.predictedHomeScore,
        predictedAwayScore: pick.predictedAwayScore,
      })),
    });
    return saved;
  });

  emitSse('knockout.updated', {
    userId,
    generationId: generation.id,
    submittedAt: bracket.submittedAt.toISOString(),
  });
  return getPredictionBoard(userId, input.groupScores);
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
    where: { generationId: generation.id, user: { role: 'USER', status: 'ACTIVE' } },
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
  const fixture = await prisma.knockoutFixture.findUnique({
    where: { id: fixtureId },
    include: {
      picks: {
        where: { bracket: { generation: { status: { not: KnockoutGenerationStatus.RESET } } } },
        include: { bracket: true },
      },
    },
  });
  if (!fixture || !fixture.homeTeamId || !fixture.awayTeamId) return;

  for (const pick of fixture.picks) {
    const predictedTeams = new Set([pick.homeTeamId, pick.awayTeamId]);
    const actualTeams = new Set([fixture.homeTeamId, fixture.awayTeamId]);
    const matchedTeams = [...predictedTeams].filter((teamId) => actualTeams.has(teamId)).length;
    const score =
      matchedTeams === 2
        ? { points: 15, scoreType: 'EXACT_SCORE' as const }
        : matchedTeams === 1
          ? { points: 7, scoreType: 'ONE_TEAM_GOALS' as const }
          : { points: 0, scoreType: 'MISS' as const };

    await prisma.knockoutPredictionScore.upsert({
      where: { pickId: pick.id },
      update: {
        points: score.points,
        scoreType: score.scoreType as ScoreType,
        isFinal: true,
        calculatedAt: new Date(),
      },
      create: {
        pickId: pick.id,
        fixtureId: fixture.id,
        userId: pick.bracket.userId,
        points: score.points,
        scoreType: score.scoreType as ScoreType,
        isFinal: true,
      },
    });
  }
  if (options.refreshRanking !== false) await refreshRankingSnapshot();
}
