import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuth } from './auth.js';

const findUnique = vi.hoisted(() => vi.fn());

vi.mock('../prisma.js', () => ({ prisma: { user: { findUnique } } }));

function authenticatedRequest(
  overrides: Partial<NonNullable<Request['session']['user']>> = {},
  destroy = vi.fn((callback: (error?: unknown) => void) => callback()),
) {
  return {
    session: {
      user: {
        id: 'user-1',
        username: 'ana',
        nickname: 'Ana',
        avatarUrl: null,
        role: 'USER',
        status: 'ACTIVE',
        sessionVersion: 3,
        ...overrides,
      },
      destroy,
    },
  } as unknown as Request;
}

describe('session revalidation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows an active user whose role and session version still match', async () => {
    const req = authenticatedRequest();
    findUnique.mockResolvedValue({ ...req.session.user });
    const next = vi.fn() as NextFunction;

    requireAuth(req, {} as Response, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledWith());
  });

  it.each([
    ['blocked user', { status: 'BLOCKED', sessionVersion: 3 }],
    ['password reset', { status: 'ACTIVE', sessionVersion: 4 }],
    ['role change', { status: 'ACTIVE', role: 'ADMIN', sessionVersion: 4 }],
  ])('revokes a session after %s', async (_label, persisted) => {
    const destroy = vi.fn((callback: (error?: unknown) => void) => callback());
    const req = authenticatedRequest({}, destroy);
    findUnique.mockResolvedValue({
      ...req.session.user,
      ...persisted,
    });
    const next = vi.fn() as NextFunction;

    requireAuth(req, {} as Response, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());

    expect(destroy).toHaveBeenCalledOnce();
    expect(vi.mocked(next).mock.calls[0]?.[0]).toMatchObject({ code: 'SESSION_REVOKED' });
  });

  it('propagates a session-store destroy failure to Express', async () => {
    const failure = new Error('store unavailable');
    const req = authenticatedRequest(
      {},
      vi.fn((callback: (error?: unknown) => void) => callback(failure)),
    );
    findUnique.mockResolvedValue({ ...req.session.user, status: 'BLOCKED' });
    const next = vi.fn() as NextFunction;

    requireAuth(req, {} as Response, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(failure));
  });
});
