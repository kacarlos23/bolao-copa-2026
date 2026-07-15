import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CbfSerieA2026Provider,
  CBF_SERIE_A_2026_ROUND_URL,
  parseCbfLocalStartsAt,
  parseCbfSerieA2026Round,
} from './cbf-serie-a-2026.provider.js';

describe('CBF Série A 2026 anti-corruption provider', () => {
  const fixture = readFileSync(
    new URL('../__fixtures__/cbf-serie-a-round.json', import.meta.url),
    'utf8',
  );

  it('normalizes only reconciled dates and never imports crest URLs', () => {
    const parsed = parseCbfSerieA2026Round(fixture, 20);

    expect(parsed.rawMatches).toBe(3);
    expect(parsed.schedule).toHaveLength(2);
    expect(parsed.results).toEqual([
      expect.objectContaining({
        matchExternalId: 'match:fixture-finished',
        homeScore: 2,
        awayScore: 1,
        homeYellowCards: 1,
        awayYellowCards: 1,
        awayRedCards: 1,
      }),
    ]);
    expect(parsed.unscheduledExternalIds).toEqual(['match:fixture-undefined']);
    expect(parsed.teams.every((team) => team.crestUrl === undefined)).toBe(true);
  });

  it('parses Brasília civil time strictly and rejects impossible or undefined dates', () => {
    expect(parseCbfLocalStartsAt('25/07/2026', '18:30')).toBe('2026-07-25T21:30:00.000Z');
    expect(parseCbfLocalStartsAt('31/02/2026', '18:30')).toBeNull();
    expect(parseCbfLocalStartsAt('A Definir', '')).toBeNull();
  });

  it('constructs all network locations internally from the fixed official endpoint', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const match = String(url).match(/\/rodada\/(\d+)\/fase/);
      const round = Number(match?.[1]);
      const payload = fixture.replaceAll('"rodada": "20"', `"rodada": "${round}"`);
      return new Response(payload, { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const provider = new CbfSerieA2026Provider({
      timeoutMs: 1_000,
      maxBytes: 128 * 1024,
      retries: 0,
      fetchImpl,
    });

    const evidence = await provider.evidence();

    expect(fetchImpl).toHaveBeenCalledTimes(40);
    expect(fetchImpl).toHaveBeenCalledWith(
      CBF_SERIE_A_2026_ROUND_URL(1),
      expect.objectContaining({ redirect: 'error' }),
    );
    expect(evidence).toEqual(
      expect.objectContaining({ roundsFetched: 38, rawMatches: 114, timezone: 'America/Sao_Paulo' }),
    );
  });
});
