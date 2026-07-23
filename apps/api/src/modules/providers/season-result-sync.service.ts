import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';
import { getScoreSyncSetting } from '../../services/score-sync-settings.service.js';
import { dispatchOutboxEvent, enqueueOutboxEvent } from '../events/outbox.js';
import { getCompetitionFeatureFlags } from '../competitions/competition-feature.service.js';
import { seasonProviderRegistry, type ProviderRuntime } from './provider-registry.js';
import { resolveProviderCadence, type SeasonMatchSignal } from './provider-cadence.js';
import { redactProviderError } from './provider-utils.js';
import { runProviderSync, type ProviderSyncSummary } from './provider-sync.service.js';
import {
  getSeasonRuntimeConfig,
  listActiveSeasonRuntimeConfigs,
  type ConfiguredProviderType,
  type SeasonProviderRuntimeConfig,
} from './season-runtime-config.js';

const USER_COOLDOWN_MS = 30_000;
const RESULTS_SYNC_TIMEOUT_MS = 60_000;
const FULL_SYNC_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () =>
        reject(
          new AppError(504, 'A fonte oficial demorou demais para responder.', 'PROVIDER_TIMEOUT'),
        ),
      timeoutMs,
    );
    timeout.unref?.();
  });
  return Promise.race([promise, expired]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function publicSummary(summary: ProviderSyncSummary) {
  return {
    runId: summary.runId,
    provider: summary.provider,
    type: summary.type,
    status: summary.status,
    source: summary.source,
    collectedAt: summary.collectedAt,
    checksum: summary.checksum,
    counts: summary.counts,
    reused: summary.reused ?? false,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
  };
}

function changedCount(summary: ProviderSyncSummary) {
  return summary.counts.inserted + summary.counts.updated;
}

function changedMatchIds(summary: ProviderSyncSummary) {
  return summary.diff.flatMap((item) =>
    item.entity === 'RESULT' && item.action === 'UPDATE' && item.internalId
      ? [item.internalId]
      : [],
  );
}

async function configuredProviders(
  seasonId: string,
  requestedTypes: readonly ConfiguredProviderType[],
  providerKeys?: readonly string[],
) {
  const runtime = await getSeasonRuntimeConfig(seasonId);
  const providers = runtime.providers.filter(
    (provider) =>
      (!providerKeys || providerKeys.includes(provider.key)) &&
      provider.types.some((type) => requestedTypes.includes(type)),
  );
  if (!providers.length) {
    throw new AppError(
      400,
      'Esta temporada nao possui sincronizacao publica configurada.',
      'SEASON_PROVIDER_NOT_CONFIGURED',
    );
  }
  return providers;
}

async function assertUserCooldown(input: {
  seasonId: string;
  providerKey: string;
  userId?: string | null;
  idempotencyKey: string;
}) {
  if (!input.userId) return;
  const exactRun = await prisma.providerSyncRun.findUnique({
    where: {
      provider_seasonId_type_idempotencyKey: {
        provider: input.providerKey,
        seasonId: input.seasonId,
        type: 'RESULTS',
        idempotencyKey: `${input.idempotencyKey}:results`,
      },
    },
    select: { id: true },
  });
  if (exactRun) return;

  const recent = await prisma.providerSyncRun.findFirst({
    where: {
      seasonId: input.seasonId,
      provider: input.providerKey,
      type: 'RESULTS',
      requestedById: input.userId,
      startedAt: { gt: new Date(Date.now() - USER_COOLDOWN_MS) },
    },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  });
  if (recent) {
    throw new AppError(
      429,
      'Aguarde alguns segundos antes de sincronizar novamente.',
      'PROVIDER_SYNC_COOLDOWN',
    );
  }
}

async function emitCompetitionSyncEvents(input: {
  seasonId: string;
  providerKey: string;
  results: ProviderSyncSummary;
  runs: ProviderSyncSummary[];
  profileCount?: number;
}) {
  const matchIds = changedMatchIds(input.results);
  const changedMatches = changedCount(input.results);
  const eventIds = await prisma.$transaction(async (tx) => {
    const matchEvent = await enqueueOutboxEvent(tx, {
      type: 'match.updated',
      seasonId: input.seasonId,
      poolSeasonId: null,
      payload: { matchIds, provider: input.providerKey, changedMatches },
      idempotencyKey: `match.updated:${input.seasonId}:${input.results.runId}`,
    });
    const completedEvent = await enqueueOutboxEvent(tx, {
      type: 'provider.sync.completed',
      seasonId: input.seasonId,
      poolSeasonId: null,
      payload: {
        provider: input.providerKey,
        changedMatches,
        profileCount: input.profileCount ?? 0,
        runs: input.runs.map((run) => ({ type: run.type, runId: run.runId })),
      },
      idempotencyKey: `provider.sync.completed:${input.seasonId}:${input.results.runId}`,
    });
    return [matchEvent.id, completedEvent.id];
  });
  for (const eventId of eventIds) await dispatchOutboxEvent(eventId);
  return changedMatches;
}

interface ProviderExecution {
  config: SeasonProviderRuntimeConfig;
  runtime: ProviderRuntime;
  runs: ProviderSyncSummary[];
  profiles: unknown[];
  supplemental: unknown | null;
  evidence: unknown | null;
  warnings: Array<{ scope: 'TEAM_PROFILES'; message: string }>;
}

async function runConfiguredProvider(input: {
  config: SeasonProviderRuntimeConfig;
  seasonId: string;
  userId?: string | null;
  idempotencyKey: string;
  requestedTypes: readonly ConfiguredProviderType[];
  includeProfiles?: boolean;
}): Promise<ProviderExecution> {
  const runtime = seasonProviderRegistry.create(input.config);
  const types = (
    ['TEAMS', 'STRUCTURE', 'TIES', 'SCHEDULE', 'RESULTS', 'STANDINGS'] as const
  ).filter((type) => input.config.types.includes(type) && input.requestedTypes.includes(type));
  const runs: ProviderSyncSummary[] = [];
  for (const type of types) {
    runs.push(
      await runProviderSync(runtime.provider, {
        type,
        seasonId: input.seasonId,
        idempotencyKey: `${input.idempotencyKey}:${type.toLowerCase()}`,
        requestedById: input.userId ?? null,
      }),
    );
  }
  let profiles: unknown[] = [];
  const warnings: ProviderExecution['warnings'] = [];
  if (input.includeProfiles && input.config.includeProfiles && runtime.importProfiles) {
    try {
      profiles = await runtime.importProfiles(input.seasonId);
    } catch (error) {
      warnings.push({ scope: 'TEAM_PROFILES', message: redactProviderError(error) });
    }
  }
  const evidence = runtime.evidence ? await runtime.evidence() : null;
  const supplemental = runtime.afterSync ? await runtime.afterSync(input.seasonId) : null;
  return { config: input.config, runtime, runs, profiles, supplemental, evidence, warnings };
}

async function runConfiguredSeasonSync(input: {
  seasonId: string;
  userId?: string | null;
  idempotencyKey: string;
  requestedTypes: readonly ConfiguredProviderType[];
  providerKeys?: readonly string[];
  includeProfiles?: boolean;
}) {
  const providers = await configuredProviders(
    input.seasonId,
    input.requestedTypes,
    input.providerKeys,
  );
  for (const provider of providers) {
    await assertUserCooldown({
      seasonId: input.seasonId,
      providerKey: provider.key,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
    });
  }
  const executions: ProviderExecution[] = [];
  for (const provider of providers) {
    executions.push(await runConfiguredProvider({ ...input, config: provider }));
  }
  return executions;
}

export async function getSeasonResultSyncStatus(seasonId: string) {
  const runtime = await getSeasonRuntimeConfig(seasonId);
  const providerKeys = runtime.providers
    .filter((provider) => provider.types.includes('RESULTS'))
    .map((provider) => provider.key);
  if (!providerKeys.length) {
    return { status: 'NEVER' as const, lastSyncedAt: null, changedMatches: 0 };
  }
  const latest = await prisma.providerSyncRun.findFirst({
    where: {
      seasonId,
      provider: { in: providerKeys },
      type: 'RESULTS',
      status: { not: 'RUNNING' },
      mode: 'APPLY',
    },
    orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
    select: { status: true, finishedAt: true, updatedCount: true, insertedCount: true },
  });
  return {
    status: latest?.status ?? 'NEVER',
    lastSyncedAt: latest?.finishedAt?.toISOString() ?? null,
    changedMatches: (latest?.updatedCount ?? 0) + (latest?.insertedCount ?? 0),
  };
}

export async function syncOfficialSeasonResults(input: {
  seasonId: string;
  userId: string;
  idempotencyKey: string;
}) {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) {
    throw new AppError(400, 'Informe uma chave de idempotencia.', 'IDEMPOTENCY_KEY_REQUIRED');
  }
  const executions = await withTimeout(
    runConfiguredSeasonSync({
      ...input,
      idempotencyKey,
      requestedTypes: ['RESULTS', 'STANDINGS'],
    }),
    RESULTS_SYNC_TIMEOUT_MS,
  );
  let changedMatches = 0;
  for (const execution of executions) {
    const results = execution.runs.find((run) => run.type === 'RESULTS');
    if (!results) continue;
    changedMatches += await emitCompetitionSyncEvents({
      seasonId: input.seasonId,
      providerKey: execution.config.key,
      results,
      runs: execution.runs,
    });
  }
  const runs = executions.flatMap((execution) => execution.runs);
  const lastSyncedAt =
    runs
      .filter((run) => run.type === 'RESULTS')
      .map((run) => run.finishedAt)
      .sort()
      .at(-1) ?? new Date().toISOString();
  return {
    status: changedMatches > 0 ? ('UPDATED' as const) : ('UNCHANGED' as const),
    changedMatches,
    lastSyncedAt,
    runs: runs.map(publicSummary),
    supplemental: executions.flatMap((execution) =>
      execution.supplemental == null
        ? []
        : [{ provider: execution.config.key, summary: execution.supplemental }],
    ),
    evidence: executions.flatMap((execution) =>
      execution.evidence == null
        ? []
        : [{ provider: execution.config.key, details: execution.evidence }],
    ),
    warnings: executions.flatMap((execution) =>
      execution.warnings.map((warning) => ({ provider: execution.config.key, ...warning })),
    ),
  };
}

export async function syncOfficialSeasonCompetitionData(input: {
  seasonId: string;
  userId?: string | null;
  idempotencyKey: string;
  includeProfiles?: boolean;
  providerKeys?: readonly string[];
}) {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) {
    throw new AppError(400, 'Informe uma chave de idempotencia.', 'IDEMPOTENCY_KEY_REQUIRED');
  }
  const executions = await withTimeout(
    runConfiguredSeasonSync({
      ...input,
      idempotencyKey,
      requestedTypes: ['TEAMS', 'STRUCTURE', 'TIES', 'SCHEDULE', 'RESULTS', 'STANDINGS'],
    }),
    FULL_SYNC_TIMEOUT_MS,
  );
  let changedMatches = 0;
  for (const execution of executions) {
    const results = execution.runs.find((run) => run.type === 'RESULTS');
    if (!results) continue;
    changedMatches += await emitCompetitionSyncEvents({
      seasonId: input.seasonId,
      providerKey: execution.config.key,
      results,
      runs: execution.runs,
      profileCount: execution.profiles.length,
    });
  }
  const runs = executions.flatMap((execution) => execution.runs);
  const updatedProfiles = executions.reduce(
    (total, execution) => total + execution.profiles.length,
    0,
  );
  const lastSyncedAt =
    runs
      .filter((run) => run.type === 'RESULTS')
      .map((run) => run.finishedAt)
      .sort()
      .at(-1) ?? new Date().toISOString();
  return {
    status:
      changedMatches > 0 || runs.some((run) => changedCount(run) > 0) || updatedProfiles > 0
        ? ('UPDATED' as const)
        : ('UNCHANGED' as const),
    changedMatches,
    updatedProfiles,
    lastSyncedAt,
    runs: runs.map(publicSummary),
    supplemental: executions.flatMap((execution) =>
      execution.supplemental == null
        ? []
        : [{ provider: execution.config.key, summary: execution.supplemental }],
    ),
    evidence: executions.flatMap((execution) =>
      execution.evidence == null
        ? []
        : [{ provider: execution.config.key, details: execution.evidence }],
    ),
    warnings: executions.flatMap((execution) =>
      execution.warnings.map((warning) => ({ provider: execution.config.key, ...warning })),
    ),
  };
}

export async function runAutomaticSeasonSyncs() {
  const setting = await getScoreSyncSetting();
  if (!setting.enabled) return [];
  const configuredTargets = await listActiveSeasonRuntimeConfigs();
  const flagsByTarget = await Promise.all(
    configuredTargets.map(async (target) => ({
      target,
      flags: await getCompetitionFeatureFlags(target.seasonId),
    })),
  );
  const targets = flagsByTarget
    .filter(({ flags }) => flags.syncEnabled)
    .map(({ target }) => target);
  const dueTargets = await Promise.all(
    targets.map(async (target) => ({ target, plan: await getAutomaticSeasonSyncPlan(target) })),
  );
  return Promise.all(
    dueTargets
      .filter(({ plan }) => plan.providers.some((provider) => provider.due))
      .map(async ({ target, plan }) => {
        const dueProviders = plan.providers.filter((provider) => provider.due);
        const bucketSeconds = Math.min(
          ...dueProviders.map((provider) => provider.cadenceSeconds),
        );
        const bucket = Math.floor(Date.now() / (bucketSeconds * 1_000));
        try {
          const summary = await syncOfficialSeasonCompetitionData({
            seasonId: target.seasonId,
            userId: null,
            idempotencyKey: `auto:${target.seasonId}:${bucket}`,
            includeProfiles: false,
            providerKeys: dueProviders.map((provider) => provider.providerKey),
          });
          return { seasonId: target.seasonId, ok: true as const, summary, schedule: plan };
        } catch (error) {
          return { seasonId: target.seasonId, ok: false as const, error, schedule: plan };
        }
      }),
  );
}

type AutomaticSyncTarget = Awaited<ReturnType<typeof listActiveSeasonRuntimeConfigs>>[number];

export async function getAutomaticSeasonSyncPlan(
  target: AutomaticSyncTarget,
  now = new Date(),
) {
  const live = await prisma.match.findFirst({
    where: { seasonId: target.seasonId, status: 'LIVE' },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: { status: true, startsAt: true, stageId: true, roundId: true },
  });
  const scheduled =
    live ??
    (await prisma.match.findFirst({
      where: {
        seasonId: target.seasonId,
        status: 'SCHEDULED',
        startsAt: { gte: now },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      select: { status: true, startsAt: true, stageId: true, roundId: true },
    }));
  const signal = scheduled as SeasonMatchSignal | null;
  const providers = await Promise.all(
    target.providers.map(async (provider) => {
      const latest = await prisma.providerSyncRun.findFirst({
        where: {
          seasonId: target.seasonId,
          provider: provider.key,
          status: { not: 'RUNNING' },
          mode: 'APPLY',
        },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      });
      const cadence = resolveProviderCadence(provider, signal, now);
      const nextRunAt = latest
        ? new Date(latest.startedAt.getTime() + cadence.cadenceSeconds * 1_000)
        : now;
      return {
        providerKey: provider.key,
        ...cadence,
        lastRunAt: latest?.startedAt.toISOString() ?? null,
        nextRunAt: nextRunAt.toISOString(),
        due: nextRunAt.getTime() <= now.getTime(),
      };
    }),
  );
  return {
    evaluatedAt: now.toISOString(),
    signal: signal
      ? {
          ...signal,
          startsAt: signal.startsAt.toISOString(),
        }
      : null,
    providers,
  };
}
