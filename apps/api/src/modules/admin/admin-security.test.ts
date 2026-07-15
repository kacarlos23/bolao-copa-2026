import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stableHash } from '../scoring/scoring-rules.service.js';

const mocks = vi.hoisted(() => ({
  operationFind: vi.fn(), operationCreate: vi.fn(), operationUpdate: vi.fn(),
  seasonFind: vi.fn(), poolFind: vi.fn(), auditCreate: vi.fn(),
}));

const tx = {
  adminOperation: { create: mocks.operationCreate, update: mocks.operationUpdate, findUnique: mocks.operationFind },
  competitionSeason: { findUnique: mocks.seasonFind }, poolSeason: { findFirst: mocks.poolFind },
  adminAuditLog: { create: mocks.auditCreate },
};

vi.mock('../../prisma.js', () => ({ prisma: {
  adminOperation: { findUnique: mocks.operationFind, create: mocks.operationCreate, update: mocks.operationUpdate },
  competitionSeason: { findUnique: mocks.seasonFind }, poolSeason: { findFirst: mocks.poolFind },
} }));
vi.mock('../../prisma-transaction.js', () => ({ serializableTransaction: vi.fn((operation: (database: unknown) => unknown) => operation(tx)) }));

import {
  adminRequestContext, assertSeasonPoolScope, createAdminPreview, executeSensitiveMutation,
  idempotencyKeySchema, reinforcedConfirmationSchema,
} from './admin-security.js';

function requestContext(key = 'operation-key-1') {
  return adminRequestContext({
    method: 'POST', originalUrl: '/api/admin/test', get: (name: string) => name === 'idempotency-key' ? key : undefined,
    session: { user: { id: 'admin-1' } }, res: { locals: { requestId: 'request-1' } },
  } as unknown as Request);
}

describe('secure admin operations', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.operationFind.mockResolvedValue(null);
    mocks.seasonFind.mockResolvedValue({ id: 'season-a' }); mocks.poolFind.mockResolvedValue({ id: 'pool-a' });
    mocks.operationCreate.mockResolvedValue({ id: 'preview-1', requestHash: 'hash', affectedCount: 2, expiresAt: new Date(Date.now() + 60_000), preview: {}, status: 'PREVIEW' });
    mocks.operationUpdate.mockResolvedValue({}); mocks.auditCreate.mockResolvedValue({});
  });

  it('uses strict keys and a strict reinforced-confirmation contract', () => {
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('safe-operation:2026.1').success).toBe(true);
    expect(reinforcedConfirmationSchema.safeParse({ previewId: 'preview-1', confirmation: 'CONFIRMAR 2 ABCDEF123456', extra: true }).success).toBe(false);
  });

  it('blocks cross-season PoolSeason access before mutation', async () => {
    mocks.poolFind.mockResolvedValueOnce(null);
    await expect(assertSeasonPoolScope(tx as never, 'season-a', 'pool-from-b')).rejects.toMatchObject({ code: 'POOL_SEASON_MISMATCH' });
  });

  it('returns the same preview for a duplicate or concurrent delivery', async () => {
    const scope = { targetType: 'PoolSeason', targetId: 'pool-a', seasonId: 'season-a', poolSeasonId: 'pool-a' };
    const request = { targets: ['RANKING'] };
    const requestHash = stableHash({ action: 'REPROCESS', ...scope, input: request });
    mocks.operationFind.mockResolvedValue({ id: 'preview-1', actorId: 'admin-1', action: 'REPROCESS', requestHash, status: 'PREVIEW', affectedCount: 4, preview: { count: 4 }, expiresAt: new Date(Date.now() + 60_000) });
    const result = await createAdminPreview({ context: requestContext(), action: 'REPROCESS', scope, justification: 'Justificativa operacional válida', request, preview: {}, affectedCount: 4 });
    expect(result).toMatchObject({ previewId: 'preview-1', affectedCount: 4, replayed: true });
    expect(mocks.operationCreate).not.toHaveBeenCalled();
  });

  it('rejects replay when the idempotency key is reused with another payload', async () => {
    mocks.operationFind.mockResolvedValue({ actorId: 'admin-1', action: 'REPROCESS', requestHash: 'other', status: 'PREVIEW' });
    await expect(createAdminPreview({ context: requestContext(), action: 'REPROCESS', scope: { targetType: 'Season', seasonId: 'season-a' }, justification: 'Justificativa operacional válida', request: { changed: true }, preview: {}, affectedCount: 1 })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('rejects apply when its payload differs from the approved preview', async () => {
    mocks.operationFind
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'preview-1', actorId: 'admin-1', action: 'SEASON_CHANGE', targetType: 'CompetitionSeason', targetId: 'season-a', seasonId: 'season-a', poolSeasonId: null, status: 'PREVIEW', requestHash: 'different-preview-payload', affectedCount: 1, expiresAt: new Date(Date.now() + 60_000), confirmationHash: 'unused' });
    await expect(executeSensitiveMutation({
      context: requestContext('apply-with-different-payload'), action: 'SEASON_UPDATED', operation: 'SEASON_CHANGE',
      scope: { targetType: 'CompetitionSeason', targetId: 'season-a', seasonId: 'season-a' },
      justification: 'Mudança aprovada para ensaio operacional', request: { status: 'ARCHIVED' },
      confirmation: { previewId: 'preview-1', confirmation: 'CONFIRMAR 1 INVALIDPAYLOAD' }, mutate: vi.fn(),
    })).rejects.toMatchObject({ code: 'PREVIEW_REQUEST_MISMATCH' });
  });

  it('writes actor, request and season scope with before/after in the same audited mutation', async () => {
    const changed = await executeSensitiveMutation({
      context: requestContext('audited-operation-1'), action: 'SEASON_UPDATED', operation: 'SEASON_CHANGE',
      scope: { targetType: 'CompetitionSeason', targetId: 'season-a', seasonId: 'season-a' },
      justification: 'Mudança aprovada para ensaio operacional', request: { status: 'ACTIVE' },
      mutate: vi.fn(async () => ({ before: { status: 'DRAFT' }, after: { status: 'ACTIVE' }, result: { status: 'ACTIVE' }, affectedCount: 7 })),
    });
    expect(changed).toMatchObject({ affectedCount: 7, replayed: false });
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: 'admin-1', requestId: 'request-1', seasonId: 'season-a', poolSeasonId: undefined,
      before: { status: 'DRAFT' }, after: { status: 'ACTIVE' }, idempotencyKey: 'audit:audited-operation-1',
    }) });
  });

  it('replays a completed mutation without calling the mutator twice', async () => {
    const scope = { targetType: 'CompetitionSeason', targetId: 'season-a', seasonId: 'season-a' };
    const request = { status: 'ACTIVE' };
    mocks.operationFind.mockResolvedValue({ actorId: 'admin-1', action: 'SEASON_CHANGE', requestHash: stableHash({ action: 'SEASON_CHANGE', ...scope, input: request }), status: 'COMPLETED', result: { result: { status: 'ACTIVE' }, affectedCount: 7 } });
    const mutate = vi.fn();
    const result = await executeSensitiveMutation({ context: requestContext(), action: 'SEASON_UPDATED', operation: 'SEASON_CHANGE', scope, justification: 'Mudança aprovada para ensaio operacional', request, mutate });
    expect(result.replayed).toBe(true); expect(mutate).not.toHaveBeenCalled();
  });
});
