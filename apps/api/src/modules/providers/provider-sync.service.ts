import { randomUUID } from 'node:crypto';
import {
  MatchStatus,
  Prisma,
  type ProviderEntityType,
  type ProviderSyncMode,
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
import { recomputePoolSeasonEngagement } from '../engagement/engagement.service.js';
import {
  type CompetitionDataProvider,
  type NormalizedMatch,
  type NormalizedResult,
  type NormalizedStanding,
  type NormalizedStructureEntity,
  type NormalizedTeam,
  type NormalizedTie,
  normalizedMatchArraySchema,
  normalizedResultArraySchema,
  normalizedStandingArraySchema,
  normalizedStructureArraySchema,
  normalizedTeamArraySchema,
  normalizedTieArraySchema,
} from './competition-data-provider.js';
import {
  chooseMatchIdentity,
  partitionDuplicateExternalIds,
  resultUpdateAllowed,
  uniqueGlobalClubCandidate,
  uniqueNameCandidate,
  valuesAfterManualOverride,
} from './provider-sync.logic.js';
import { checksum, redactProviderError } from './provider-utils.js';
import { recomputeTie } from '../ties/tie-recomputation.service.js';

const LOCK_TTL_MS = 2 * 60_000;

export interface ProviderSyncOptions {
  type: ProviderSyncType;
  seasonId: string;
  dryRun?: boolean;
  mode?: ProviderSyncMode;
  expectedChecksum?: string;
  idempotencyKey: string;
  requestedById?: string | null;
}

export interface ProviderSyncDiff {
  action: 'INSERT' | 'UPDATE' | 'MAP' | 'UNCHANGED' | 'QUARANTINE' | 'OVERRIDE_PRESERVED';
  entity: 'TEAM' | 'STAGE' | 'ROUND' | 'TIE' | 'MATCH' | 'RESULT' | 'STANDING';
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
  mode: ProviderSyncMode;
  status: 'SUCCESS' | 'PARTIAL' | 'DRY_RUN' | 'VERIFIED';
  source: string;
  collectedAt: string;
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

type ProviderItem =
  | NormalizedTeam
  | NormalizedStructureEntity
  | NormalizedTie
  | NormalizedMatch
  | NormalizedResult
  | NormalizedStanding;

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
    case 'STRUCTURE':
      if (!provider.syncStructure) return [];
      return normalizedStructureArraySchema.parse(await provider.syncStructure(context));
    case 'TIES':
      if (!provider.syncTies) return [];
      return normalizedTieArraySchema.parse(await provider.syncTies(context));
  }
}

function summaryFromRun(run: {
  id: string;
  provider: string;
  seasonId: string;
  type: ProviderSyncType;
  dryRun: boolean;
  mode: ProviderSyncMode;
  status: string;
  source: string;
  collectedAt: Date | null;
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
    mode: run.mode,
    status:
      run.status === 'DRY_RUN'
        ? 'DRY_RUN'
        : run.status === 'VERIFIED'
          ? 'VERIFIED'
          : run.status === 'PARTIAL'
            ? 'PARTIAL'
            : 'SUCCESS',
    source: run.source,
    collectedAt: (run.collectedAt ?? run.startedAt).toISOString(),
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

function syncMode(options: ProviderSyncOptions): ProviderSyncMode {
  return options.mode ?? (options.dryRun ? 'DRY_RUN' : 'APPLY');
}

function isReadOnlySync(options: ProviderSyncOptions) {
  return syncMode(options) !== 'APPLY';
}

function mappingScope(seasonId: string) {
  return `season:${seasonId}`;
}

function scopedExternalId(seasonId: string, externalId: string) {
  return `${mappingScope(seasonId)}:${externalId}`;
}

function providerJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function findProviderMapping(
  provider: string,
  seasonId: string,
  entityType: ProviderEntityType,
  rawExternalId: string,
) {
  return prisma.providerEntityMapping.findFirst({
    where: {
      provider,
      entityType,
      OR: [
        {
          scopeKey: mappingScope(seasonId),
          externalId: scopedExternalId(seasonId, rawExternalId),
        },
        { seasonId, externalId: rawExternalId },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
}

async function findGlobalTeamMapping(provider: string, seasonId: string, rawExternalId: string) {
  return prisma.providerEntityMapping.findFirst({
    where: {
      provider,
      entityType: 'TEAM',
      seasonId: { not: seasonId },
      metadata: { path: ['rawExternalId'], equals: rawExternalId },
    },
    orderBy: { createdAt: 'asc' },
  });
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
    scopeKey: mappingScope(options.seasonId),
    entityType,
    externalId: scopedExternalId(options.seasonId, externalId),
    internalId,
    seasonId: options.seasonId,
    sourceUrl: provider.source,
    collectedAt: new Date(),
    checksum: itemChecksum,
    metadata: { rawExternalId: externalId },
  } satisfies Prisma.ProviderEntityMappingUncheckedCreateInput;
}

async function resolveTeam(
  providerName: string,
  seasonId: string,
  externalId: string | undefined,
  name: string,
) {
  if (externalId) {
    const mapping = await findProviderMapping(providerName, seasonId, 'TEAM', externalId);
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
  const mapping = await findProviderMapping(
    provider.name,
    options.seasonId,
    'TEAM',
    team.externalId,
  );
  const seasonTeams = await prisma.seasonTeam.findMany({
    where: { seasonId: options.seasonId },
    select: { groupName: true, metadata: true, team: true },
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

  let reusedAcrossSeasons = false;
  if (!internal && !mapping) {
    const globalMapping = await findGlobalTeamMapping(
      provider.name,
      options.seasonId,
      team.externalId,
    );
    internal = globalMapping
      ? ((await prisma.team.findUnique({ where: { id: globalMapping.internalId } })) ?? undefined)
      : undefined;

    if (!internal) {
      const globalCandidates = await prisma.team.findMany({
        where: { type: 'CLUB' },
        select: { id: true, name: true, countryCode: true },
      });
      const resolution = uniqueGlobalClubCandidate(team.name, team.countryCode, globalCandidates);
      if (resolution.matches.length > 1) {
        const quarantine = {
          externalId: team.externalId,
          reason: 'AMBIGUOUS_NAME' as const,
          message: 'Normalized club name matched more than one compatible global team.',
          payload: team,
        };
        return { diff: quarantineDiff('TEAM', quarantine), quarantine };
      }
      internal = resolution.candidate
        ? ((await prisma.team.findUnique({ where: { id: resolution.candidate.id } })) ?? undefined)
        : undefined;
    }
    reusedAcrossSeasons = Boolean(internal);
  }

  if (!internal) {
    let eventId: string | undefined;
    if (!isReadOnlySync(options)) {
      const created = await prisma.$transaction(async (tx) => {
        const saved = await tx.team.create({
          data: {
            externalId: `${provider.name}:${options.seasonId}:team:${team.externalId}`,
            name: team.name,
            code: team.code,
            type: team.type,
            crestUrl: team.crestUrl,
            countryCode: team.countryCode,
            metadata: team.providerMetadata ? providerJson(team.providerMetadata) : undefined,
          },
        });
        await tx.seasonTeam.create({
          data: {
            seasonId: options.seasonId,
            teamId: saved.id,
            groupName: team.groupName,
            metadata: team.federation ? { federation: team.federation } : undefined,
          },
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
    if (!isReadOnlySync(options)) {
      await prisma.$transaction(async (tx) => {
        if (reusedAcrossSeasons) {
          await tx.seasonTeam.create({
            data: {
              seasonId: options.seasonId,
              teamId: internal!.id,
              groupName: team.groupName,
              metadata: team.federation ? { federation: team.federation } : undefined,
            },
          });
          if (!internal!.countryCode && team.countryCode) {
            await tx.team.update({
              where: { id: internal!.id },
              data: { countryCode: team.countryCode },
            });
          }
        }
        await tx.providerEntityMapping.create({
          data: mappingData(provider, options, 'TEAM', team.externalId, internal!.id, itemChecksum),
        });
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

  const providerOwnedExternalId = `${provider.name}:${options.seasonId}:team:${team.externalId}`;
  const preserveGlobalIdentity = internal.externalId !== providerOwnedExternalId;
  const changed =
    (!preserveGlobalIdentity &&
      (internal.name !== team.name ||
        (team.code !== undefined && internal.code !== team.code) ||
        (team.type !== undefined && internal.type !== team.type) ||
        (team.crestUrl !== undefined && internal.crestUrl !== team.crestUrl) ||
        (team.countryCode !== undefined && internal.countryCode !== team.countryCode))) ||
    seasonTeams.find((entry) => entry.team.id === internal!.id)?.groupName !==
      (team.groupName ?? null);
  let eventId: string | undefined;
  if (changed && !isReadOnlySync(options)) {
    eventId = await prisma.$transaction(async (tx) => {
      if (!preserveGlobalIdentity) {
        await tx.team.update({
          where: { id: internal!.id },
          data: {
            name: team.name,
            code: team.code,
            type: team.type,
            crestUrl: team.crestUrl,
            countryCode: team.countryCode,
            metadata: team.providerMetadata ? providerJson(team.providerMetadata) : undefined,
          },
        });
      }
      await tx.seasonTeam.update({
        where: { seasonId_teamId: { seasonId: options.seasonId, teamId: internal!.id } },
        data: {
          groupName: team.groupName ?? null,
          metadata: team.federation ? { federation: team.federation } : undefined,
        },
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

type PreviewStructureMapping = { internalId: string; stageType?: 'LEAGUE' | 'GROUP' | 'KNOCKOUT' };

async function processStructure(
  provider: CompetitionDataProvider,
  options: ProviderSyncOptions,
  incoming: NormalizedStructureEntity,
  previewMappings: Map<string, PreviewStructureMapping>,
): Promise<{ diff: ProviderSyncDiff; quarantine?: QuarantineInput; eventId?: string }> {
  const entityType = incoming.kind === 'STAGE' ? ('STAGE' as const) : ('ROUND' as const);
  const itemChecksum = checksum(incoming);
  const mapping = await findProviderMapping(
    provider.name,
    options.seasonId,
    entityType,
    incoming.externalId,
  );

  if (incoming.kind === 'STAGE') {
    const mapped = mapping
      ? await prisma.stage.findFirst({
          where: { id: mapping.internalId, seasonId: options.seasonId },
        })
      : null;
    if (mapping && !mapped) {
      const quarantine = {
        externalId: incoming.externalId,
        reason: 'INVALID_REFERENCE' as const,
        message: 'Stage mapping points outside the selected season.',
        payload: incoming,
      };
      return { diff: quarantineDiff('STAGE', quarantine), quarantine };
    }
    const candidates = mapping
      ? []
      : await prisma.stage.findMany({
          where: {
            seasonId: options.seasonId,
            OR: [{ slug: incoming.slug }, { order: incoming.order }],
          },
        });
    if (!mapping && candidates.length > 1) {
      const quarantine = {
        externalId: incoming.externalId,
        reason: 'AMBIGUOUS_STAGE' as const,
        message: 'Stage identity matched more than one season stage.',
        payload: incoming,
      };
      return { diff: quarantineDiff('STAGE', quarantine), quarantine };
    }
    const current = mapped ?? candidates[0] ?? null;
    const changed =
      Boolean(current) &&
      (current!.slug !== incoming.slug ||
        current!.name !== incoming.name ||
        current!.type !== incoming.type ||
        current!.order !== incoming.order ||
        checksum(current!.metadata ?? null) !== checksum(incoming.metadata ?? null));
    let internalId = current?.id;
    let eventId: string | undefined;
    if (!current && !isReadOnlySync(options)) {
      const created = await prisma.$transaction(async (tx) => {
        const stage = await tx.stage.create({
          data: {
            seasonId: options.seasonId,
            slug: incoming.slug,
            name: incoming.name,
            type: incoming.type,
            order: incoming.order,
            metadata: incoming.metadata as Prisma.InputJsonValue | undefined,
          },
        });
        await tx.providerEntityMapping.create({
          data: mappingData(
            provider,
            options,
            'STAGE',
            incoming.externalId,
            stage.id,
            itemChecksum,
          ),
        });
        const event = await enqueueOutboxEvent(tx, {
          type: 'competition.structure.updated',
          seasonId: options.seasonId,
          poolSeasonId: null,
          payload: { stageId: stage.id, provider: provider.name },
        });
        return { stage, eventId: event.id };
      });
      internalId = created.stage.id;
      eventId = created.eventId;
    } else if (current && changed && !isReadOnlySync(options)) {
      eventId = await prisma.$transaction(async (tx) => {
        await tx.stage.update({
          where: { id: current.id },
          data: {
            slug: incoming.slug,
            name: incoming.name,
            type: incoming.type,
            order: incoming.order,
            metadata: incoming.metadata as Prisma.InputJsonValue | undefined,
          },
        });
        if (mapping) {
          await tx.providerEntityMapping.update({
            where: { id: mapping.id },
            data: { checksum: itemChecksum, sourceUrl: provider.source, collectedAt: new Date() },
          });
        } else {
          await tx.providerEntityMapping.create({
            data: mappingData(
              provider,
              options,
              'STAGE',
              incoming.externalId,
              current.id,
              itemChecksum,
            ),
          });
        }
        return (
          await enqueueOutboxEvent(tx, {
            type: 'competition.structure.updated',
            seasonId: options.seasonId,
            poolSeasonId: null,
            payload: { stageId: current.id, provider: provider.name },
          })
        ).id;
      });
    } else if (current && !mapping && !isReadOnlySync(options)) {
      await prisma.providerEntityMapping.create({
        data: mappingData(
          provider,
          options,
          'STAGE',
          incoming.externalId,
          current.id,
          itemChecksum,
        ),
      });
    }
    previewMappings.set(incoming.externalId, {
      internalId: internalId ?? `preview:stage:${incoming.externalId}`,
      stageType: incoming.type,
    });
    return {
      diff: {
        action: !current ? 'INSERT' : changed ? 'UPDATE' : mapping ? 'UNCHANGED' : 'MAP',
        entity: 'STAGE',
        externalId: incoming.externalId,
        internalId,
        before: changed ? current : undefined,
        after: !current || changed ? incoming : undefined,
      },
      eventId,
    };
  }

  const stageMapping = previewMappings.get(incoming.stageExternalId);
  const resolvedStage =
    stageMapping ??
    (await findProviderMapping(
      provider.name,
      options.seasonId,
      'STAGE',
      incoming.stageExternalId,
    ).then((entry) =>
      entry ? ({ internalId: entry.internalId } satisfies PreviewStructureMapping) : null,
    ));
  if (!resolvedStage) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'AMBIGUOUS_STAGE' as const,
      message: 'Round stage has no unambiguous provider mapping.',
      payload: incoming,
    };
    return { diff: quarantineDiff('ROUND', quarantine), quarantine };
  }
  const mapped = mapping
    ? await prisma.round.findFirst({
        where: { id: mapping.internalId, seasonId: options.seasonId },
      })
    : null;
  if (mapping && !mapped) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'INVALID_REFERENCE' as const,
      message: 'Round mapping points outside the selected season.',
      payload: incoming,
    };
    return { diff: quarantineDiff('ROUND', quarantine), quarantine };
  }
  const candidates = mapping
    ? []
    : await prisma.round.findMany({
        where: {
          seasonId: options.seasonId,
          stageId: resolvedStage.internalId,
          OR: [{ order: incoming.order }, { name: incoming.name }],
        },
      });
  if (!mapping && candidates.length > 1) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'AMBIGUOUS_ROUND' as const,
      message: 'Round identity matched more than one stage round.',
      payload: incoming,
    };
    return { diff: quarantineDiff('ROUND', quarantine), quarantine };
  }
  const current = mapped ?? candidates[0] ?? null;
  const changed =
    Boolean(current) &&
    (current!.stageId !== resolvedStage.internalId ||
      current!.name !== incoming.name ||
      current!.order !== incoming.order ||
      current!.status !== incoming.status ||
      (current!.startsAt?.getTime() ?? null) !==
        (incoming.startsAt ? new Date(incoming.startsAt).getTime() : null) ||
      (current!.endsAt?.getTime() ?? null) !==
        (incoming.endsAt ? new Date(incoming.endsAt).getTime() : null) ||
      checksum(current!.metadata ?? null) !== checksum(incoming.metadata ?? null));
  let internalId = current?.id;
  let eventId: string | undefined;
  if (!current && !isReadOnlySync(options)) {
    const created = await prisma.$transaction(async (tx) => {
      const round = await tx.round.create({
        data: {
          seasonId: options.seasonId,
          stageId: resolvedStage.internalId,
          name: incoming.name,
          order: incoming.order,
          status: incoming.status,
          startsAt: incoming.startsAt ? new Date(incoming.startsAt) : null,
          endsAt: incoming.endsAt ? new Date(incoming.endsAt) : null,
          metadata: incoming.metadata as Prisma.InputJsonValue | undefined,
        },
      });
      await tx.providerEntityMapping.create({
        data: mappingData(provider, options, 'ROUND', incoming.externalId, round.id, itemChecksum),
      });
      const event = await enqueueOutboxEvent(tx, {
        type: 'competition.structure.updated',
        seasonId: options.seasonId,
        poolSeasonId: null,
        payload: { roundId: round.id, provider: provider.name },
      });
      return { round, eventId: event.id };
    });
    internalId = created.round.id;
    eventId = created.eventId;
  } else if (current && changed && !isReadOnlySync(options)) {
    eventId = await prisma.$transaction(async (tx) => {
      await tx.round.update({
        where: { id: current.id },
        data: {
          stageId: resolvedStage.internalId,
          name: incoming.name,
          order: incoming.order,
          status: incoming.status,
          startsAt: incoming.startsAt ? new Date(incoming.startsAt) : null,
          endsAt: incoming.endsAt ? new Date(incoming.endsAt) : null,
          metadata: incoming.metadata as Prisma.InputJsonValue | undefined,
        },
      });
      if (mapping) {
        await tx.providerEntityMapping.update({
          where: { id: mapping.id },
          data: { checksum: itemChecksum, sourceUrl: provider.source, collectedAt: new Date() },
        });
      } else {
        await tx.providerEntityMapping.create({
          data: mappingData(
            provider,
            options,
            'ROUND',
            incoming.externalId,
            current.id,
            itemChecksum,
          ),
        });
      }
      return (
        await enqueueOutboxEvent(tx, {
          type: 'competition.structure.updated',
          seasonId: options.seasonId,
          poolSeasonId: null,
          payload: { roundId: current.id, provider: provider.name },
        })
      ).id;
    });
  } else if (current && !mapping && !isReadOnlySync(options)) {
    await prisma.providerEntityMapping.create({
      data: mappingData(provider, options, 'ROUND', incoming.externalId, current.id, itemChecksum),
    });
  }
  previewMappings.set(incoming.externalId, {
    internalId: internalId ?? `preview:round:${incoming.externalId}`,
  });
  return {
    diff: {
      action: !current ? 'INSERT' : changed ? 'UPDATE' : mapping ? 'UNCHANGED' : 'MAP',
      entity: 'ROUND',
      externalId: incoming.externalId,
      internalId,
      before: changed ? current : undefined,
      after: !current || changed ? incoming : undefined,
    },
    eventId,
  };
}

async function processTie(
  provider: CompetitionDataProvider,
  options: ProviderSyncOptions,
  incoming: NormalizedTie,
): Promise<{ diff: ProviderSyncDiff; quarantine?: QuarantineInput; eventId?: string }> {
  const [teamA, teamB, stage, round] = await Promise.all([
    resolveTeam(provider.name, options.seasonId, incoming.teamAExternalId, incoming.teamAName),
    resolveTeam(provider.name, options.seasonId, incoming.teamBExternalId, incoming.teamBName),
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
  if (!teamA.id || !teamB.id || teamA.id === teamB.id) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'AMBIGUOUS_TEAM' as const,
      message: 'Tie participants do not resolve to two unambiguous season teams.',
      payload: incoming,
    };
    return { diff: quarantineDiff('TIE', quarantine), quarantine };
  }
  if (!stage.internalId || stage.missing) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'AMBIGUOUS_STAGE' as const,
      message: 'Tie stage has no unambiguous provider mapping.',
      payload: incoming,
    };
    return { diff: quarantineDiff('TIE', quarantine), quarantine };
  }
  if (!round.internalId || round.missing) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'AMBIGUOUS_ROUND' as const,
      message: 'Tie round has no unambiguous provider mapping.',
      payload: incoming,
    };
    return { diff: quarantineDiff('TIE', quarantine), quarantine };
  }
  const stageRecord = await prisma.stage.findFirst({
    where: { id: stage.internalId, seasonId: options.seasonId, type: 'KNOCKOUT' },
    select: { id: true },
  });
  const roundRecord = await prisma.round.findFirst({
    where: { id: round.internalId, seasonId: options.seasonId, stageId: stage.internalId },
    select: { id: true },
  });
  if (!stageRecord || !roundRecord) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: !stageRecord ? ('AMBIGUOUS_STAGE' as const) : ('AMBIGUOUS_ROUND' as const),
      message: !stageRecord
        ? 'Tie stage is not a knockout stage in this season.'
        : 'Tie round does not belong to the selected knockout stage.',
      payload: incoming,
    };
    return { diff: quarantineDiff('TIE', quarantine), quarantine };
  }

  let providerWinnerTeamId: string | null = null;
  if (incoming.status === 'DECIDED') {
    const winner = await resolveTeam(
      provider.name,
      options.seasonId,
      incoming.winnerTeamExternalId,
      incoming.winnerTeamExternalId === incoming.teamAExternalId
        ? incoming.teamAName
        : incoming.winnerTeamExternalId === incoming.teamBExternalId
          ? incoming.teamBName
          : '__unresolved_qualifier__',
    );
    if (!winner.id || ![teamA.id, teamB.id].includes(winner.id)) {
      const quarantine = {
        externalId: incoming.externalId,
        reason: 'AMBIGUOUS_QUALIFIER' as const,
        message: 'Declared qualifier has no unambiguous participant mapping.',
        payload: incoming,
      };
      return { diff: quarantineDiff('TIE', quarantine), quarantine };
    }
    providerWinnerTeamId = winner.id;
  }

  const mapping = await findProviderMapping(
    provider.name,
    options.seasonId,
    'TIE',
    incoming.externalId,
  );
  const mapped = mapping
    ? await prisma.tie.findFirst({ where: { id: mapping.internalId, seasonId: options.seasonId } })
    : null;
  if (mapping && !mapped) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'INVALID_REFERENCE' as const,
      message: 'Tie mapping points outside the selected season.',
      payload: incoming,
    };
    return { diff: quarantineDiff('TIE', quarantine), quarantine };
  }
  const candidates = mapping
    ? []
    : await prisma.tie.findMany({
        where: {
          seasonId: options.seasonId,
          roundId: round.internalId,
          OR: [
            { teamAId: teamA.id, teamBId: teamB.id },
            { teamAId: teamB.id, teamBId: teamA.id },
          ],
        },
      });
  if (!mapping && candidates.length > 1) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'AMBIGUOUS_TIE' as const,
      message: 'Participant fallback matched more than one tie.',
      payload: incoming,
    };
    return { diff: quarantineDiff('TIE', quarantine), quarantine };
  }
  const current = mapped ?? candidates[0] ?? null;
  if (
    current?.status === 'DECIDED' &&
    providerWinnerTeamId &&
    current.winnerTeamId !== providerWinnerTeamId
  ) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'CONFLICT' as const,
      message: 'Provider qualifier conflicts with the currently recomputed tie winner.',
      payload: incoming,
    };
    return { diff: quarantineDiff('TIE', quarantine), quarantine };
  }
  const manualDecision =
    incoming.status === 'DECIDED' &&
    providerWinnerTeamId &&
    (incoming.decisionMethod === 'WALKOVER' || incoming.decisionMethod === 'ADMINISTRATIVE');
  const automaticDecisionEvidence =
    incoming.status === 'DECIDED' && !manualDecision
      ? {
          providerWinnerTeamId,
          providerDecisionMethod: incoming.decisionMethod,
          requiresResultVerification: true,
        }
      : {};
  const desiredStatus =
    current?.status === 'DECIDED'
      ? current.status
      : manualDecision
        ? 'DECIDED'
        : incoming.status === 'CANCELLED'
          ? 'CANCELLED'
          : (current?.status ?? 'SCHEDULED');
  const desiredWinner = manualDecision ? providerWinnerTeamId : (current?.winnerTeamId ?? null);
  const desiredMethod = manualDecision
    ? incoming.decisionMethod!
    : (current?.decisionMethod ?? null);
  const desiredDecidedAt = manualDecision ? (current?.decidedAt ?? new Date()) : current?.decidedAt;
  const desiredMetadata = {
    ...(current?.metadata &&
    typeof current.metadata === 'object' &&
    !Array.isArray(current.metadata)
      ? (current.metadata as Record<string, unknown>)
      : {}),
    ...(incoming.metadata ?? {}),
    ...automaticDecisionEvidence,
  };
  const changed =
    Boolean(current) &&
    (current!.stageId !== stage.internalId ||
      current!.roundId !== round.internalId ||
      current!.key !== incoming.key ||
      current!.order !== incoming.order ||
      current!.expectedLegs !== incoming.expectedLegs ||
      current!.status !== desiredStatus ||
      current!.winnerTeamId !== desiredWinner ||
      current!.decisionMethod !== desiredMethod ||
      current!.provenance !== incoming.provenance ||
      checksum(current!.metadata ?? null) !== checksum(desiredMetadata));
  const itemChecksum = checksum(incoming);
  let internalId = current?.id;
  let eventId: string | undefined;
  if (!current && !isReadOnlySync(options)) {
    const created = await prisma.$transaction(async (tx) => {
      const tie = await tx.tie.create({
        data: {
          seasonId: options.seasonId,
          stageId: stage.internalId!,
          roundId: round.internalId!,
          key: incoming.key,
          order: incoming.order,
          teamAId: teamA.id!,
          teamBId: teamB.id!,
          expectedLegs: incoming.expectedLegs,
          status: manualDecision
            ? 'DECIDED'
            : incoming.status === 'CANCELLED'
              ? 'CANCELLED'
              : 'SCHEDULED',
          decisionMethod: manualDecision ? incoming.decisionMethod : null,
          winnerTeamId: manualDecision ? providerWinnerTeamId : null,
          decidedAt: manualDecision ? new Date() : null,
          provenance: incoming.provenance,
          metadata: desiredMetadata,
        },
      });
      await tx.providerEntityMapping.create({
        data: mappingData(provider, options, 'TIE', incoming.externalId, tie.id, itemChecksum),
      });
      const event = await enqueueOutboxEvent(tx, {
        type: 'tie.updated',
        seasonId: options.seasonId,
        poolSeasonId: null,
        payload: { tieId: tie.id, provider: provider.name },
      });
      return { tie, eventId: event.id };
    });
    internalId = created.tie.id;
    eventId = created.eventId;
  } else if (current && changed && !isReadOnlySync(options)) {
    eventId = await prisma.$transaction(async (tx) => {
      await tx.tie.update({
        where: { id: current.id },
        data: {
          stageId: stage.internalId!,
          roundId: round.internalId!,
          key: incoming.key,
          order: incoming.order,
          expectedLegs: incoming.expectedLegs,
          status: desiredStatus,
          decisionMethod: desiredMethod,
          winnerTeamId: desiredWinner,
          decidedAt: desiredDecidedAt,
          provenance: incoming.provenance,
          metadata: desiredMetadata,
        },
      });
      if (mapping) {
        await tx.providerEntityMapping.update({
          where: { id: mapping.id },
          data: { checksum: itemChecksum, sourceUrl: provider.source, collectedAt: new Date() },
        });
      } else {
        await tx.providerEntityMapping.create({
          data: mappingData(
            provider,
            options,
            'TIE',
            incoming.externalId,
            current.id,
            itemChecksum,
          ),
        });
      }
      return (
        await enqueueOutboxEvent(tx, {
          type: 'tie.updated',
          seasonId: options.seasonId,
          poolSeasonId: null,
          payload: { tieId: current.id, provider: provider.name },
        })
      ).id;
    });
  } else if (current && !mapping && !isReadOnlySync(options)) {
    await prisma.providerEntityMapping.create({
      data: mappingData(provider, options, 'TIE', incoming.externalId, current.id, itemChecksum),
    });
  }
  return {
    diff: {
      action: !current ? 'INSERT' : changed ? 'UPDATE' : mapping ? 'UNCHANGED' : 'MAP',
      entity: 'TIE',
      externalId: incoming.externalId,
      internalId,
      before: changed ? current : undefined,
      after: !current || changed ? incoming : undefined,
      reason:
        incoming.status === 'DECIDED' && !manualDecision
          ? 'Sporting qualifier is evidence only until match results recompute the tie.'
          : undefined,
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
  const mapping = await findProviderMapping(providerName, seasonId, entityType, externalId);
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
  if (!incoming.kickoffConfirmed) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'AMBIGUOUS_KICKOFF' as const,
      message: 'Schedule kickoff is not officially confirmed.',
      payload: incoming,
    };
    return { diff: quarantineDiff('MATCH', quarantine), quarantine };
  }
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
  const tieMapping = incoming.tieExternalId
    ? await findProviderMapping(provider.name, options.seasonId, 'TIE', incoming.tieExternalId)
    : null;
  const tie = tieMapping
    ? await prisma.tie.findFirst({
        where: { id: tieMapping.internalId, seasonId: options.seasonId },
      })
    : null;
  if (incoming.tieExternalId && (!tie || !incoming.legNumber)) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'AMBIGUOUS_TIE' as const,
      message: 'Schedule tie or leg has no unambiguous season mapping.',
      payload: incoming,
    };
    return { diff: quarantineDiff('MATCH', quarantine), quarantine };
  }
  if (
    tie &&
    (tie.stageId !== stage.internalId ||
      tie.roundId !== round.internalId ||
      ![tie.teamAId, tie.teamBId].includes(teams.home.id!) ||
      ![tie.teamAId, tie.teamBId].includes(teams.away.id!))
  ) {
    const quarantine = {
      externalId: incoming.externalId,
      reason: 'CONFLICT' as const,
      message: 'Schedule leg conflicts with its tie context.',
      payload: incoming,
    };
    return { diff: quarantineDiff('MATCH', quarantine), quarantine };
  }
  const mapping = await findProviderMapping(
    provider.name,
    options.seasonId,
    'MATCH',
    incoming.externalId,
  );
  const fallbackCandidates = mapping
    ? []
    : await prisma.match.findMany({
        where: {
          seasonId: options.seasonId,
          ...(tie
            ? { tieId: tie.id, legNumber: incoming.legNumber }
            : { homeTeamId: teams.home.id, awayTeamId: teams.away.id }),
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
    if (!isReadOnlySync(options)) {
      const created = await prisma.$transaction(async (tx) => {
        const matchDay = await ensureMatchDay(tx, options.seasonId, startsAt);
        const saved = await tx.match.create({
          data: {
            externalId: `${provider.name}:${options.seasonId}:match:${incoming.externalId}`,
            matchDayId: matchDay.id,
            seasonId: options.seasonId,
            stageId: stage.internalId,
            roundId: round.internalId,
            tieId: tie?.id,
            legNumber: incoming.legNumber,
            homeTeamId: teams.home.id!,
            awayTeamId: teams.away.id!,
            startsAt,
            predictionClosesAt: new Date(startsAt.getTime() - 5 * 60_000),
            status: tie && incoming.status === 'FINISHED' ? 'SCHEDULED' : incoming.status,
            venueName: incoming.venue?.name,
            venueCity: incoming.venue?.city,
            venueCountryCode: incoming.venue?.countryCode,
            rawPayload: providerJson({
              providerSchedule: incoming,
              source: provider.source,
              checksum: itemChecksum,
              ...(incoming.groupName ? { group: incoming.groupName } : {}),
            }),
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
    status:
      tie && incoming.status === 'FINISHED' && current.regulationHomeScore == null
        ? current.status
        : resultUpdateAllowed(current.status, incoming.status)
          ? incoming.status
          : current.status,
    homeTeamId: teams.home.id,
    awayTeamId: teams.away.id,
    stageId: stage.internalId,
    roundId: round.internalId,
    tieId: tie?.id ?? null,
    legNumber: incoming.legNumber ?? null,
    venueName: incoming.venue?.name ?? null,
    venueCity: incoming.venue?.city ?? null,
    venueCountryCode: incoming.venue?.countryCode ?? null,
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
    current.roundId !== effective.roundId ||
    current.tieId !== effective.tieId ||
    current.legNumber !== effective.legNumber ||
    current.venueName !== effective.venueName ||
    current.venueCity !== effective.venueCity ||
    current.venueCountryCode !== effective.venueCountryCode;
  let eventId: string | undefined;
  if (changed && !isReadOnlySync(options)) {
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
          tieId: effective.tieId ? String(effective.tieId) : null,
          legNumber: effective.legNumber ? Number(effective.legNumber) : null,
          venueName: effective.venueName ? String(effective.venueName) : null,
          venueCity: effective.venueCity ? String(effective.venueCity) : null,
          venueCountryCode: effective.venueCountryCode ? String(effective.venueCountryCode) : null,
          rawPayload: providerJson({
            ...(current!.rawPayload &&
            typeof current!.rawPayload === 'object' &&
            !Array.isArray(current!.rawPayload)
              ? (current!.rawPayload as Record<string, unknown>)
              : {}),
            providerSchedule: incoming,
            source: provider.source,
            scheduleChecksum: itemChecksum,
            ...(incoming.groupName ? { group: incoming.groupName } : {}),
            manualOverrideApplied: Boolean(overrideValues),
          }),
          lastSyncedAt: new Date(),
        },
      });
      if (mapping) {
        await tx.providerEntityMapping.update({
          where: { id: mapping.id },
          data: {
            internalId: current!.id,
            seasonId: options.seasonId,
            sourceUrl: provider.source,
            checksum: itemChecksum,
            collectedAt: new Date(),
          },
        });
      } else {
        await tx.providerEntityMapping.create({
          data: mappingData(
            provider,
            options,
            'MATCH',
            incoming.externalId,
            current!.id,
            itemChecksum,
          ),
        });
      }
      return (
        await enqueueOutboxEvent(tx, {
          type: 'match.schedule.updated',
          seasonId: options.seasonId,
          poolSeasonId: null,
          payload: { matchId: current!.id, provider: provider.name },
        })
      ).id;
    });
  } else if (!mapping && !isReadOnlySync(options)) {
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
  const mapping = await findProviderMapping(
    provider.name,
    options.seasonId,
    'MATCH',
    matchExternalId,
  );
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
  tieId?: string;
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
    finalHomeScore:
      incoming.status === 'FINISHED'
        ? (incoming.regulationHomeScore ?? incoming.homeScore)
        : current.finalHomeScore,
    finalAwayScore:
      incoming.status === 'FINISHED'
        ? (incoming.regulationAwayScore ?? incoming.awayScore)
        : current.finalAwayScore,
    regulationHomeScore:
      incoming.status === 'SCHEDULED' ? null : (incoming.regulationHomeScore ?? incoming.homeScore),
    regulationAwayScore:
      incoming.status === 'SCHEDULED' ? null : (incoming.regulationAwayScore ?? incoming.awayScore),
    extraTimeHomeScore: incoming.extraTimeHomeScore ?? null,
    extraTimeAwayScore: incoming.extraTimeAwayScore ?? null,
    penaltyHomeScore: incoming.penaltyHomeScore ?? null,
    penaltyAwayScore: incoming.penaltyAwayScore ?? null,
  };
  const effective = valuesAfterManualOverride(synchronized, overrideValues);
  const changed =
    current.status !== effective.status ||
    current.homeScore !== effective.homeScore ||
    current.awayScore !== effective.awayScore ||
    current.finalHomeScore !== effective.finalHomeScore ||
    current.finalAwayScore !== effective.finalAwayScore ||
    current.regulationHomeScore !== effective.regulationHomeScore ||
    current.regulationAwayScore !== effective.regulationAwayScore ||
    current.extraTimeHomeScore !== effective.extraTimeHomeScore ||
    current.extraTimeAwayScore !== effective.extraTimeAwayScore ||
    current.penaltyHomeScore !== effective.penaltyHomeScore ||
    current.penaltyAwayScore !== effective.penaltyAwayScore;
  let eventId: string | undefined;
  if (changed && !isReadOnlySync(options)) {
    eventId = await prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id: current.id },
        data: {
          status: effective.status as MatchStatus,
          homeScore: effective.homeScore as number | null,
          awayScore: effective.awayScore as number | null,
          finalHomeScore: effective.finalHomeScore as number | null,
          finalAwayScore: effective.finalAwayScore as number | null,
          regulationHomeScore: effective.regulationHomeScore as number | null,
          regulationAwayScore: effective.regulationAwayScore as number | null,
          extraTimeHomeScore: effective.extraTimeHomeScore as number | null,
          extraTimeAwayScore: effective.extraTimeAwayScore as number | null,
          penaltyHomeScore: effective.penaltyHomeScore as number | null,
          penaltyAwayScore: effective.penaltyAwayScore as number | null,
          lastSyncedAt: new Date(),
          rawPayload: providerJson({
            ...(current.rawPayload &&
            typeof current.rawPayload === 'object' &&
            !Array.isArray(current.rawPayload)
              ? (current.rawPayload as Record<string, unknown>)
              : {}),
            providerResult: incoming,
            source: provider.source,
            resultChecksum: checksum(incoming),
            manualOverrideApplied: Boolean(overrideValues),
          }),
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
            regulationHomeScore: current.regulationHomeScore,
            regulationAwayScore: current.regulationAwayScore,
            extraTimeHomeScore: current.extraTimeHomeScore,
            extraTimeAwayScore: current.extraTimeAwayScore,
            penaltyHomeScore: current.penaltyHomeScore,
            penaltyAwayScore: current.penaltyAwayScore,
          }
        : undefined,
      after: changed ? effective : undefined,
      reason: overrideValues ? 'Active manual override has precedence.' : undefined,
    },
    eventId,
    scoreMatchId: changed && !isReadOnlySync(options) ? current.id : undefined,
    tieId: changed && !isReadOnlySync(options) ? (current.tieId ?? undefined) : undefined,
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
  if (changed && !isReadOnlySync(options)) {
    eventId = await prisma.$transaction(async (tx) => {
      const storedValue = providerJson(value);
      await tx.appSetting.upsert({
        where: { key },
        create: { key, value: storedValue },
        update: { value: storedValue },
      });
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
  const mode = syncMode(options);
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
          mode,
          idempotencyKey: options.idempotencyKey,
          dryRun: isReadOnlySync(options),
          source: provider.source,
          requestedById: options.requestedById,
        },
      }));
    runId = run.id;
    const fetched = await providerItems(provider, options);
    const batchChecksum = checksum(fetched);
    if (options.expectedChecksum && options.expectedChecksum !== batchChecksum) {
      throw new AppError(
        409,
        'Provider payload checksum differs from the pinned verification checksum.',
        'PROVIDER_CHECKSUM_MISMATCH',
      );
    }
    const evidence = await provider.snapshotEvidence?.();
    if (evidence && evidence.provider !== provider.name) {
      throw new AppError(
        422,
        'Provider snapshot evidence belongs to another provider.',
        'PROVIDER_SNAPSHOT_SCOPE_MISMATCH',
      );
    }
    const collectedAt = evidence ? new Date(evidence.collectedAt) : new Date();
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
          : options.type === 'STRUCTURE'
            ? 'STAGE'
            : options.type === 'TIES'
              ? 'TIE'
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
    const tieIds = new Set<string>();
    const previewStructureMappings = new Map<string, PreviewStructureMapping>();
    const accepted =
      options.type === 'STRUCTURE'
        ? [...partitioned.accepted].sort((left, right) => {
            const leftKind = (left as NormalizedStructureEntity).kind;
            const rightKind = (right as NormalizedStructureEntity).kind;
            return leftKind === rightKind ? 0 : leftKind === 'STAGE' ? -1 : 1;
          })
        : partitioned.accepted;

    for (const item of accepted) {
      const processed: {
        diff: ProviderSyncDiff;
        quarantine?: QuarantineInput;
        eventId?: string;
        scoreMatchId?: string;
        tieId?: string;
      } =
        options.type === 'TEAMS'
          ? await processTeam(provider, options, item as NormalizedTeam)
          : options.type === 'STRUCTURE'
            ? await processStructure(
                provider,
                options,
                item as NormalizedStructureEntity,
                previewStructureMappings,
              )
            : options.type === 'TIES'
              ? await processTie(provider, options, item as NormalizedTie)
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
      if ('tieId' in processed && processed.tieId) tieIds.add(processed.tieId);
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
    if (
      mode === 'VERIFY' &&
      (quarantines.length > 0 ||
        diff.some((item) => ['INSERT', 'UPDATE', 'MAP'].includes(item.action)))
    ) {
      throw new AppError(
        409,
        'Provider verification found unapplied differences or quarantined data.',
        'PROVIDER_VERIFY_FAILED',
      );
    }
    const status =
      mode === 'VERIFY'
        ? 'VERIFIED'
        : isReadOnlySync(options)
          ? 'DRY_RUN'
          : quarantines.length > 0
            ? 'PARTIAL'
            : 'SUCCESS';
    const finishedAt = new Date();
    await prisma.providerSyncRun.update({
      where: { id: run.id },
      data: {
        status,
        mode,
        collectedAt,
        checksum: batchChecksum,
        fetchedCount: counts.fetched,
        insertedCount: counts.inserted,
        updatedCount: counts.updated,
        unchangedCount: counts.unchanged,
        quarantinedCount: counts.quarantined,
        finishedAt,
      },
    });
    for (const tieId of tieIds) await recomputeTie(tieId);
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
        await recomputePoolSeasonEngagement(poolSeason.id);
      }
    }
    for (const eventId of eventIds) await dispatchOutboxEvent(eventId);
    return {
      runId: run.id,
      provider: provider.name,
      seasonId: options.seasonId,
      type: options.type,
      mode,
      dryRun: isReadOnlySync(options),
      status,
      source: provider.source,
      collectedAt: collectedAt.toISOString(),
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
