import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CsvProvider, parseCsvRows } from './csv.provider.js';
import { ManualProvider } from './manual.provider.js';

describe('CSV contingency provider', () => {
  it('uses the same strict normalized result validation as manual operation', async () => {
    const csv = readFileSync(new URL('../__fixtures__/results.csv', import.meta.url), 'utf8');
    const csvProvider = new CsvProvider('RESULTS', csv, 'cbf-results-2026.csv');
    const csvResults = await csvProvider.syncResults({ seasonId: 'season-1' });
    const manualResults = await new ManualProvider({ results: csvResults }).syncResults({
      seasonId: 'season-1',
    });

    expect(csvResults).toEqual(manualResults);
    expect(csvResults[0]).toEqual(
      expect.objectContaining({ homeScore: 2, awayScore: 1, status: 'FINISHED' }),
    );
  });

  it('rejects unexpected columns, malformed rows and remote source URLs', () => {
    expect(() => parseCsvRows('externalId,name,unsafe\n1,A,x', 'TEAMS')).toThrow(
      'Unexpected CSV header',
    );
    expect(() => parseCsvRows('externalId,name\n1', 'TEAMS')).toThrow('has 1 fields');
    expect(
      () => new CsvProvider('TEAMS', 'externalId,name\n1,A', 'https://evil.test/a.csv'),
    ).toThrow('remote URL');
  });
});
