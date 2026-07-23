import { describe, expect, it } from 'vitest';
import { hasCopaDoBrasilCapabilities } from './copa-do-brasil-2026.sync.js';

describe('Copa do Brasil administrative smoke capabilities', () => {
  it('aceita o contrato capability-driven persistido pela preparação oficial', () => {
    expect(
      hasCopaDoBrasilCapabilities({
        format: 'KNOCKOUT',
        knockout: true,
        twoLegs: true,
        liveScoring: true,
        standings: false,
        rankingScopes: ['OVERALL', 'STAGE', 'ROUND'],
      }),
    ).toBe(true);
  });

  it('falha fechado se liga ou turno forem introduzidos na competição eliminatória', () => {
    expect(
      hasCopaDoBrasilCapabilities({
        format: 'LEAGUE',
        knockout: true,
        twoLegs: true,
        liveScoring: true,
        standings: false,
        rankingScopes: ['OVERALL', 'STAGE', 'ROUND', 'TURN'],
      }),
    ).toBe(false);
  });
});
