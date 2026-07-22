import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  flags: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('../../prisma.js', () => ({
  prisma: { adminAuditLog: { create: mocks.auditCreate } },
}));
vi.mock('../providers/season-result-sync.service.js', () => ({
  syncOfficialSeasonCompetitionData: mocks.sync,
}));
vi.mock('../competitions/competition-feature.service.js', () => ({
  getCompetitionFeatureFlags: mocks.flags,
}));

import { errorHandler } from '../../middleware/error-handler.js';
import { requestContext } from '../../middleware/request-context.js';
import { adminProviderRouter } from './admin-provider.routes.js';

function app() {
  const server = express();
  server.use(express.json());
  server.use(requestContext);
  server.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = {
      user: {
        id: 'admin-1',
        username: 'admin',
        nickname: 'Administrador',
        role: 'ADMIN',
        status: 'ACTIVE',
        sessionVersion: 1,
      },
    };
    next();
  });
  server.use('/api/admin', adminProviderRouter);
  server.use(errorHandler);
  return server;
}

describe('POST admin refresh-competition-data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const flags = {
      readEnabled: false,
      writeEnabled: false,
      uiEnabled: false,
      syncEnabled: false,
      reason: 'Canário administrativo bloqueado',
      updatedAt: '2026-07-22T12:00:00.000Z',
      updatedById: null,
    };
    mocks.flags.mockResolvedValue(flags);
    mocks.sync.mockResolvedValue({
      status: 'UNCHANGED',
      changedMatches: 0,
      updatedProfiles: 0,
      lastSyncedAt: '2026-07-22T13:00:00.000Z',
      supplemental: [],
      runs: [
        {
          runId: 'run-1',
          provider: 'fixture-official',
          type: 'RESULTS',
          status: 'SUCCESS',
          source: 'https://official.invalid/results',
          collectedAt: '2026-07-22T13:00:00.000Z',
          checksum: 'a'.repeat(64),
          counts: { fetched: 10, inserted: 0, updated: 0, unchanged: 10, quarantined: 0 },
          reused: false,
          startedAt: '2026-07-22T12:59:59.000Z',
          finishedAt: '2026-07-22T13:00:00.000Z',
        },
      ],
    });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
  });

  it('reconcilia pelo provider configurado, audita e não altera as quatro flags', async () => {
    const response = await request(app())
      .post('/api/admin/seasons/season-1/refresh-competition-data')
      .set('idempotency-key', 'admin-refresh-route-1')
      .send({
        includeProfiles: true,
        justification: 'Atualização oficial solicitada pelo administrador',
      })
      .expect(200);

    expect(mocks.sync).toHaveBeenCalledWith({
      seasonId: 'season-1',
      userId: 'admin-1',
      idempotencyKey: 'admin-refresh-route-1',
      includeProfiles: true,
    });
    expect(mocks.flags).toHaveBeenCalledTimes(2);
    expect(response.body).toMatchObject({
      status: 'UNCHANGED',
      featureFlagsUnchanged: true,
      featureFlags: {
        readEnabled: false,
        writeEnabled: false,
        uiEnabled: false,
        syncEnabled: false,
      },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SYNC_REQUESTED',
          seasonId: 'season-1',
          before: expect.objectContaining({ featureFlags: response.body.featureFlags }),
          after: expect.objectContaining({ featureFlagsUnchanged: true }),
        }),
      }),
    );
  });
});
