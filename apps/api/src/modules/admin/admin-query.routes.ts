import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/async-handler.js';
import { prisma } from '../../prisma.js';
import { sseHealthSnapshot } from '../../realtime/sse.js';

export const adminQueryRouter = Router();

const contextQuerySchema = z.object({
  seasonId: z.string().min(1).max(200).optional(),
  poolSeasonId: z.string().min(1).max(200).optional(),
}).strict();

adminQueryRouter.get('/overview', asyncHandler(async (_req, res) => {
  const seasons = await prisma.competitionSeason.findMany({
    orderBy: [{ year: 'desc' }, { name: 'asc' }],
    take: 100,
    select: {
      id: true, slug: true, name: true, year: true, timezone: true, status: true,
      startsAt: true, endsAt: true, capabilities: true, updatedAt: true,
      competition: { select: { id: true, slug: true, name: true } },
      rounds: { orderBy: { order: 'asc' }, select: { id: true, name: true, order: true, status: true, startsAt: true, endsAt: true } },
      poolSeasons: {
        select: {
          id: true, poolId: true, startsAtRound: true, scoreableFromRound: true,
          scoreableFrom: true, historicalMatchesScoreable: true,
          scoringRuleSetVersionId: true, tieBreakerRuleSetId: true,
          pool: { select: { id: true, slug: true, name: true } },
        },
      },
      _count: { select: { matches: true, teams: true } },
    },
  });
  // System administration never manufactures PoolMembership rows. Membership is intentionally absent here.
  res.json({ seasons });
}));

adminQueryRouter.get('/divergences', asyncHandler(async (req, res) => {
  const query = contextQuerySchema.extend({ unresolvedOnly: z.coerce.boolean().default(true) }).strict().parse(req.query);
  const [quarantine, overrides, mappings, runs] = await Promise.all([
    prisma.syncQuarantine.findMany({
      where: { seasonId: query.seasonId, ...(query.unresolvedOnly ? { resolvedAt: null } : {}) },
      orderBy: { createdAt: 'desc' }, take: 200,
    }),
    prisma.matchOverride.findMany({
      where: { match: query.seasonId ? { seasonId: query.seasonId } : undefined },
      include: { match: { select: { id: true, seasonId: true, externalId: true, startsAt: true, status: true } } },
      orderBy: { updatedAt: 'desc' }, take: 100,
    }),
    prisma.providerEntityMapping.findMany({
      where: { seasonId: query.seasonId }, orderBy: { updatedAt: 'desc' }, take: 200,
    }),
    prisma.providerSyncRun.findMany({
      where: { seasonId: query.seasonId }, orderBy: { startedAt: 'desc' }, take: 50,
    }),
  ]);
  res.json({ quarantine, overrides, mappings, runs });
}));

adminQueryRouter.get('/audit', asyncHandler(async (req, res) => {
  const query = contextQuerySchema.extend({
    action: z.string().min(1).max(80).optional(),
    actorId: z.string().min(1).max(200).optional(),
    requestId: z.string().min(1).max(128).optional(),
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).strict().parse(req.query);
  const logs = await prisma.adminAuditLog.findMany({
    where: {
      seasonId: query.seasonId,
      poolSeasonId: query.poolSeasonId,
      actorId: query.actorId,
      requestId: query.requestId,
      ...(query.action ? { action: query.action as never } : {}),
    },
    include: { actor: { select: { id: true, username: true, nickname: true, role: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const nextCursor = logs.length > query.limit ? logs[query.limit - 1]?.id ?? null : null;
  res.json({ logs: logs.slice(0, query.limit), nextCursor });
}));

adminQueryRouter.get('/jobs', asyncHandler(async (req, res) => {
  const query = contextQuerySchema.extend({
    status: z.enum(['QUEUED', 'RUNNING', 'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED']).optional(),
  }).strict().parse(req.query);
  const jobs = await prisma.adminJob.findMany({
    where: { seasonId: query.seasonId, poolSeasonId: query.poolSeasonId, status: query.status },
    orderBy: { createdAt: 'desc' }, take: 100,
  });
  res.json({ jobs });
}));

async function backupHealth() {
  const directory = path.resolve(process.cwd(), 'backups');
  try {
    const files = await fs.readdir(directory, { withFileTypes: true });
    const candidates = await Promise.all(files.filter((item) => item.isFile()).map(async (item) => {
      const filePath = path.join(directory, item.name);
      const stat = await fs.stat(filePath);
      return { name: item.name, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
    }));
    candidates.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    const latest = candidates[0] ?? null;
    const ageHours = latest ? (Date.now() - new Date(latest.modifiedAt).getTime()) / 3_600_000 : null;
    return { ok: ageHours !== null && ageHours <= 24, latest, ageHours };
  } catch (error) {
    return { ok: false, latest: null, ageHours: null, error: error instanceof Error ? error.message : 'unavailable' };
  }
}

adminQueryRouter.get('/health', asyncHandler(async (req, res) => {
  const query = contextQuerySchema.strict().parse(req.query);
  const startedAt = Date.now();
  let database: { ok: boolean; latencyMs: number; error?: string };
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    database = { ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'unavailable' };
  }
  const [lastRun, activeLockCount, ranking, outbox, backup] = await Promise.all([
    prisma.providerSyncRun.findFirst({ where: { seasonId: query.seasonId }, orderBy: { startedAt: 'desc' } }),
    prisma.providerSyncLock.count({ where: { seasonId: query.seasonId, expiresAt: { gt: new Date() } } }),
    prisma.rankingSnapshot.findFirst({
      where: { seasonId: query.seasonId, poolSeasonId: query.poolSeasonId }, orderBy: { calculatedAt: 'desc' },
      select: { calculatedAt: true, sourceRevision: true, poolSeasonId: true },
    }),
    Promise.all([
      prisma.outboxEvent.count({ where: { seasonId: query.seasonId, publishedAt: null } }),
      prisma.outboxEvent.count({ where: { seasonId: query.seasonId, publishedAt: null, attempts: { gt: 0 } } }),
    ]),
    backupHealth(),
  ]);
  res.json({
    checkedAt: new Date().toISOString(),
    provider: { ok: !lastRun || !['FAILED'].includes(lastRun.status), lastRun, activeLockCount },
    sse: sseHealthSnapshot(),
    connectionPool: database,
    ranking: { ok: Boolean(ranking), latest: ranking },
    outbox: { ok: outbox[1] === 0, pending: outbox[0], retrying: outbox[1] },
    backup,
  });
}));
