import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  appSetting: { findUnique: vi.fn() },
}));

vi.mock('../../prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../events/outbox.js', () => ({
  dispatchOutboxEvent: vi.fn(),
  enqueueOutboxEvent: vi.fn(),
}));

import {
  COMPETITION_FEATURES_FAIL_CLOSED_DEFAULTS,
  getCompetitionFeatureFlags,
} from './competition-feature.service.js';

describe('competition feature flags', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fails closed when a season has no persisted flag record', async () => {
    prismaMock.appSetting.findUnique.mockResolvedValue(null);

    await expect(getCompetitionFeatureFlags('season-without-flags')).resolves.toEqual(
      expect.objectContaining({
        readEnabled: false,
        writeEnabled: false,
        uiEnabled: false,
        syncEnabled: false,
      }),
    );
    expect(COMPETITION_FEATURES_FAIL_CLOSED_DEFAULTS.reason).toMatch(/bloqueada/i);
  });

  it('returns only a valid persisted flag record', async () => {
    const value = {
      readEnabled: true,
      writeEnabled: false,
      uiEnabled: false,
      syncEnabled: false,
      reason: 'Canário de leitura aprovado pelo responsável.',
      updatedAt: '2026-07-15T12:00:00.000Z',
      updatedById: 'admin-1',
    };
    prismaMock.appSetting.findUnique.mockResolvedValue({ value });

    await expect(getCompetitionFeatureFlags('season-1')).resolves.toEqual(value);
  });

  it('keeps automatic sync compatible for persisted legacy flag records', async () => {
    prismaMock.appSetting.findUnique.mockResolvedValue({
      value: {
        readEnabled: true,
        writeEnabled: true,
        uiEnabled: true,
        reason: 'Registro legado anterior ao controle separado de sincronizacao.',
        updatedAt: '2026-07-15T12:00:00.000Z',
        updatedById: 'admin-1',
      },
    });

    await expect(getCompetitionFeatureFlags('legacy-season')).resolves.toMatchObject({
      syncEnabled: true,
    });
  });
});
