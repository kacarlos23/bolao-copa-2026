import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';
import {
  BRASILEIRAO_2026_SEASON_SLUG,
  refreshBrasileirao2026RoundWindows,
} from '../brasileirao/brasileirao-2026.service.js';
import { dispatchOutboxEvent, enqueueOutboxEvent } from '../events/outbox.js';
import { getScoreSyncSetting } from '../../services/score-sync-settings.service.js';
import { importCbfSerieA2026TeamProfiles } from '../teams/team-profile.importer.js';
import { CbfSerieA2026Provider } from './adapters/cbf-serie-a-2026.provider.js';
import { runProviderSync, type ProviderSyncSummary } from './provider-sync.service.js';

const USER_COOLDOWN_MS = 30_000;
const RESULTS_SYNC_TIMEOUT_MS = 60_000;
const FULL_SYNC_TIMEOUT_MS = 120_000;
const AUTOMATIC_SYNC_BUCKET_MS = 5 * 60_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () =>
        reject(
          new AppError(
            504,
            'A fonte oficial demorou demais para responder.',
            'PROVIDER_TIMEOUT',
          ),
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
    type: summary.type,
    status: summary.status,
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

async function assertBrasileiraoSeason(seasonId: string) {
  const season = await prisma.competitionSeason.findUnique({
    where: { id: seasonId },
    select: { slug: true },
  });
  if (!season) throw new AppError(404, 'Temporada nao encontrada.', 'SEASON_NOT_FOUND');
  if (season.slug !== BRASILEIRAO_2026_SEASON_SLUG) {
    throw new AppError(
      400,
      'Esta temporada nao possui sincronizacao publica configurada.',
      'SEASON_PROVIDER_NOT_CONFIGURED',
    );
  }
}

async function assertUserCooldown(input: {
  seasonId: string;
  userId?: string | null;
  idempotencyKey: string;
}) {
  if (!input.userId) return;
  const exactRun = await prisma.providerSyncRun.findUnique({
    where: {
      provider_seasonId_type_idempotencyKey: {
        provider: 'cbf-official',
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
      provider: 'cbf-official',
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
      payload: { matchIds, provider: 'cbf-official', changedMatches },
      idempotencyKey: `match.updated:${input.seasonId}:${input.results.runId}`,
    });
    const completedEvent = await enqueueOutboxEvent(tx, {
      type: 'provider.sync.completed',
      seasonId: input.seasonId,
      poolSeasonId: null,
      payload: {
        provider: 'cbf-official',
        changedMatches,
        profileCount: input.profileCount ?? 0,
        runs: input.runs.map((run) => ({ type: run.type, runId: run.runId })),
      },
      idempotencyKey: `provider.sync.completed:${input.seasonId}:${input.results.runId}`,
    });
    return [matchEvent.id, completedEvent.id];
  });
  for (const eventId of eventIds) await dispatchOutboxEvent(eventId);
  return { changedMatches };
}

async function runOfficialCbfSync(input: {
  seasonId: string;
  userId?: string | null;
  idempotencyKey: string;
  types: Array<'TEAMS' | 'SCHEDULE' | 'RESULTS' | 'STANDINGS'>;
  includeProfiles?: boolean;
}) {
  const provider = new CbfSerieA2026Provider({
    timeoutMs: 10_000,
    maxBytes: 768 * 1024,
    retries: 2,
  });
  const runs: ProviderSyncSummary[] = [];
  for (const type of input.types) {
    runs.push(
      await runProviderSync(provider, {
        type,
        seasonId: input.seasonId,
        idempotencyKey: `${input.idempotencyKey}:${type.toLowerCase()}`,
        requestedById: input.userId ?? null,
      }),
    );
  }
  const profiles = input.includeProfiles
    ? await importCbfSerieA2026TeamProfiles(input.seasonId)
    : [];
  await refreshBrasileirao2026RoundWindows(input.seasonId);
  return { runs, profiles };
}

export async function getSeasonResultSyncStatus(seasonId: string) {
  const latest = await prisma.providerSyncRun.findFirst({
    where: { seasonId, provider: 'cbf-official', type: 'RESULTS', status: { not: 'RUNNING' } },
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
  await assertBrasileiraoSeason(input.seasonId);
  await assertUserCooldown({ ...input, idempotencyKey });

  const { runs } = await withTimeout(
    runOfficialCbfSync({
      seasonId: input.seasonId,
      userId: input.userId,
      idempotencyKey,
      types: ['RESULTS', 'STANDINGS'],
    }),
    RESULTS_SYNC_TIMEOUT_MS,
  );
  const results = runs.find((run) => run.type === 'RESULTS')!;
  const { changedMatches } = await emitCompetitionSyncEvents({
    seasonId: input.seasonId,
    results,
    runs,
  });

  return {
    status: changedMatches > 0 ? ('UPDATED' as const) : ('UNCHANGED' as const),
    changedMatches,
    lastSyncedAt: results.finishedAt,
    runs: runs.map(publicSummary),
  };
}

export async function syncOfficialSeasonCompetitionData(input: {
  seasonId: string;
  userId?: string | null;
  idempotencyKey: string;
  includeProfiles?: boolean;
}) {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) {
    throw new AppError(400, 'Informe uma chave de idempotencia.', 'IDEMPOTENCY_KEY_REQUIRED');
  }
  await assertBrasileiraoSeason(input.seasonId);
  await assertUserCooldown({ ...input, idempotencyKey });

  const { runs, profiles } = await withTimeout(
    runOfficialCbfSync({
      seasonId: input.seasonId,
      userId: input.userId,
      idempotencyKey,
      types: ['TEAMS', 'SCHEDULE', 'RESULTS', 'STANDINGS'],
      includeProfiles: input.includeProfiles,
    }),
    FULL_SYNC_TIMEOUT_MS,
  );
  const results = runs.find((run) => run.type === 'RESULTS')!;
  const { changedMatches } = await emitCompetitionSyncEvents({
    seasonId: input.seasonId,
    results,
    runs,
    profileCount: profiles.length,
  });

  return {
    status:
      changedMatches > 0 ||
      runs.some((run) => changedCount(run) > 0) ||
      profiles.length > 0
        ? ('UPDATED' as const)
        : ('UNCHANGED' as const),
    changedMatches,
    updatedProfiles: profiles.length,
    lastSyncedAt: results.finishedAt,
    runs: runs.map(publicSummary),
  };
}

export async function runAutomaticBrasileiraoSync() {
  const setting = await getScoreSyncSetting();
  if (!setting.enabled) return null;
  const season = await prisma.competitionSeason.findFirst({
    where: { slug: BRASILEIRAO_2026_SEASON_SLUG },
    orderBy: { year: 'desc' },
    select: { id: true },
  });
  if (!season) return null;
  const bucket = Math.floor(Date.now() / AUTOMATIC_SYNC_BUCKET_MS);
  return syncOfficialSeasonCompetitionData({
    seasonId: season.id,
    userId: null,
    idempotencyKey: `auto:${season.id}:${bucket}`,
    includeProfiles: false,
  });
}
