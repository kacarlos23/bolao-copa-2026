import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeTieResult } from '../../ties/tie-result.js';
import {
  computeOfficialSnapshotChecksum,
  parseOfficialSourceSnapshot,
} from '../official-source-snapshot.js';
import { ManualProvider } from './manual.provider.js';
import { CbfCopaDoBrasilProvider, ConmebolProvider } from './snapshot-competition.provider.js';

function conmebolFixture() {
  return JSON.parse(
    readFileSync(
      new URL('../__fixtures__/official/conmebol-libertadores.sanitized.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, unknown>;
}

function withSnapshotChecksum(snapshot: Record<string, unknown>) {
  const content = { ...snapshot };
  delete content.snapshotChecksum;
  return {
    ...content,
    snapshotChecksum: computeOfficialSnapshotChecksum(content as never),
  };
}

describe('providers oficiais compartilhados para copas', () => {
  it('valida snapshots imutaveis de pagina, PDF e resposta sem rede', async () => {
    const provider = new ConmebolProvider({
      fixtureName: 'conmebol-libertadores.sanitized.json',
      competition: 'conmebol-libertadores',
    });
    const evidence = await provider.snapshotEvidence();

    expect(evidence.artifacts.map((artifact) => artifact.kind)).toEqual([
      'PAGE',
      'PDF',
      'RESPONSE',
    ]);
    expect(evidence.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(await provider.healthCheck({ seasonId: 'fixture-season' })).toMatchObject({ ok: true });

    const tampered = conmebolFixture();
    (tampered.data as { teams: Array<{ name: string }> }).teams[0].name = 'Alteracao sem pin';
    expect(() =>
      parseOfficialSourceSnapshot(tampered, {
        provider: 'conmebol-official',
        competition: 'conmebol-libertadores',
      }),
    ).toThrow(/snapshot checksum mismatch/i);
  });

  it('reutiliza o mesmo provider CONMEBOL para Libertadores e Sul-Americana', async () => {
    const libertadores = new ConmebolProvider({
      fixtureName: 'conmebol-libertadores.sanitized.json',
      competition: 'conmebol-libertadores',
    });
    const sudamericanaSnapshot = withSnapshotChecksum({
      ...conmebolFixture(),
      competition: 'conmebol-sudamericana',
      source: 'https://fixture.invalid/conmebol/sudamericana/official-snapshot',
    });
    const sudamericana = new ConmebolProvider({
      snapshot: sudamericanaSnapshot,
      competition: 'conmebol-sudamericana',
    });

    expect(libertadores.name).toBe('conmebol-official');
    expect(sudamericana.name).toBe('conmebol-official');
    await expect(sudamericana.syncStructure({ seasonId: 'sud-2026' })).resolves.toEqual(
      await libertadores.syncStructure({ seasonId: 'lib-2026' }),
    );
  });

  it('preserva offset, estadio, grupo e a inversao de mando entre ida e volta', async () => {
    const provider = new ConmebolProvider({
      fixtureName: 'conmebol-libertadores.sanitized.json',
      competition: 'conmebol-libertadores',
    });
    const schedule = await provider.syncSchedule({ seasonId: 'fixture-season' });

    expect(new Date(schedule[0].startsAt!).toISOString()).toBe('2026-04-07T23:00:00.000Z');
    expect(schedule[0]).toMatchObject({
      groupName: 'A',
      venue: { name: 'Estadio Sanitizado', countryCode: 'CHL' },
    });
    expect(schedule.slice(1).map((match) => [match.legNumber, match.homeTeamExternalId])).toEqual([
      [1, 'club:a'],
      [2, 'club:b'],
    ]);
  });

  it('normaliza agregado e penaltis sem somar a disputa ao agregado', async () => {
    const provider = new ConmebolProvider({
      fixtureName: 'conmebol-libertadores.sanitized.json',
      competition: 'conmebol-libertadores',
    });
    const [schedule, results] = await Promise.all([
      provider.syncSchedule({ seasonId: 'fixture-season' }),
      provider.syncResults({ seasonId: 'fixture-season' }),
    ]);
    const resultByMatch = new Map(results.map((result) => [result.matchExternalId, result]));
    const tie = computeTieResult({
      teamAId: 'internal-a',
      teamBId: 'internal-b',
      expectedLegs: 2,
      legs: schedule.slice(1).map((match) => {
        const result = resultByMatch.get(match.externalId)!;
        return {
          matchId: match.externalId,
          legNumber: match.legNumber!,
          status: result.status,
          homeTeamId: match.homeTeamExternalId === 'club:a' ? 'internal-a' : 'internal-b',
          awayTeamId: match.awayTeamExternalId === 'club:a' ? 'internal-a' : 'internal-b',
          regulationHomeScore: result.regulationHomeScore ?? result.homeScore,
          regulationAwayScore: result.regulationAwayScore ?? result.awayScore,
          extraTimeHomeScore: result.extraTimeHomeScore,
          extraTimeAwayScore: result.extraTimeAwayScore,
          penaltyHomeScore: result.penaltyHomeScore,
          penaltyAwayScore: result.penaltyAwayScore,
        };
      }),
    });

    expect(tie).toMatchObject({
      aggregateTeamAScore: 1,
      aggregateTeamBScore: 1,
      decisionMethod: 'PENALTIES',
      winnerTeamId: 'internal-a',
    });
  });

  it('mantem IDs externos na correcao e oferece fallback manual com o contrato identico', async () => {
    const original = conmebolFixture();
    const corrected = structuredClone(original);
    const result = (corrected.data as { results: Array<Record<string, unknown>> }).results.find(
      (item) => item.matchExternalId === 'match:semifinal-leg-2',
    )!;
    Object.assign(result, {
      homeScore: 2,
      awayScore: 0,
      regulationHomeScore: 2,
      regulationAwayScore: 0,
    });
    delete result.penaltyHomeScore;
    delete result.penaltyAwayScore;
    const correctedProvider = new ConmebolProvider({
      snapshot: withSnapshotChecksum(corrected),
      competition: 'conmebol-libertadores',
    });
    const correctedResults = await correctedProvider.syncResults({ seasonId: 'fixture-season' });
    const originalProvider = new ConmebolProvider({
      fixtureName: 'conmebol-libertadores.sanitized.json',
      competition: 'conmebol-libertadores',
    });
    const originalResults = await originalProvider.syncResults({ seasonId: 'fixture-season' });

    expect(correctedResults.map((item) => item.matchExternalId)).toEqual(
      originalResults.map((item) => item.matchExternalId),
    );
    const manual = new ManualProvider({ results: correctedResults });
    await expect(manual.syncResults({ seasonId: 'fixture-season' })).resolves.toEqual(
      correctedResults,
    );
  });

  it('mantem o parser da Copa do Brasil separado do provider da Serie A', async () => {
    const provider = new CbfCopaDoBrasilProvider({
      fixtureName: 'cbf-copa-do-brasil.sanitized.json',
    });
    const [ties, results] = await Promise.all([
      provider.syncTies({ seasonId: 'fixture-season' }),
      provider.syncResults({ seasonId: 'fixture-season' }),
    ]);

    expect(provider.name).toBe('cbf-copa-do-brasil-official');
    expect(ties[0]).toMatchObject({ expectedLegs: 1, decisionMethod: 'PENALTIES' });
    expect(results[0]).toMatchObject({
      regulationHomeScore: 2,
      regulationAwayScore: 2,
      penaltyHomeScore: 4,
      penaltyAwayScore: 3,
    });
  });
});
