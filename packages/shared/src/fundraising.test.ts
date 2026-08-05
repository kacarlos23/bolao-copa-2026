import { describe, expect, it } from 'vitest';
import { calculateFundraisingPrizes } from './fundraising.js';

describe('calculateFundraisingPrizes', () => {
  it('distributes 50%, 30% and 20% to the first three places', () => {
    expect(calculateFundraisingPrizes(100_000)).toEqual([
      { place: 1, percentage: 50, amountCents: 50_000 },
      { place: 2, percentage: 30, amountCents: 30_000 },
      { place: 3, percentage: 20, amountCents: 20_000 },
    ]);
  });

  it('truncates every prize at cents when a percentage produces a fractional cent', () => {
    expect(calculateFundraisingPrizes(26_543)).toEqual([
      { place: 1, percentage: 50, amountCents: 13_271 },
      { place: 2, percentage: 30, amountCents: 7_962 },
      { place: 3, percentage: 20, amountCents: 5_308 },
    ]);
  });

  it('never rounds a fractional cent up', () => {
    expect(calculateFundraisingPrizes(1)).toEqual([
      { place: 1, percentage: 50, amountCents: 0 },
      { place: 2, percentage: 30, amountCents: 0 },
      { place: 3, percentage: 20, amountCents: 0 },
    ]);
  });
});
