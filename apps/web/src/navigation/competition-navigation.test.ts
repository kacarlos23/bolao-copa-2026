import { describe, expect, it } from 'vitest';
import { normalizeCapabilities } from '../app/CompetitionContext';
import {
  competitionSectionEnabled,
  competitionSectionsForCapabilities,
  enabledRankingScopes,
} from './competition-navigation';

describe('navegação por capabilities', () => {
  it('habilita grupos e chave para uma competição híbrida fictícia', () => {
    const config = {
      format: 'GROUPS' as const,
      groupStage: true,
      standings: true,
      knockout: true,
      twoLegs: true,
      rankingScopes: ['OVERALL', 'ROUND'] as const,
    };
    const capabilities = normalizeCapabilities(config, null);
    expect(competitionSectionsForCapabilities(capabilities, config)).toEqual([
      'overview',
      'games',
      'predictions',
      'standings',
      'bracket',
      'ranking',
      'teams',
    ]);
    expect(competitionSectionEnabled('team-matches', capabilities, config)).toBe(true);
    expect(enabledRankingScopes(config).has('TURN')).toBe(false);
  });

  it('não oferece standings nem TURN a um mata-mata puro', () => {
    const config = {
      format: 'KNOCKOUT' as const,
      knockout: true,
      rankingScopes: ['OVERALL'] as const,
    };
    const capabilities = normalizeCapabilities(config, null);
    expect(competitionSectionsForCapabilities(capabilities, config)).not.toContain('standings');
    expect(enabledRankingScopes(config)).toEqual(new Set(['OVERALL']));
  });

  it('não infere standings apenas porque o formato possui grupos', () => {
    const config = { format: 'GROUPS' as const, groupStage: true };
    const capabilities = normalizeCapabilities(config, null);
    expect(competitionSectionsForCapabilities(capabilities, config)).not.toContain('standings');
    expect(enabledRankingScopes(config)).toEqual(new Set(['OVERALL']));
  });
});
