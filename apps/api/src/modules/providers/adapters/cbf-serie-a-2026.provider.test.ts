import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CbfSerieA2026Provider,
  CBF_SERIE_A_2026_ROUND_URL,
  parseCbfLocalStartsAt,
  parseCbfSerieA2026Round,
  parseCbfSerieA2026Standings,
} from './cbf-serie-a-2026.provider.js';

describe('CBF Série A 2026 anti-corruption provider', () => {
  const fixture = readFileSync(
    new URL('../__fixtures__/cbf-serie-a-round.json', import.meta.url),
    'utf8',
  );
  const standingsHtml = `<table><tbody>${Array.from({ length: 20 }, (_, index) => {
    const position = index + 1;
    return `<tr><td><strong class="position">${position}</strong><a href="/futebol-brasileiro/times/campeonato-brasileiro/serie-a/2026/${20_000 + position}"><strong class="teamName">Clube ${position}</strong></a></td><td>${60 - index}</td><td>18</td><td>10</td><td>5</td><td>3</td><td>30</td><td>20</td><td>10</td><td>40</td><td>2</td><td>65</td></tr>`;
  }).join('')}</tbody></table>`;

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

  it('normalizes all 20 official standing rows without crest URLs', () => {
    const standings = parseCbfSerieA2026Standings(standingsHtml);

    expect(standings).toHaveLength(20);
    expect(standings[0]).toEqual({
      externalId: 'standing:20001',
      teamExternalId: 'team:20001',
      teamName: 'Clube 1',
      position: 1,
      points: 60,
      played: 18,
      won: 10,
      drawn: 5,
      lost: 3,
      goalsFor: 30,
      goalsAgainst: 20,
    });
  });

  it('constructs all network locations internally from the fixed official endpoint', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/tabelas/')) {
        return new Response(standingsHtml, { headers: { 'content-type': 'text/html' } });
      }
      if (String(url).includes('example.test')) {
        return new Response(fixture, { headers: { 'content-type': 'application/pdf' } });
      }
      const match = String(url).match(/\/rodada\/(\d+)\/fase/);
      const round = Number(match?.[1]);
      const payload = fixture.replaceAll('"rodada": "20"', `"rodada": "${round}"`);
      return new Response(payload, { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const fixtureDocument = {
      sha256: createHash('sha256').update(fixture).digest('hex'),
      bytes: Buffer.byteLength(fixture),
    };
    const provider = new CbfSerieA2026Provider(
      {
        timeoutMs: 1_000,
        maxBytes: 128 * 1024,
        retries: 0,
        fetchImpl,
      },
      [
        { kind: 'BASIC_TABLE', url: 'https://example.test/basic.pdf', ...fixtureDocument },
        { kind: 'REGULATION', url: 'https://example.test/regulation.pdf', ...fixtureDocument },
      ],
    );

    const evidence = await provider.evidence();

    expect(fetchImpl).toHaveBeenCalledTimes(41);
    expect(fetchImpl).toHaveBeenCalledWith(
      CBF_SERIE_A_2026_ROUND_URL(1),
      expect.objectContaining({ redirect: 'error' }),
    );
    expect(evidence).toEqual(
      expect.objectContaining({
        roundsFetched: 38,
        rawMatches: 114,
        standings: 20,
        timezone: 'America/Sao_Paulo',
      }),
    );
  });
});
