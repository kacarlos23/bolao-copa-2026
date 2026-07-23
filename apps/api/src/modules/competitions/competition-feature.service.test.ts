import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  appSetting: { findUnique: vi.fn() },
  competitionSeason: { findUnique: vi.fn() },
}));
const loggerMock = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../logger.js', () => ({ logger: loggerMock }));
vi.mock('../events/outbox.js', () => ({
  dispatchOutboxEvent: vi.fn(),
  enqueueOutboxEvent: vi.fn(),
}));

import {
  COMPETITION_FEATURES_FAIL_CLOSED_DEFAULTS,
  getCompetitionFeatureFlags,
  inspectCompetitionFeatureFlagsValue,
} from './competition-feature.service.js';

describe('competition feature flags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.competitionSeason.findUnique.mockResolvedValue({ status: 'ACTIVE' });
  });

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
    expect(loggerMock.warn).toHaveBeenCalledWith(
      { seasonId: 'season-without-flags', state: 'MISSING' },
      'competition feature flags failed closed',
    );
  });

  it('fails closed and alerts on partial or invalid persisted state', () => {
    expect(
      inspectCompetitionFeatureFlagsValue('partial-season', {
        readEnabled: true,
        writeEnabled: true,
      }),
    ).toMatchObject({
      state: 'INVALID',
      flags: {
        readEnabled: false,
        writeEnabled: false,
        uiEnabled: false,
        syncEnabled: false,
      },
    });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      { seasonId: 'partial-season', state: 'INVALID' },
      'competition feature flags failed closed',
    );
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

  it('preserves only the explicit restored DRAFT state without writing normalization', async () => {
    prismaMock.competitionSeason.findUnique.mockResolvedValue({ status: 'DRAFT' });
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
      readEnabled: true,
      writeEnabled: true,
      uiEnabled: true,
      syncEnabled: false,
    });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      { seasonId: 'legacy-season', state: 'RESTORED_DRAFT' },
      'legacy restored competition feature flags preserved without persistence',
    );
  });
});
