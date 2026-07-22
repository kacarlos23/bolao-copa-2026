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

  it('uses the identical knockout contracts for CSV and manual fallback', async () => {
    const csv = [
      'externalId,key,order,stageExternalId,roundExternalId,teamAExternalId,teamBExternalId,teamAName,teamBName,expectedLegs,status,decisionMethod,winnerTeamExternalId,provenance',
      'tie:1,round-1-tie-1,1,stage:ko,round:1,club:a,club:b,Clube A,Clube B,1,DECIDED,PENALTIES,club:a,sanitized csv fixture',
    ].join('\n');
    const csvProvider = new CsvProvider('TIES', csv, 'fallback-ties-2026.csv');
    const ties = await csvProvider.syncTies({ seasonId: 'season-1' });
    const manual = await new ManualProvider({ ties }).syncTies({ seasonId: 'season-1' });

    expect(ties).toEqual(manual);
    expect(ties[0]).toMatchObject({ expectedLegs: 1, winnerTeamExternalId: 'club:a' });
  });
});
