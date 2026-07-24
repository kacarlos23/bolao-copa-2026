import { describe, expect, it } from 'vitest';
import { centsToBrlInput, formatBrlCents, parseBrlInputToCents } from './fundraising';

describe('fundraising currency helpers', () => {
  it.each([
    [0, 'R$ 0,00'],
    [15_000, 'R$ 150,00'],
    [125_000, 'R$ 1.250,00'],
  ])('formats %i cents in Brazilian reais', (cents, expected) => {
    expect(formatBrlCents(cents).replace(/\s/, ' ')).toBe(expected);
  });

  it('preserves cents entered with comma or dot', () => {
    expect(parseBrlInputToCents('150,50')).toBe(15_050);
    expect(parseBrlInputToCents('150.50')).toBe(15_050);
    expect(centsToBrlInput(15_050)).toBe('150,50');
  });

  it.each(['-1', 'NaN', 'Infinity', 'texto', '1,234', '1000000,01'])(
    'rejects invalid input %s',
    (value) => {
      expect(parseBrlInputToCents(value)).toBeNull();
    },
  );
});
