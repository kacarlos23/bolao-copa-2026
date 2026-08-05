import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFind: vi.fn(),
  overview: vi.fn(),
  lookup: vi.fn(),
  resolveContext: vi.fn(),
  assertFeature: vi.fn(),
  requestContext: vi.fn(),
  preview: vi.fn(),
  execute: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock('../../prisma.js', () => ({
  prisma: { user: { findUnique: mocks.userFind } },
}));
vi.mock('./contributions.service.js', () => ({
  CONTRIBUTION_AMOUNT_PER_ROUND_CENTS: 1_000,
  assertContributionAmount: vi.fn(),
  assertEligibleAccountRound: vi.fn(),
  getContributionLookup: mocks.lookup,
  getContributionOverview: mocks.overview,
  roundHasStarted: vi.fn(() => true),
}));
vi.mock('../pools/pool-context.js', () => ({ resolvePoolSeasonContext: mocks.resolveContext }));
vi.mock('../competitions/competition-feature.service.js', () => ({
  assertCompetitionFeature: mocks.assertFeature,
}));
vi.mock('../events/outbox.js', () => ({
  enqueueOutboxEvent: vi.fn(),
  dispatchOutboxEvent: mocks.dispatch,
}));
vi.mock('../admin/admin-security.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../admin/admin-security.js')>();
  return {
    ...actual,
    adminRequestContext: mocks.requestContext,
    createAdminPreview: mocks.preview,
    executeSensitiveMutation: mocks.execute,
  };
});

import { errorHandler } from '../../middleware/error-handler.js';
import { requestContext } from '../../middleware/request-context.js';
import { adminContributionRouter, publicContributionRouter } from './contributions.routes.js';

function user(role: 'USER' | 'ADMIN') {
  return {
    id: role === 'ADMIN' ? 'admin-1' : 'user-1',
    username: role.toLowerCase(),
    nickname: role,
    avatarUrl: null,
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
    Object.assign(req, { session: role ? { user: user(role) } : {} });
    next();
  });
  server.use('/api', router);
  server.use(errorHandler);
  return server;
}

describe('contribution routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFind.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...user(where.id === 'admin-1' ? 'ADMIN' : 'USER'),
      id: where.id,
    }));
    mocks.resolveContext.mockResolvedValue({
      poolSeasonId: 'pool-season-1',
      seasonId: 'season-1',
      poolSlug: 'bolao-do-trabalho',
    });
    mocks.lookup.mockResolvedValue({
      poolSeasonId: 'pool-season-1',
      seasonId: 'season-1',
      config: { amountPerRoundCents: 1_000, defaultStartRound: 20 },
      memberships: [],
      accounts: [],
      rounds: [
        { id: 'round-20', order: 20, name: 'Rodada 20', status: 'SCHEDULED', startsAt: null, matches: [] },
      ],
    });
    mocks.overview.mockResolvedValue({
      poolSeasonId: 'pool-season-1',
      amountPerRoundCents: 1_000,
      defaultStartRound: 20,
      dueThroughRound: 20,
      totals: { paidCents: 0, dueCents: 0, outstandingCents: 0, advanceCents: 0 },
      participants: [
        {
          userId: 'user-1',
          nickname: 'USER',
          avatarUrl: null,
          accountId: 'account-1',
          membershipStatus: 'ACTIVE',
          contributionConfigured: true,
          contributionStartRound: 20,
          contributionEndRound: null,
          paidCents: 0,
          paymentCents: 0,
          dueCents: 0,
          outstandingCents: 0,
          advanceCents: 0,
          selectedRoundPaymentCents: null,
          selectedRoundOutstandingCents: null,
        },
      ],
      rounds: [],
      selectedRoundId: null,
      transactions: [],
    });
    mocks.requestContext.mockReturnValue({
      actorId: 'admin-1',
      requestId: 'request-1',
      idempotencyKey: 'contributions-write-1',
      origin: 'PUT /api/contributions',
    });
    mocks.preview.mockResolvedValue({
      previewId: 'preview-1',
      confirmation: 'CONFIRMAR 1 ABCDEF123456',
      affectedCount: 1,
    });
    mocks.execute.mockResolvedValue({
      result: {
        contribution: { poolSeasonId: 'pool-season-1', participants: [] },
        eventId: 'event-1',
        account: { id: 'account-1', userId: 'user-2', startRound: 20, endRound: null },
      },
      affectedCount: 1,
      replayed: false,
    });
  });

  it('returns only the public contribution summary to an authenticated participant', async () => {
    const response = await request(app(publicContributionRouter, 'USER'))
      .get('/api/bolao-do-trabalho/seasons/season-1/contributions')
      .expect(200);

    expect(response.body.contribution).toMatchObject({ poolSeasonId: 'pool-season-1' });
    expect(response.body.contribution.participants[0]).not.toHaveProperty('contributionStartRound');
    expect(response.body.contribution.participants[0]).not.toHaveProperty('accountId');
    expect(mocks.resolveContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', seasonId: 'season-1' }),
    );
  });

  it('accepts a confirmed ACCOUNT mutation without treating confirmation fields as unknown', async () => {
    await request(app(adminContributionRouter, 'ADMIN'))
      .put('/api/contributions')
      .set('idempotency-key', 'contributions-write-1')
      .send({
        action: 'ACCOUNT',
        seasonId: 'season-1',
        poolSeasonId: 'pool-season-1',
        userId: 'user-2',
        startRound: 20,
        endRound: null,
        justification: 'Configura a entrada do novo participante',
        previewId: 'preview-1',
        confirmation: 'CONFIRMAR 1 ABCDEF123456',
      })
      .expect(200);

    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'CONTRIBUTION_ACCOUNT' }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith('event-1');
  });

  it('allows an active system user to configure an account before its season membership exists', async () => {
    await request(app(adminContributionRouter, 'ADMIN'))
      .post('/api/contributions/preview')
      .set('idempotency-key', 'contribution-account-preview-1')
      .send({
        action: 'ACCOUNT',
        seasonId: 'season-1',
        poolSeasonId: 'pool-season-1',
        userId: 'user-2',
        startRound: 20,
        endRound: null,
        justification: 'Configura antes de ativar o participante',
      })
      .expect(200);

    expect(mocks.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ targetId: 'user-2' }),
      }),
    );
  });
});
