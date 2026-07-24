import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolFind: vi.fn(),
  fundraisingFind: vi.fn(),
  matchCount: vi.fn(),
  fundraisingUpsert: vi.fn(),
  preview: vi.fn(),
  execute: vi.fn(),
  context: vi.fn(),
  resolveContext: vi.fn(),
  assertFeature: vi.fn(),
  enqueue: vi.fn(),
  dispatch: vi.fn(),
  userFind: vi.fn(),
}));

const transaction = {
  poolSeason: { findFirst: mocks.poolFind },
  poolSeasonFundraising: { upsert: mocks.fundraisingUpsert },
};

vi.mock('../../prisma.js', () => ({
  prisma: {
    poolSeason: { findFirst: mocks.poolFind },
    poolSeasonFundraising: { findUnique: mocks.fundraisingFind },
    match: { count: mocks.matchCount },
    user: { findUnique: mocks.userFind },
  },
}));
vi.mock('../admin/admin-security.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../admin/admin-security.js')>();
  return {
    ...actual,
    adminRequestContext: mocks.context,
    createAdminPreview: mocks.preview,
    executeSensitiveMutation: mocks.execute,
  };
});
vi.mock('../pools/pool-context.js', () => ({
  resolvePoolSeasonContext: mocks.resolveContext,
}));
vi.mock('../competitions/competition-feature.service.js', () => ({
  assertCompetitionFeature: mocks.assertFeature,
}));
vi.mock('../events/outbox.js', () => ({
  enqueueOutboxEvent: mocks.enqueue,
  dispatchOutboxEvent: mocks.dispatch,
}));

import { errorHandler } from '../../middleware/error-handler.js';
import { requestContext } from '../../middleware/request-context.js';
import { adminFundraisingRouter, publicFundraisingRouter } from './fundraising.routes.js';

function sessionUser(role: 'USER' | 'ADMIN') {
  return {
    id: role === 'ADMIN' ? 'admin-1' : 'user-1',
    username: role.toLowerCase(),
    nickname: role,
    role,
    status: 'ACTIVE' as const,
    sessionVersion: 1,
  };
}

function app(router: express.Router, role?: 'USER' | 'ADMIN') {
  const server = express();
  server.use(express.json());
  server.use(requestContext);
  server.use((req, _res, next) => {
    Object.assign(req, { session: role ? { user: sessionUser(role) } : {} });
    next();
  });
  server.use('/api', router);
  server.use(errorHandler);
  return server;
}

describe('fundraising routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockReturnValue({
      actorId: 'admin-1',
      requestId: 'request-1',
      idempotencyKey: 'fundraising-operation-1',
      origin: 'PUT /api/fundraising',
    });
    mocks.userFind.mockImplementation(async ({ where }: { where: { id: string } }) =>
      sessionUser(where.id === 'admin-1' ? 'ADMIN' : 'USER'),
    );
    mocks.resolveContext.mockResolvedValue({
      poolId: 'pool-1',
      poolSlug: 'bolao-do-trabalho',
      poolSeasonId: 'pool-season-1',
      seasonId: 'season-1',
    });
    mocks.poolFind.mockResolvedValue({
      id: 'pool-season-1',
      poolId: 'pool-1',
      seasonId: 'season-1',
      scoreableFromRound: 20,
      startsAtRound: 20,
      fundraising: null,
      pool: { name: 'Bolão SIREL', memberships: [{ id: 'membership-1' }] },
      season: { name: 'Brasileirão Série A 2026' },
    });
    mocks.fundraisingFind.mockResolvedValue({
      amountCents: 15_050,
      updatedAt: new Date('2026-07-24T12:00:00.000Z'),
      updatedById: 'admin-1',
      lastJustification: 'Valor confirmado pelo administrador',
    });
    mocks.fundraisingUpsert.mockResolvedValue({
      poolSeasonId: 'pool-season-1',
      amountCents: 15_050,
      updatedAt: new Date('2026-07-24T12:00:00.000Z'),
      updatedById: 'admin-1',
      lastJustification: 'Valor confirmado pelo administrador',
    });
    mocks.matchCount.mockResolvedValue(190);
    mocks.preview.mockResolvedValue({
      previewId: 'preview-1',
      affectedCount: 1,
      confirmation: 'CONFIRMAR 1 ABCDEF123456',
    });
    mocks.enqueue.mockResolvedValue({ id: 'event-1' });
    mocks.execute.mockImplementation(
      async (input: { mutate: (tx: unknown) => Promise<unknown> }) => {
        const changed = (await input.mutate(transaction)) as {
          result: unknown;
          affectedCount: number;
        };
        return { result: changed.result, affectedCount: changed.affectedCount, replayed: false };
      },
    );
  });

  it('returns the PoolSeason value to an authenticated participant', async () => {
    const response = await request(app(publicFundraisingRouter, 'USER'))
      .get('/api/bolao-do-trabalho/seasons/season-1/fundraising')
      .expect(200);

    expect(response.body.fundraising).toMatchObject({
      poolSeasonId: 'pool-season-1',
      amountCents: 15_050,
    });
  });

  it('protects public reads and admin mutations by role', async () => {
    await request(app(publicFundraisingRouter))
      .get('/api/bolao-do-trabalho/seasons/season-1/fundraising')
      .expect(401);
    await request(app(adminFundraisingRouter, 'USER')).put('/api/fundraising').send({}).expect(403);
  });

  it('previews and applies an audited cents-preserving update', async () => {
    const base = {
      seasonId: 'season-1',
      poolSeasonId: 'pool-season-1',
      amountCents: 15_050,
      justification: 'Valor efetivamente confirmado pelo administrador',
    };
    await request(app(adminFundraisingRouter, 'ADMIN'))
      .post('/api/fundraising/preview')
      .set('idempotency-key', 'fundraising-preview-1')
      .send(base)
      .expect(200);

    const response = await request(app(adminFundraisingRouter, 'ADMIN'))
      .put('/api/fundraising')
      .set('idempotency-key', 'fundraising-apply-1')
      .send({
        ...base,
        previewId: 'preview-1',
        confirmation: 'CONFIRMAR 1 ABCDEF123456',
      })
      .expect(200);

    expect(response.body.fundraising.amountCents).toBe(15_050);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FUNDRAISING_UPDATED',
        operation: 'FUNDRAISING_CHANGE',
        scope: expect.objectContaining({
          seasonId: 'season-1',
          poolSeasonId: 'pool-season-1',
        }),
      }),
    );
    expect(mocks.fundraisingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ amountCents: 15_050, updatedById: 'admin-1' }),
      }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith('event-1');
  });

  it.each([{ amountCents: -1 }, { amountCents: 'invalid' }])(
    'rejects invalid values before the sensitive mutation',
    async ({ amountCents }) => {
      await request(app(adminFundraisingRouter, 'ADMIN'))
        .post('/api/fundraising/preview')
        .set('idempotency-key', 'fundraising-invalid-1')
        .send({
          seasonId: 'season-1',
          poolSeasonId: 'pool-season-1',
          amountCents,
          justification: 'Tentativa inválida devidamente justificada',
        })
        .expect(400);
      expect(mocks.preview).not.toHaveBeenCalled();
    },
  );
});
