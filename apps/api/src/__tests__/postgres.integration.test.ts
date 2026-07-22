import session from 'express-session';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { createPostgresSessionResources } from '../session-store.js';
import { upsertPredictions } from '../services/prediction.service.js';
import { prisma } from '../prisma.js';
import {
  CbfCopaDoBrasilProvider,
  ConmebolProvider,
} from '../modules/providers/adapters/snapshot-competition.provider.js';
import { runProviderSync } from '../modules/providers/provider-sync.service.js';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  application_name: 'stage9-integration',
});

async function storeCall<T>(
  operation: (callback: (error?: unknown, value?: T | null) => void) => void,
) {
  return new Promise<T | null | undefined>((resolve, reject) => {
    operation((error, value) => (error ? reject(error) : resolve(value)));
  });
}

beforeAll(async () => {
  await pool.query(`
    INSERT INTO "Competition" (id, slug, name, "updatedAt") VALUES
      ('competition-world-cup', 'world-cup', 'Copa fixture', now()),
      ('competition-stage9-other', 'stage9-other', 'Outra fixture', now())
      ON CONFLICT DO NOTHING;
    INSERT INTO "CompetitionSeason" (id, "competitionId", slug, name, timezone, status, "updatedAt") VALUES
      ('competition-season-world-cup-2026', 'competition-world-cup', 'world-cup-2026', 'Copa 2026 fixture', 'America/Sao_Paulo', 'ACTIVE', now()),
      ('season-stage9-other', 'competition-stage9-other', 'other-2026', 'Outra 2026 fixture', 'UTC', 'ACTIVE', now())
      ON CONFLICT DO NOTHING;
    INSERT INTO "Stage" (id, "seasonId", slug, name, type, "order", "updatedAt") VALUES
      ('stage-stage9-cup', 'competition-season-world-cup-2026', 'stage9-fixture', 'Grupos fixture', 'GROUP', 99, now()),
      ('stage-stage9-other', 'season-stage9-other', 'league', 'Liga', 'LEAGUE', 1, now());
    INSERT INTO "Round" (id, "seasonId", "stageId", name, "order", status, "updatedAt") VALUES
      ('round-stage9-cup', 'competition-season-world-cup-2026', 'stage-stage9-cup', 'Rodada fixture', 99, 'SCHEDULED', now()),
      ('round-stage9-other', 'season-stage9-other', 'stage-stage9-other', 'Rodada 1', 1, 'SCHEDULED', now());
    INSERT INTO "Pool" (id, slug, name, "isPublic", "updatedAt") VALUES
      ('pool-bolao-do-trabalho', 'bolao-do-trabalho', 'Bolao fixture', false, now()),
      ('pool-stage9-other', 'stage9-other', 'Outro pool fixture', false, now())
      ON CONFLICT DO NOTHING;
    INSERT INTO "PoolSeason" (id, "poolId", "seasonId", "startsAtRound", "scoreableFromRound", "updatedAt") VALUES
      ('pool-season-bolao-do-trabalho-world-cup-2026', 'pool-bolao-do-trabalho', 'competition-season-world-cup-2026', 1, 1, now()),
      ('pool-season-stage9-other', 'pool-stage9-other', 'season-stage9-other', 2, 2, now())
      ON CONFLICT DO NOTHING;
    INSERT INTO "User" (id, username, "usernameLower", nickname, "passwordHash", role, status, "updatedAt") VALUES
      ('user-stage9', 'stage9-user', 'stage9-user', 'Pessoa Fixture', 'not-a-real-password-hash', 'USER', 'ACTIVE', now()),
      ('user-stage9-2', 'stage9-user-2', 'stage9-user-2', 'Outra Fixture', 'not-a-real-password-hash', 'USER', 'ACTIVE', now());
    INSERT INTO "PoolMembership" (id, "poolId", "userId", role, status, "updatedAt") VALUES
      ('membership-stage9', 'pool-bolao-do-trabalho', 'user-stage9', 'MEMBER', 'ACTIVE', now());
    INSERT INTO "Team" (id, "externalId", name, code, "updatedAt") VALUES
      ('team-stage9-home', 'fixture-home', 'Mandante Fixture', 'HOM', now()),
      ('team-stage9-away', 'fixture-away', 'Visitante Fixture', 'AWY', now());
    INSERT INTO "MatchDay" (id, date, "firstMatchStartsAt", "predictionsCloseAt", status, "seasonId", "updatedAt") VALUES
      ('day-stage9-cup', '2030-01-01T00:00:00Z', '2030-01-01T12:05:00Z', '2030-01-01T12:00:00Z', 'OPEN', 'competition-season-world-cup-2026', now()),
      ('day-stage9-other', '2030-01-02T00:00:00Z', '2030-01-02T12:05:00Z', '2030-01-02T12:00:00Z', 'OPEN', 'season-stage9-other', now());
    INSERT INTO "Match" (id, "externalId", "matchDayId", "seasonId", "stageId", "roundId", "homeTeamId", "awayTeamId", "startsAt", "predictionClosesAt", status, "updatedAt") VALUES
      ('match-stage9-cup', 'fixture-match-cup', 'day-stage9-cup', 'competition-season-world-cup-2026', 'stage-stage9-cup', 'round-stage9-cup', 'team-stage9-home', 'team-stage9-away', '2030-01-01T12:05:00Z', '2030-01-01T12:00:00Z', 'SCHEDULED', now()),
      ('match-stage9-other', 'fixture-match-other', 'day-stage9-other', 'season-stage9-other', 'stage-stage9-other', 'round-stage9-other', 'team-stage9-home', 'team-stage9-away', '2030-01-02T12:05:00Z', '2030-01-02T12:00:00Z', 'SCHEDULED', now());
  `);
});

afterAll(async () => {
  vi.useRealTimers();
  await pool.end();
});

describe('PostgreSQL real: sessão e CSRF', () => {
  it('persiste, lê, revoga a sessão e aplica CSRF usando connect-pg-simple', async () => {
    const resources = createPostgresSessionResources();
    const sid = `stage9-${randomUUID()}`;
    const value = { cookie: { maxAge: 60_000 }, csrfToken: 'x'.repeat(40) } as session.SessionData;
    await storeCall<void>((callback) => resources.store.set(sid, value, callback));
    await expect(
      storeCall<session.SessionData>((callback) => resources.store.get(sid, callback)),
    ).resolves.toMatchObject({ csrfToken: value.csrfToken });
    await storeCall<void>((callback) => resources.store.destroy(sid, callback));
    await expect(
      storeCall<session.SessionData>((callback) => resources.store.get(sid, callback)),
    ).resolves.toBeUndefined();

    const agent = request.agent(createApp({ sessionStore: resources.store }));
    const csrf = await agent.get('/api/auth/csrf').expect(200);
    await agent.post('/api/auth/logout').expect(403);
    await agent.post('/api/auth/logout').set('x-csrf-token', csrf.body.csrfToken).expect(401);
    await resources.close();
  });
});

describe('PostgreSQL real: concorrência, constraints e isolamento', () => {
  it('serializa palpites concorrentes antes do limite e falha fechado no instante exato', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T11:59:59.999Z'));
    const input = {
      predictions: [{ matchId: 'match-stage9-cup', predictedHomeScore: 2, predictedAwayScore: 1 }],
    };
    await Promise.all([
      upsertPredictions('day-stage9-cup', 'user-stage9', input),
      upsertPredictions('day-stage9-cup', 'user-stage9', input),
    ]);
    const count = await pool.query(
      'SELECT count(*)::int AS count FROM "Prediction" WHERE "userId" = $1 AND "matchId" = $2',
      ['user-stage9', 'match-stage9-cup'],
    );
    expect(count.rows[0].count).toBe(1);

    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    await expect(upsertPredictions('day-stage9-cup', 'user-stage9', input)).rejects.toMatchObject({
      code: 'PREDICTION_MATCH_CLOSED',
      statusCode: 409,
    });
  });

  it('rejeita relação cruzada e mantém unicidade composta no banco', async () => {
    await expect(
      pool.query(
        `INSERT INTO "Prediction" (id, "userId", "matchId", "poolSeasonId", "predictedHomeScore", "predictedAwayScore", "updatedAt") VALUES ('prediction-cross-scope', 'user-stage9-2', 'match-stage9-other', 'pool-season-bolao-do-trabalho-world-cup-2026', 1, 0, now())`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `INSERT INTO "PoolMembership" (id, "poolId", "userId", role, status, "updatedAt") VALUES ('membership-duplicate', 'pool-bolao-do-trabalho', 'user-stage9', 'MEMBER', 'ACTIVE', now())`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('PostgreSQL real: import, override, outbox e ranking', () => {
  it('representa grupos, ida/volta e jogo unico no mesmo pipeline sem duplicar na segunda carga', async () => {
    const competition = await prisma.competition.create({
      data: { slug: `provider-fixture-${randomUUID()}`, name: 'Provider fixture' },
    });
    const seasons = await Promise.all([
      prisma.competitionSeason.create({
        data: {
          competitionId: competition.id,
          slug: `conmebol-fixture-${randomUUID()}`,
          name: 'CONMEBOL fixture',
          timezone: 'America/Sao_Paulo',
          status: 'DRAFT',
        },
      }),
      prisma.competitionSeason.create({
        data: {
          competitionId: competition.id,
          slug: `cbf-fixture-${randomUUID()}`,
          name: 'CBF fixture',
          timezone: 'America/Sao_Paulo',
          status: 'DRAFT',
        },
      }),
    ]);
    const providers = [
      {
        seasonId: seasons[0].id,
        provider: new ConmebolProvider({
          fixtureName: 'conmebol-libertadores.sanitized.json',
          competition: 'conmebol-libertadores',
        }),
      },
      {
        seasonId: seasons[1].id,
        provider: new CbfCopaDoBrasilProvider({
          fixtureName: 'cbf-copa-do-brasil.sanitized.json',
        }),
      },
    ];
    const types = ['TEAMS', 'STRUCTURE', 'TIES', 'SCHEDULE', 'RESULTS', 'STANDINGS'] as const;

    for (const target of providers) {
      for (const type of types) {
        await runProviderSync(target.provider, {
          type,
          seasonId: target.seasonId,
          idempotencyKey: `first:${target.seasonId}:${type}`,
        });
      }
    }
    const firstCounts = await Promise.all(
      seasons.map((season) =>
        prisma.competitionSeason.findUniqueOrThrow({
          where: { id: season.id },
          select: {
            _count: {
              select: { teams: true, stages: true, rounds: true, ties: true, matches: true },
            },
          },
        }),
      ),
    );
    const firstIds = await prisma.match.findMany({
      where: { seasonId: { in: seasons.map((season) => season.id) } },
      orderBy: { externalId: 'asc' },
      select: { id: true, externalId: true, tieId: true },
    });

    const secondSummaries = [];
    for (const target of providers) {
      for (const type of types) {
        secondSummaries.push(
          await runProviderSync(target.provider, {
            type,
            seasonId: target.seasonId,
            idempotencyKey: `second:${target.seasonId}:${type}`,
          }),
        );
      }
    }
    const secondCounts = await Promise.all(
      seasons.map((season) =>
        prisma.competitionSeason.findUniqueOrThrow({
          where: { id: season.id },
          select: {
            _count: {
              select: { teams: true, stages: true, rounds: true, ties: true, matches: true },
            },
          },
        }),
      ),
    );
    const secondIds = await prisma.match.findMany({
      where: { seasonId: { in: seasons.map((season) => season.id) } },
      orderBy: { externalId: 'asc' },
      select: { id: true, externalId: true, tieId: true },
    });

    expect(secondCounts).toEqual(firstCounts);
    expect(secondIds).toEqual(firstIds);
    expect(secondSummaries.every((summary) => summary.counts.inserted === 0)).toBe(true);
    expect(firstCounts[0]._count).toMatchObject({
      teams: 4,
      stages: 2,
      rounds: 2,
      ties: 1,
      matches: 3,
    });
    expect(firstCounts[1]._count).toMatchObject({
      teams: 2,
      stages: 1,
      rounds: 1,
      ties: 1,
      matches: 1,
    });
    const decided = await prisma.tie.findMany({
      where: { seasonId: { in: seasons.map((season) => season.id) } },
      orderBy: { seasonId: 'asc' },
      select: {
        expectedLegs: true,
        status: true,
        decisionMethod: true,
        aggregateTeamAScore: true,
        aggregateTeamBScore: true,
        winnerTeamId: true,
      },
    });
    expect(decided).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expectedLegs: 2,
          status: 'DECIDED',
          decisionMethod: 'PENALTIES',
          aggregateTeamAScore: 1,
          aggregateTeamBScore: 1,
        }),
        expect.objectContaining({
          expectedLegs: 1,
          status: 'DECIDED',
          decisionMethod: 'PENALTIES',
          aggregateTeamAScore: 2,
          aggregateTeamBScore: 2,
        }),
      ]),
    );
  });

  it('torna import concorrente idempotente e rollback de override auditável', async () => {
    const insert = () =>
      pool.query(
        `INSERT INTO "ProviderSyncRun" (id, provider, "seasonId", type, "idempotencyKey", "dryRun", status, source) VALUES ($1, 'fixture', 'competition-season-world-cup-2026', 'SCHEDULE', 'stage9-import-key', false, 'SUCCESS', 'local-fixture') ON CONFLICT (provider, "seasonId", type, "idempotencyKey") DO NOTHING`,
        [randomUUID()],
      );
    await Promise.all([insert(), insert(), insert()]);
    const imports = await pool.query(
      'SELECT count(*)::int AS count FROM "ProviderSyncRun" WHERE "idempotencyKey" = $1',
      ['stage9-import-key'],
    );
    expect(imports.rows[0].count).toBe(1);

    await pool.query(
      `INSERT INTO "MatchOverride" (id, "matchId", "actorId", justification, values, before, active, "updatedAt") VALUES ('override-stage9', 'match-stage9-cup', 'user-stage9', 'Fixture local de rollback', '{"status":"FINISHED"}', '{"status":"SCHEDULED"}', true, now())`,
    );
    await pool.query(
      'UPDATE "MatchOverride" SET active = false, "removedAt" = now(), "updatedAt" = now() WHERE id = $1',
      ['override-stage9'],
    );
    const override = await pool.query(
      'SELECT active, before, values FROM "MatchOverride" WHERE id = $1',
      ['override-stage9'],
    );
    expect(override.rows[0]).toMatchObject({
      active: false,
      before: { status: 'SCHEDULED' },
      values: { status: 'FINISHED' },
    });
  });

  it('publica outbox somente após commit e deduplica replay', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO "OutboxEvent" (id, type, "seasonId", "poolSeasonId", payload, "idempotencyKey") VALUES ('outbox-rolled-back', 'fixture.event', 'competition-season-world-cup-2026', 'pool-season-bolao-do-trabalho-world-cup-2026', '{}', 'outbox-rollback')`,
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const rolledBack = await pool.query(
      'SELECT count(*)::int AS count FROM "OutboxEvent" WHERE id = $1',
      ['outbox-rolled-back'],
    );
    expect(rolledBack.rows[0].count).toBe(0);

    await Promise.all(
      [1, 2].map((value) =>
        pool.query(
          `INSERT INTO "OutboxEvent" (id, type, "seasonId", "poolSeasonId", payload, "idempotencyKey") VALUES ($1, 'fixture.event', 'competition-season-world-cup-2026', 'pool-season-bolao-do-trabalho-world-cup-2026', $2, 'outbox-commit') ON CONFLICT ("idempotencyKey") DO NOTHING`,
          [`outbox-${value}`, JSON.stringify({ value })],
        ),
      ),
    );
    const committed = await pool.query(
      'SELECT count(*)::int AS count FROM "OutboxEvent" WHERE "idempotencyKey" = $1',
      ['outbox-commit'],
    );
    expect(committed.rows[0].count).toBe(1);
  });

  it('isola snapshots de ranking e mantém histórico anterior ao início não pontuável', async () => {
    await pool.query(`INSERT INTO "RankingSnapshot" (id, "userId", "seasonId", "poolSeasonId", "roundId", points, "finalPoints", "exactScores", "resultHits", "oneGoalHits", misses, rank, "snapshotKey", "sourceRevision") VALUES
      ('snapshot-stage9-cup', 'user-stage9', 'competition-season-world-cup-2026', 'pool-season-bolao-do-trabalho-world-cup-2026', 'round-stage9-cup', 12, 12, 0, 4, 0, 0, 1, 'fixture:1', 'fixture-revision'),
      ('snapshot-stage9-other', 'user-stage9', 'season-stage9-other', 'pool-season-stage9-other', 'round-stage9-other', 99, 99, 9, 0, 0, 0, 1, 'fixture:1', 'fixture-revision')`);
    const scoped = await pool.query(
      'SELECT sum(points)::int AS points FROM "RankingSnapshot" WHERE "poolSeasonId" = $1',
      ['pool-season-bolao-do-trabalho-world-cup-2026'],
    );
    const gate = await pool.query(
      'SELECT "startsAtRound", "scoreableFromRound", "historicalMatchesScoreable" FROM "PoolSeason" WHERE id = $1',
      ['pool-season-stage9-other'],
    );
    expect(scoped.rows[0].points).toBe(12);
    expect(gate.rows[0]).toMatchObject({
      startsAtRound: 2,
      scoreableFromRound: 2,
      historicalMatchesScoreable: false,
    });
  });
});
