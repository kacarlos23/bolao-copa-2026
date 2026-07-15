import { randomUUID } from 'node:crypto';
import {
  MatchStatus,
  Prisma,
  type ProviderEntityType,
  type ProviderSyncType,
  type SyncQuarantineReason,
} from '@prisma/client';
import { AppError } from '../../http/errors.js';
import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';
import {
  recalculateScoresForMatch,
  refreshRankingSnapshot,
} from '../../services/ranking.service.js';
import { dispatchOutboxEvent, enqueueOutboxEvent } from '../events/outbox.js';
import {
  type CompetitionDataProvider,
  type NormalizedMatch,
  type NormalizedResult,
  type NormalizedStanding,
  type NormalizedTeam,
  normalizedMatchArraySchema,
  normalizedResultArraySchema,
  normalizedStandingArraySchema,
  normalizedTeamArraySchema,
} from './competition-data-provider.js';
import {
  chooseMatchIdentity,
  partitionDuplicateExternalIds,
  resultUpdateAllowed,
  uniqueNameCandidate,
  valuesAfterManualOverride,
} from './provider-sync.logic.js';
import { checksum, redactProviderError } from './provider-utils.js';

const LOCK_TTL_MS = 2 * 60_000;

export interface ProviderSyncOptions {
  type: ProviderSyncType;
  seasonId: string;
  dryRun?: boolean;
  idempotencyKey: string;
  requestedById?: string | null;
}

export interface ProviderSyncDiff {
  action: 'INSERT' | 'UPDATE' | 'MAP' | 'UNCHANGED' | 'QUARANTINE' | 'OVERRIDE_PRESERVED';
  entity: 'TEAM' | 'MATCH' | 'RESULT' | 'STANDING';
  externalId: string;
  internalId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

export interface ProviderSyncSummary {
  runId: string;
  provider: string;
  seasonId: string;
  type: ProviderSyncType;
  dryRun: boolean;
  status: 'SUCCESS' | 'PARTIAL' | 'DRY_RUN';
  source: string;
  checksum: string;
  startedAt: string;
  finishedAt: string;
  counts: {
    fetched: number;
    inserted: number;
    updated: number;
    unchanged: number;
    quarantined: number;
  };
  diff: ProviderSyncDiff[];
  reused?: boolean;
}

interface QuarantineInput {
  externalId?: string;
  reason: SyncQuarantineReason;
  message: string;
  payload: unknown;
}

type ProviderItem = NormalizedTeam | NormalizedMatch | NormalizedResult | NormalizedStanding;

const activeRuns = new Map<
  string,
  { idempotencyKey: string; promise: Promise<ProviderSyncSummary> }
>();

function syncKey(provider: string, seasonId: string, type: ProviderSyncType) {
  return `${provider}:${seasonId}:${type}`;
}

async function providerItems(
  provider: CompetitionDataProvider,
  options: ProviderSyncOptions,
): Promise<ProviderItem[]> {
  const context = { seasonId: options.seasonId, requestedById: options.requestedById };
  switch (options.type) {
    case 'TEAMS':
      return normalizedTeamArraySchema.parse(await provider.syncTeams(context));
    case 'SCHEDULE':
      return normalizedMatchArraySchema.parse(await provider.syncSchedule(context));
    case 'RESULTS':
      return normalizedResultArraySchema.parse(await provider.syncResults(context));
    case 'STANDINGS':
      if (!provider.syncStandings) return [];
      return normalizedStandingArraySchema.parse(await provider.syncStandings(context));
  }
}

function summaryFromRun(run: {
  id: string;
  provider: string;
  seasonId: string;
  type: ProviderSyncType;
  dryRun: boolean;
  status: string;
  source: string;
  checksum: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  quarantinedCount: number;
}): ProviderSyncSummary {
  return {
    runId: run.id,
    provider: run.provider,
    seasonId: run.seasonId,
    type: run.type,
    dryRun: run.dryRun,
    status: run.status === 'DRY_RUN' ? 'DRY_RUN' : run.status === 'PARTIAL' ? 'PARTIAL' : 'SUCCESS',
    source: run.source,
    checksum: run.checksum ?? '',
    startedAt: run.startedAt.toISOString(),
    finishedAt: (run.finishedAt ?? run.startedAt).toISOString(),
    counts: {
      fetched: run.fetchedCount,
      inserted: run.insertedCount,
      updated: run.updatedCount,
      unchanged: run.unchangedCount,
      quarantined: run.quarantinedCount,
    },
    diff: [],
    reused: true,
  };
}

async function acquireLock(provider: string, options: ProviderSyncOptions, ownerId: string) {
  const key = syncKey(provider, options.seasonId, options.type);
  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.providerSyncLock.deleteMany({ where: { key, expiresAt: { lt: now } } });
      await tx.providerSyncLock.create({
        data: {
          key,
          provider,
          seasonId: options.seasonId,
          type: options.type,
          ownerId,
          expiresAt: new Date(now.getTime() + LOCK_TTL_MS),
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(
        409,
        'A synchronization is already running for this provider scope.',
        'PROVIDER_SYNC_LOCKED',
      );
    }
    throw error;
  }
  return key;
}

async function releaseLock(key: string, ownerId: string) {
  await prisma.providerSyncLock.deleteMany({ where: { key, ownerId } });
}

function quarantineDiff(
  entity: ProviderSyncDiff['entity'],
  input: QuarantineInput,
): ProviderSyncDiff {
  return {
    action: 'QUARANTINE',
    entity,
    externalId: input.externalId ?? 'unknown',
    reason: input.message,
    after: input.payload,
  };
}

function civilDayKey(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
}

async function ensureMatchDay(tx: Prisma.TransactionClient, seasonId: string, startsAt: Date) {
  const season = await tx.competitionSeason.findUnique({
    where: { id: seasonId },
    select: { timezone: true },
  });
  if (!season) throw new AppError(404, 'Season not found.', 'SEASON_NOT_FOUND');
  const date = civilDayKey(startsAt, season.timezone);
  const nextDate = new Date(date.getTime() + 24 * 60 * 60_000);
  const closeAt = new Date(startsAt.getTime() - 5 * 60_000);
  const existing = await tx.matchDay.findFirst({
    where: { seasonId, date: { gte: date, lt: nextDate } },
  });
  if (existing) {
    const firstMatchStartsAt =
      existing.firstMatchStartsAt < startsAt ? existing.firstMatchStartsAt : startsAt;
    return tx.matchDay.update({
      where: { id: existing.id },
      data: {
        firstMatchStartsAt,
        predictionsCloseAt: new Date(firstMatchStartsAt.getTime() - 5 * 60_000),
      },
    });
  }
  return tx.matchDay.create({
    data: {
      seasonId,
      date,
      firstMatchStartsAt: startsAt,
      predictionsCloseAt: closeAt,
      status: closeAt > new Date() ? 'OPEN' : 'CLOSED',
    },
  });
}

function mappingData(
  provider: CompetitionDataProvider,
  options: ProviderSyncOptions,
  entityType: ProviderEntityType,
  externalId: string,
  internalId: string,
  itemChecksum: string,
) {
  return {
    provider: provider.name,
    entityType,
    externalId,
    internalId,
    seasonId: options.seasonId,
    sourceUrl: provider.source,
    collectedAt: new Date(),
    checksum: itemChecksum,
  } satisfies Prisma.ProviderEntityMappingUncheckedCreateInput;
}

async function resolveTeam(
  providerName: string,
  seasonId: string,
  externalId: string | undefined,
  name: string,
) {
  if (externalId) {
    const mapping = await prisma.providerEntityMapping.findUnique({
      where: {
        provider_entityType_externalId: { provider: providerName, entityType: 'TEAM', externalId },
      },
    });
    if (mapping) return { id: mapping.internalId, ambiguous: false };
  }
  const teams = await prisma.seasonTeam.findMany({
    where: { seasonId },
    select: { team: { select: { id: true, name: true } } },
  });
  const resolution = uniqueNameCandidate(
    name,
    teams.map((entry) => entry.team),
  );
  return {
    id: resolution.candidate?.id ?? null,
    ambiguous: resolution.matches.length > 1,
  };
}

async function processTeam(
  provider: CompetitionDataProvider,
  options: ProviderSyncOptions,
  team: NormalizedTeam,
): Promise<{ diff: ProviderSyncDiff; quarantine?: QuarantineInput; eventId?: string }> {
  const itemChecksum = checksum(team);
  const mapping = await prisma.providerEntityMapping.findUnique({
    where: {
      provider_entityType_externalId: {
        provider: provider.name,
        entityType: 'TEAM',
        externalId: team.externalId,
      },
    },
  });
  const seasonTeams = await prisma.seasonTeam.findMany({
    where: { seasonId: options.seasonId },
    select: { team: true },
  });
  let internal = mapping
    ? seasonTeams.find((entry) => entry.team.id === mapping.internalId)?.team
    : undefined;
  if (mapping && !internal) {
    const quarantine = {
      externalId: team.externalId,
      reason: 'INVALID_REFERENCE' as const,
      message: 'Team mapping points outside the selected season.',
      payload: team,
    };
    return { diff: quarantineDiff('TEAM', quarantine), quarantine };
  }
  if (!internal) {
    const resolution = uniqueNameCandidate(
      team.name,
      seasonTeams.map((entry) => entry.team),
    );
    if (resolution.matches.length > 1) {
      const quarantine = {
        externalId: team.externalId,
        reason: 'AMBIGUOUS_NAME' as const,
        message: 'Normalized team name matched more than one internal team.',
        payload: team,
      };
      return { diff: quarantineDiff('TEAM', quarantine), quarantine };
    }
    internal = resolution.candidate ?? undefined;
  }

  if (!internal) {
    let eventId: string | undefined;
    if (!options.dryRun) {
      const created = await prisma.$transaction(async (tx) => {
        const saved = await tx.team.create({
          data: {
            externalId: `${provider.name}:team:${team.externalId}`,
            name: team.name,
            code: team.code,
            type: team.type,
            crestUrl: team.crestUrl,
          },
        });
        await tx.seasonTeam.create({
          data: { seasonId: options.seasonId, teamId: saved.id, groupName: team.groupName },
        });
        await tx.providerEntityMapping.create({
          data: mappingData(provider, options, 'TEAM', team.externalId, saved.id, itemChecksum),
        });
        const event = await enqueueOutboxEvent(tx, {
          type: 'team.updated',
          seasonId: options.seasonId,
          poolSeasonId: null,
          payload: { teamId: saved.id, provider: provider.name },
        });
        return { saved, eventId: event.id };
      });
      internal = created.saved;
      eventId = created.eventId;
    }
    return {
      diff: {
        action: 'INSERT',
        entity: 'TEAM',
        externalId: team.externalId,
        internalId: internal?.id,
        after: team,
      },
      eventId,
    };
  }

  if (!mapping) {
    if (!options.dryRun) {
      await prisma.providerEntityMapping.create({
        data: mappingData(provider, options, 'TEAM', team.externalId, internal.id, itemChecksum),
      });
    }
    return {
      diff: {
        action: 'MAP',
        entity: 'TEAM',
        externalId: team.externalId,
        internalId: internal.id,
        after: team,
      },
    };
  }

  const changed =
    internal.name !== team.name ||
    (team.code !== undefined && internal.code !== team.code) ||
    (team.type !== undefined && internal.type !== team.type) ||
    (team.crestUrl !== undefined && internal.crestUrl !== team.crestUrl);
  let eventId: string | undefined;
  if (changed && !options.dryRun) {
    eventId = await prisma.$transaction(async (tx) => {
      await tx.team.update({
        where: { id: internal!.id },
        data: { name: team.name, code: team.code, type: team.type, crestUrl: team.crestUrl },
      });
      await tx.providerEntityMapping.update({
        where: { id: mapping.id },
        data: { checksum: itemChecksum, sourceUrl: provider.source, collectedAt: new Date() },
      });
      return (
        await enqueueOutboxEvent(tx, {
          type: 'team.updated',
          seasonId: options.seasonId,
          poolSeasonId: null,
          payload: { teamId: internal!.id, provider: provider.name },
        })
      ).id;
    });
  }
  return {
    diff: {
      action: changed ? 'UPDATE' : 'UNCHANGED',
      entity: 'TEAM',
      externalId: team.externalId,
      internalId: internal.id,
      before: changed ? internal : undefined,
      after: changed ? team : undefined,
    },
    eventId,
  };
}

async function resolveScheduleTeams(
  provider: CompetitionDataProvider,
  options: ProviderSyncOptions,
  match: NormalizedMatch,
) {
  const [home, away] = await Promise.all([
    resolveTeam(provider.name, options.seasonId, match.homeTeamExternalId, match.homeTeamName),
    resolveTeam(provider.name, options.seasonId, match.awayTeamExternalId, match.awayTeamName),
  ]);
  return { home, away };
}

async function resolveOptionalScheduleMapping(
  providerName: string,
  seasonId: string,
  entityType: 'STAGE' | 'ROUND',
  externalId: string | undefined,
) {
  if (!externalId) return { internalId: null, missing: false };
  const mapping = await prisma.providerEntityMapping.findUnique({
    where: { provider_entityType_externalId: { provider: providerName, entityType, externalId } },
  });
  if (!mapping || (mapping.seasonId && mapping.seasonId !== seasonId)) {
    return { internalId: null, missing: true };
  }
  const target =
    entityType === 'STAGE'
      ? await prisma.stage.findFirst({
          where: { id: mapping.internalId, seasonId },
          select: { id: true },
        })
      : await prisma.round.findFirst({
          where: { id: mapping.internalId, seasonId },
          select: { id: true },
        });
  return { internalId: target?.id ?? null, missing: !target };
}

async function processSchedule(
  provider: CompetitionDataProvider,
  options: ProviderSyncOptions,
  incoming: NormalizedMatch,
): Promise<{ diff: ProviderSyncDiff; quarantine?: QuarantineInput; eventId?: string }> {
  const teams = await resolveScheduleTeams(provider, options, incoming);
  if (!teams.home.id || !teams.away.id || teams.home.id === teams.away.id) {
    const ambiguous = teams.home.ambiguous || teams.away.ambiguous;
    const quarantine = {
      externalId: incoming.externalId,
      reason: ambiguous ? ('AMBIGUOUS_NAME' as const) : ('MISSING_MAPPING' as const),
      message: ambiguous
        ? 'At least one normalized team name is ambiguous.'
        : 'Schedule references a team that has no mapping or unique name match.',
      payload: incoming,
    };
    return { diff: quarantineDiff('MATCH', quarantine), quarantine };
  }
  const [stage, round] = await Promise.all([
    resolveOptionalScheduleMapping(
      provider.name,
      options.seasonId,
      'STAGE',
      incoming.stageExternalId,
    ),
    resolveOptionalScheduleMapping(
      provider.name,
      options.seasonId,
      'ROUND',
      incoming.roundExternalId,
    ),
  ]);
  if (stage.missing || round.missing) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'MISSING_MAPPING' as const,
      message: 'Schedule stage or round externalId has no valid season mapping.',
      payload: incoming,
    };
    return { diff: quarantineDiff('MATCH', quarantine), quarantine };
  }
  const mapping = await prisma.providerEntityMapping.findUnique({
    where: {
      provider_entityType_externalId: {
        provider: provider.name,
        entityType: 'MATCH',
        externalId: incoming.externalId,
      },
    },
  });
  const fallbackCandidates = mapping
    ? []
    : await prisma.match.findMany({
        where: {
          seasonId: options.seasonId,
          homeTeamId: teams.home.id,
          awayTeamId: teams.away.id,
        },
        include: { manualOverride: true },
      });
  const identity = chooseMatchIdentity(
    mapping?.internalId ?? null,
    fallbackCandidates.map((candidate) => candidate.id),
  );
  const current = mapping
    ? await prisma.match.findFirst({
        where: { id: identity.internalId!, seasonId: options.seasonId },
        include: { manualOverride: true },
      })
    : (fallbackCandidates.find((candidate) => candidate.id === identity.internalId) ?? null);
  if (mapping && !current) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'INVALID_REFERENCE' as const,
      message: 'Match mapping points outside the selected season.',
      payload: incoming,
    };
    return { diff: quarantineDiff('MATCH', quarantine), quarantine };
  }
  if (identity.ambiguous) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'AMBIGUOUS_NAME' as const,
      message: 'Team-pair fallback matched more than one internal match.',
      payload: incoming,
    };
    return { diff: quarantineDiff('MATCH', quarantine), quarantine };
  }
  const startsAt = incoming.startsAt ? new Date(incoming.startsAt) : current?.startsAt;
  const itemChecksum = checksum(incoming);
  if (!startsAt) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'INVALID_PAYLOAD' as const,
      message: 'A new schedule item must have an officially reconciled start time.',
      payload: incoming,
    };
    return { diff: quarantineDiff('MATCH', quarantine), quarantine };
  }
  if (!current) {
    let internalId: string | undefined;
    let eventId: string | undefined;
    if (!options.dryRun) {
      const created = await prisma.$transaction(async (tx) => {
        const matchDay = await ensureMatchDay(tx, options.seasonId, startsAt);
        const saved = await tx.match.create({
          data: {
            externalId: `${provider.name}:match:${incoming.externalId}`,
            matchDayId: matchDay.id,
            seasonId: options.seasonId,
            stageId: stage.internalId,
            roundId: round.internalId,
            homeTeamId: teams.home.id!,
            awayTeamId: teams.away.id!,
            startsAt,
            predictionClosesAt: new Date(startsAt.getTime() - 5 * 60_000),
            status: incoming.status,
            rawPayload: {
              providerSchedule: incoming,
              source: provider.source,
              checksum: itemChecksum,
            },
            lastSyncedAt: new Date(),
          },
        });
        await tx.providerEntityMapping.create({
          data: mappingData(
            provider,
            options,
            'MATCH',
            incoming.externalId,
            saved.id,
            itemChecksum,
          ),
        });
        const event = await enqueueOutboxEvent(tx, {
          type: 'match.schedule.updated',
          seasonId: options.seasonId,
          poolSeasonId: null,
          payload: { matchId: saved.id, provider: provider.name },
        });
        return { saved, eventId: event.id };
      });
      internalId = created.saved.id;
      eventId = created.eventId;
    }
    return {
      diff: {
        action: 'INSERT',
        entity: 'MATCH',
        externalId: incoming.externalId,
        internalId,
        after: incoming,
      },
      eventId,
    };
  }

  const overrideValues =
    current.manualOverride?.active &&
    current.manualOverride.values &&
    typeof current.manualOverride.values === 'object' &&
    !Array.isArray(current.manualOverride.values)
      ? (current.manualOverride.values as Record<string, unknown>)
      : null;
  const synchronized = {
    startsAt,
    status: resultUpdateAllowed(current.status, incoming.status) ? incoming.status : current.status,
    homeTeamId: teams.home.id,
    awayTeamId: teams.away.id,
    stageId: stage.internalId,
    roundId: round.internalId,
  };
  const effective = valuesAfterManualOverride(synchronized, overrideValues);
  const effectiveStartsAt =
    effective.startsAt instanceof Date ? effective.startsAt : new Date(String(effective.startsAt));
  const effectiveStatus = effective.status as MatchStatus;
  const changed =
    current.startsAt.getTime() !== effectiveStartsAt.getTime() ||
    current.status !== effectiveStatus ||
    current.homeTeamId !== effective.homeTeamId ||
    current.awayTeamId !== effective.awayTeamId ||
    current.stageId !== effective.stageId ||
    current.roundId !== effective.roundId;
  let eventId: string | undefined;
  if (changed && !options.dryRun) {
    eventId = await prisma.$transaction(async (tx) => {
      const matchDay = await ensureMatchDay(tx, options.seasonId, effectiveStartsAt);
      await tx.match.update({
        where: { id: current!.id },
        data: {
          matchDayId: matchDay.id,
          startsAt: effectiveStartsAt,
          predictionClosesAt: new Date(effectiveStartsAt.getTime() - 5 * 60_000),
          status: effectiveStatus,
          homeTeamId: String(effective.homeTeamId),
          awayTeamId: String(effective.awayTeamId),
          stageId: effective.stageId ? String(effective.stageId) : null,
          roundId: effective.roundId ? String(effective.roundId) : null,
          rawPayload: {
            ...(current!.rawPayload &&
            typeof current!.rawPayload === 'object' &&
            !Array.isArray(current!.rawPayload)
              ? (current!.rawPayload as Record<string, unknown>)
              : {}),
            providerSchedule: incoming,
            source: provider.source,
            scheduleChecksum: itemChecksum,
            manualOverrideApplied: Boolean(overrideValues),
          },
          lastSyncedAt: new Date(),
        },
      });
      await tx.providerEntityMapping.upsert({
        where: {
          provider_entityType_externalId: {
            provider: provider.name,
            entityType: 'MATCH',
            externalId: incoming.externalId,
          },
        },
        create: mappingData(
          provider,
          options,
          'MATCH',
          incoming.externalId,
          current!.id,
          itemChecksum,
        ),
        update: {
          internalId: current!.id,
          seasonId: options.seasonId,
          sourceUrl: provider.source,
          checksum: itemChecksum,
          collectedAt: new Date(),
        },
      });
      return (
        await enqueueOutboxEvent(tx, {
          type: 'match.schedule.updated',
          seasonId: options.seasonId,
          poolSeasonId: null,
          payload: { matchId: current!.id, provider: provider.name },
        })
      ).id;
    });
  } else if (!mapping && !options.dryRun) {
    await prisma.providerEntityMapping.create({
      data: mappingData(provider, options, 'MATCH', incoming.externalId, current.id, itemChecksum),
    });
  }
  return {
    diff: {
      action: overrideValues
        ? 'OVERRIDE_PRESERVED'
        : changed
          ? 'UPDATE'
          : mapping
            ? 'UNCHANGED'
            : 'MAP',
      entity: 'MATCH',
      externalId: incoming.externalId,
      internalId: current.id,
      before: changed ? { startsAt: current.startsAt, status: current.status } : undefined,
      after: changed ? effective : undefined,
      reason: overrideValues ? 'Active manual override has precedence.' : undefined,
    },
    eventId,
  };
}

async function resolveResultMatch(
  provider: CompetitionDataProvider,
  options: ProviderSyncOptions,
  result: NormalizedResult,
) {
  const matchExternalId = result.matchExternalId ?? result.externalId;
  const mapping = await prisma.providerEntityMapping.findUnique({
    where: {
      provider_entityType_externalId: {
        provider: provider.name,
        entityType: 'MATCH',
        externalId: matchExternalId,
      },
    },
  });
  if (mapping) {
    const match = await prisma.match.findFirst({
      where: { id: mapping.internalId, seasonId: options.seasonId },
      include: { manualOverride: true },
    });
    return { match, ambiguous: false, invalidMapping: !match };
  }
  const teams = await Promise.all([
    resolveTeam(provider.name, options.seasonId, result.homeTeamExternalId, result.homeTeamName),
    resolveTeam(provider.name, options.seasonId, result.awayTeamExternalId, result.awayTeamName),
  ]);
  if (!teams[0].id || !teams[1].id)
    return { match: null, ambiguous: teams.some((team) => team.ambiguous), invalidMapping: false };
  const candidates = await prisma.match.findMany({
    where: { seasonId: options.seasonId, homeTeamId: teams[0].id, awayTeamId: teams[1].id },
    include: { manualOverride: true },
  });
  const narrowed = result.startsAt
    ? candidates.filter(
        (match) =>
          Math.abs(match.startsAt.getTime() - new Date(result.startsAt!).getTime()) <=
          36 * 60 * 60_000,
      )
    : candidates;
  return {
    match: narrowed.length === 1 ? narrowed[0] : null,
    ambiguous: narrowed.length > 1,
    invalidMapping: false,
  };
}

async function processResult(
  provider: CompetitionDataProvider,
  options: ProviderSyncOptions,
  incoming: NormalizedResult,
): Promise<{
  diff: ProviderSyncDiff;
  quarantine?: QuarantineInput;
  eventId?: string;
  scoreMatchId?: string;
}> {
  const resolution = await resolveResultMatch(provider, options, incoming);
  if (!resolution.match) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: resolution.ambiguous
        ? ('AMBIGUOUS_NAME' as const)
        : resolution.invalidMapping
          ? ('INVALID_REFERENCE' as const)
          : ('MISSING_MAPPING' as const),
      message: resolution.ambiguous
        ? 'Result fallback matched more than one internal match.'
        : resolution.invalidMapping
          ? 'Result mapping points outside the selected season.'
          : 'Result has no match mapping or unique fallback.',
      payload: incoming,
    };
    return { diff: quarantineDiff('RESULT', quarantine), quarantine };
  }
  const current = resolution.match;
  if (!resultUpdateAllowed(current.status, incoming.status)) {
    return {
      diff: {
        action: 'UNCHANGED',
        entity: 'RESULT',
        externalId: incoming.externalId,
        internalId: current.id,
        reason: 'A FINISHED result cannot regress automatically.',
      },
    };
  }
  const overrideValues =
    current.manualOverride?.active &&
    typeof current.manualOverride.values === 'object' &&
    !Array.isArray(current.manualOverride.values)
      ? (current.manualOverride.values as Record<string, unknown>)
      : null;
  const synchronized = {
    status: incoming.status,
    homeScore: incoming.status === 'SCHEDULED' ? null : incoming.homeScore,
    awayScore: incoming.status === 'SCHEDULED' ? null : incoming.awayScore,
    finalHomeScore: incoming.status === 'FINISHED' ? incoming.homeScore : current.finalHomeScore,
    finalAwayScore: incoming.status === 'FINISHED' ? incoming.awayScore : current.finalAwayScore,
  };
  const effective = valuesAfterManualOverride(synchronized, overrideValues);
  const changed =
    current.status !== effective.status ||
    current.homeScore !== effective.homeScore ||
    current.awayScore !== effective.awayScore ||
    current.finalHomeScore !== effective.finalHomeScore ||
    current.finalAwayScore !== effective.finalAwayScore;
  let eventId: string | undefined;
  if (changed && !options.dryRun) {
    eventId = await prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id: current.id },
        data: {
          status: effective.status as MatchStatus,
          homeScore: effective.homeScore as number | null,
          awayScore: effective.awayScore as number | null,
          finalHomeScore: effective.finalHomeScore as number | null,
          finalAwayScore: effective.finalAwayScore as number | null,
          lastSyncedAt: new Date(),
          rawPayload: {
            ...(current.rawPayload &&
            typeof current.rawPayload === 'object' &&
            !Array.isArray(current.rawPayload)
              ? (current.rawPayload as Record<string, unknown>)
              : {}),
            providerResult: incoming,
            source: provider.source,
            resultChecksum: checksum(incoming),
            manualOverrideApplied: Boolean(overrideValues),
          },
        },
      });
      return (
        await enqueueOutboxEvent(tx, {
          type: 'match.result.updated',
          seasonId: options.seasonId,
          poolSeasonId: null,
          payload: {
            matchId: current.id,
            provider: provider.name,
            overridePreserved: Boolean(overrideValues),
          },
        })
      ).id;
    });
  }
  return {
    diff: {
      action: overrideValues ? 'OVERRIDE_PRESERVED' : changed ? 'UPDATE' : 'UNCHANGED',
      entity: 'RESULT',
      externalId: incoming.externalId,
      internalId: current.id,
      before: changed
        ? {
            status: current.status,
            homeScore: current.homeScore,
            awayScore: current.awayScore,
            finalHomeScore: current.finalHomeScore,
            finalAwayScore: current.finalAwayScore,
          }
        : undefined,
      after: changed ? effective : undefined,
      reason: overrideValues ? 'Active manual override has precedence.' : undefined,
    },
    eventId,
    scoreMatchId: changed && !options.dryRun ? current.id : undefined,
  };
}

async function processStanding(
  provider: CompetitionDataProvider,
  options: ProviderSyncOptions,
  standing: NormalizedStanding,
): Promise<{ diff: ProviderSyncDiff; quarantine?: QuarantineInput; eventId?: string }> {
  const team = await resolveTeam(
    provider.name,
    options.seasonId,
    standing.teamExternalId,
    standing.teamName,
  );
  if (!team.id) {
    const quarantine = {
      externalId: standing.externalId,
      reason: team.ambiguous ? ('AMBIGUOUS_NAME' as const) : ('MISSING_MAPPING' as const),
      message: team.ambiguous
        ? 'Standing team name is ambiguous.'
        : 'Standing team has no mapping.',
      payload: standing,
    };
    return { diff: quarantineDiff('STANDING', quarantine), quarantine };
  }
  const key = `provider-standing:${provider.name}:${options.seasonId}:${standing.externalId}`;
  const previous = await prisma.appSetting.findUnique({ where: { key } });
  const value = {
    ...standing,
    internalTeamId: team.id,
    source: provider.source,
    checksum: checksum(standing),
  };
  const changed = checksum(previous?.value ?? null) !== checksum(value);
  let eventId: string | undefined;
  if (changed && !options.dryRun) {
    eventId = await prisma.$transaction(async (tx) => {
      await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
      return (
        await enqueueOutboxEvent(tx, {
          type: 'standings.updated',
          seasonId: options.seasonId,
          poolSeasonId: null,
          payload: { teamId: team.id, provider: provider.name },
        })
      ).id;
    });
  }
  return {
    diff: {
      action: previous ? (changed ? 'UPDATE' : 'UNCHANGED') : 'INSERT',
      entity: 'STANDING' as const,
      externalId: standing.externalId,
      internalId: team.id,
      before: changed ? previous?.value : undefined,
      after: changed ? value : undefined,
    },
    eventId,
  };
}

async function runCore(provider: CompetitionDataProvider, options: ProviderSyncOptions) {
  const existing = await prisma.providerSyncRun.findUnique({
    where: {
      provider_seasonId_type_idempotencyKey: {
        provider: provider.name,
        seasonId: options.seasonId,
        type: options.type,
        idempotencyKey: options.idempotencyKey,
      },
    },
  });
  if (existing && existing.status !== 'RUNNING' && existing.status !== 'FAILED')
    return summaryFromRun(existing);

  const ownerId = randomUUID();
  const lockKey = await acquireLock(provider.name, options, ownerId);
  let runId: string | undefined;
  try {
    const run =
      existing ??
      (await prisma.providerSyncRun.create({
        data: {
          provider: provider.name,
          seasonId: options.seasonId,
          type: options.type,
          idempotencyKey: options.idempotencyKey,
          dryRun: options.dryRun ?? false,
          source: provider.source,
          requestedById: options.requestedById,
        },
      }));
    runId = run.id;
    const fetched = await providerItems(provider, options);
    const batchChecksum = checksum(fetched);
    const partitioned = partitionDuplicateExternalIds(fetched);
    const quarantines: QuarantineInput[] = partitioned.duplicates.map((item) => ({
      externalId: item.externalId,
      reason: 'DUPLICATE_EXTERNAL_ID',
      message: 'Payload contains a duplicate externalId.',
      payload: item,
    }));
    const diff: ProviderSyncDiff[] = quarantines.map((item) =>
      quarantineDiff(
        options.type === 'TEAMS'
          ? 'TEAM'
          : options.type === 'SCHEDULE'
            ? 'MATCH'
            : options.type === 'RESULTS'
              ? 'RESULT'
              : 'STANDING',
        item,
      ),
    );
    const eventIds: string[] = [];
    const scoreMatchIds = new Set<string>();

    for (const item of partitioned.accepted) {
      const processed: {
        diff: ProviderSyncDiff;
        quarantine?: QuarantineInput;
        eventId?: string;
        scoreMatchId?: string;
      } =
        options.type === 'TEAMS'
          ? await processTeam(provider, options, item as NormalizedTeam)
          : options.type === 'SCHEDULE'
            ? await processSchedule(provider, options, item as NormalizedMatch)
            : options.type === 'RESULTS'
              ? await processResult(provider, options, item as NormalizedResult)
              : await processStanding(provider, options, item as NormalizedStanding);
      diff.push(processed.diff);
      if (processed.quarantine) quarantines.push(processed.quarantine);
      if ('eventId' in processed && processed.eventId) eventIds.push(processed.eventId);
      if ('scoreMatchId' in processed && processed.scoreMatchId) {
        scoreMatchIds.add(processed.scoreMatchId);
      }
    }

    if (quarantines.length > 0) {
      await prisma.syncQuarantine.createMany({
        data: quarantines.map((item) => ({
          runId: run.id,
          seasonId: options.seasonId,
          provider: provider.name,
          type: options.type,
          externalId: item.externalId,
          reason: item.reason,
          message: item.message,
          payload: JSON.parse(JSON.stringify(item.payload)) as Prisma.InputJsonValue,
          checksum: checksum(item.payload),
        })),
      });
    }

    const counts = {
      fetched: fetched.length,
      inserted: diff.filter((item) => item.action === 'INSERT').length,
      updated: diff.filter((item) => ['UPDATE', 'MAP'].includes(item.action)).length,
      unchanged: diff.filter((item) => ['UNCHANGED', 'OVERRIDE_PRESERVED'].includes(item.action))
        .length,
      quarantined: quarantines.length,
    };
    const status = options.dryRun ? 'DRY_RUN' : quarantines.length > 0 ? 'PARTIAL' : 'SUCCESS';
    const finishedAt = new Date();
    await prisma.providerSyncRun.update({
      where: { id: run.id },
      data: {
        status,
        checksum: batchChecksum,
        fetchedCount: counts.fetched,
        insertedCount: counts.inserted,
        updatedCount: counts.updated,
        unchangedCount: counts.unchanged,
        quarantinedCount: counts.quarantined,
        finishedAt,
      },
    });
    for (const matchId of scoreMatchIds) {
      await recalculateScoresForMatch(matchId, { refreshRanking: false });
    }
    if (scoreMatchIds.size > 0) {
      const poolSeasons = await prisma.poolSeason.findMany({
        where: { seasonId: options.seasonId },
        select: { id: true, poolId: true, seasonId: true },
      });
      for (const poolSeason of poolSeasons) {
        await refreshRankingSnapshot({
          seasonId: poolSeason.seasonId,
          poolId: poolSeason.poolId,
          poolSeasonId: poolSeason.id,
        });
      }
    }
    for (const eventId of eventIds) await dispatchOutboxEvent(eventId);
    return {
      runId: run.id,
      provider: provider.name,
      seasonId: options.seasonId,
      type: options.type,
      dryRun: options.dryRun ?? false,
      status,
      source: provider.source,
      checksum: batchChecksum,
      startedAt: run.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      counts,
      diff,
    } satisfies ProviderSyncSummary;
  } catch (error) {
    const errorMessage = redactProviderError(error);
    if (runId) {
      await prisma.providerSyncRun
        .update({
          where: { id: runId },
          data: {
            status: 'FAILED',
            errorCode: error instanceof Error ? error.name.slice(0, 100) : 'UNKNOWN',
            errorMessage,
            finishedAt: new Date(),
          },
        })
        .catch((auditError) =>
          logger.error({ err: auditError, runId }, 'failed to close provider sync audit'),
        );
    }
    throw error;
  } finally {
    await releaseLock(lockKey, ownerId).catch((error) =>
      logger.error({ err: error, lockKey, ownerId }, 'failed to release provider sync lock'),
    );
  }
}

export function runProviderSync(provider: CompetitionDataProvider, options: ProviderSyncOptions) {
  if (!options.idempotencyKey.trim()) {
    throw new AppError(400, 'An idempotency key is required.', 'IDEMPOTENCY_KEY_REQUIRED');
  }
  const key = syncKey(provider.name, options.seasonId, options.type);
  const current = activeRuns.get(key);
  if (current) {
    if (current.idempotencyKey === options.idempotencyKey) return current.promise;
    return Promise.reject(
      new AppError(
        409,
        'A synchronization is already running for this provider scope.',
        'PROVIDER_SYNC_LOCKED',
      ),
    );
  }
  const run = runCore(provider, options).finally(() => activeRuns.delete(key));
  activeRuns.set(key, { idempotencyKey: options.idempotencyKey, promise: run });
  return run;
}

export function activeProviderSyncCount() {
  return activeRuns.size;
}
