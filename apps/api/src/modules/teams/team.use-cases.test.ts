import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSeason: vi.fn(),
  listSeasonTeamProfiles: vi.fn(),
  findSeasonTeamProfile: vi.fn(),
}));

vi.mock('../seasons/season.use-cases.js', () => ({ getSeason: mocks.getSeason }));
vi.mock('./team.repository.js', () => ({
  listSeasonTeamProfiles: mocks.listSeasonTeamProfiles,
  findSeasonTeamProfile: mocks.findSeasonTeamProfile,
}));

import { getTeamProfile, listSeasonTeams } from './team.use-cases.js';

const team = {
  id: 'team-vasco',
  name: 'Vasco da Gama',
  code: 'VAS',
  flagUrl: null,
  crestUrl: null,
};

const snapshot = {
  id: 'snapshot-1',
  seasonId: 'season-1',
  teamId: team.id,
  provider: 'cbf-official',
  externalTeamId: '60646',
  state: 'RJ',
  sourceUrl:
    'https://www.cbf.com.br/futebol-brasileiro/times/campeonato-brasileiro/serie-a/2026/60646',
  collectedAt: new Date('2026-07-16T12:00:00.000Z'),
  checksum: 'a'.repeat(64),
  statistics: {
    goalsFor: 1,
    goalsAgainst: 0,
    cleanSheets: 1,
    played: 1,
    wins: 1,
    draws: 0,
    losses: 0,
    yellowCards: 2,
    redCards: 0,
  },
  athletes: [],
  matches: [],
  createdAt: new Date('2026-07-16T12:00:00.000Z'),
  updatedAt: new Date('2026-07-16T12:00:00.000Z'),
};

describe('team profile use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSeason.mockResolvedValue({ id: 'season-1' });
  });

  it('lists season teams with the reconciled CBF id and profile freshness', async () => {
    mocks.listSeasonTeamProfiles.mockResolvedValue({
      entries: [{ team: { ...team, profileSnapshots: [snapshot] } }],
      total: 1,
      mappings: [{ internalId: team.id, externalId: 'team:60646' }],
    });

    await expect(listSeasonTeams('season-1', { page: 1, pageSize: 20 })).resolves.toEqual({
      teams: [
        {
          team,
          externalId: '60646',
          state: 'RJ',
          profileAvailable: true,
          collectedAt: '2026-07-16T12:00:00.000Z',
        },
      ],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
  });

  it('returns only the shared profile contract and preserves provenance', async () => {
    mocks.findSeasonTeamProfile.mockResolvedValue({
      team: { ...team, profileSnapshots: [snapshot] },
    });

    const profile = await getTeamProfile('season-1', team.id);

    expect(profile).toEqual(
      expect.objectContaining({
        seasonId: 'season-1',
        team,
        externalId: '60646',
        source: expect.objectContaining({ provider: 'CBF', checksum: 'a'.repeat(64) }),
      }),
    );
    expect(profile).not.toHaveProperty('rawPayload');
  });

  it('distinguishes an unknown team from a profile that is not imported yet', async () => {
    mocks.findSeasonTeamProfile.mockResolvedValueOnce(null);
    await expect(getTeamProfile('season-1', 'unknown')).rejects.toMatchObject({
      statusCode: 404,
      code: 'TEAM_NOT_FOUND',
    });

    mocks.findSeasonTeamProfile.mockResolvedValueOnce({
      team: { ...team, profileSnapshots: [] },
    });
    await expect(getTeamProfile('season-1', team.id)).rejects.toMatchObject({
      statusCode: 404,
      code: 'TEAM_PROFILE_NOT_IMPORTED',
    });
  });
});
