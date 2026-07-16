import { describe, expect, it, vi } from 'vitest';
import {
  CBF_SERIE_A_2026_TEAM_URL,
  collectCbfTeamProfile,
  parseCbfTeamProfile,
} from './cbf-team-profile.provider.js';

function profileHtml(overrides: Record<string, unknown> = {}) {
  const data = {
    campeonato: { nome: 'Campeonato Brasileiro', categoria: 'Série A', exercicio: '2026' },
    time: [{ time_id: '60646', time_nome: 'Vasco da Gama Saf', time_uf: 'RJ' }],
    estatisticas: [
      {
        gols_feitos: '2',
        gols_sofridos: '1',
        jogos_sem_sofrer_gol: '0',
        jogos_disputados: '1',
        vitorias: '1',
        derrotas: '0',
        empates: '0',
        cartoes_amarelos: '3',
        cartoes_vermelhos: '0',
      },
    ],
    jogos: [
      {
        id_jogo: '832001',
        num_jogo: '112',
        rodada: '12',
        mandante: { id: '60646', nome: 'Vasco da Gama Saf', gols: '2' },
        visitante: { id: '20005', nome: 'São Paulo', gols: '1' },
        local: 'São Januário - Rio de Janeiro - RJ',
        data: ' 18/04/2026',
        hora: '18:30',
      },
    ],
    atletas: [
      {
        atleta_id: '609746',
        atleta_nome: 'Atleta de Teste',
        Atleta_apelido: 'Teste',
        clube_nome_popular: 'Outro Clube',
        clube_uf: 'SP',
        clube_id: '60646',
      },
    ],
    historico: { id: ['832001'] },
    ...overrides,
  };
  const flight = `26:["$","$L1",null,{"data":${JSON.stringify(data)}}]`;
  return `<html><body><script>self.__next_f.push(${JSON.stringify([1, flight])})</script></body></html>`;
}

describe('CBF team profile anti-corruption adapter', () => {
  it('decodes the Next flight payload and normalizes only bounded public fields', () => {
    const profile = parseCbfTeamProfile(profileHtml(), '60646');

    expect(profile).toEqual({
      externalTeamId: '60646',
      name: 'Vasco da Gama Saf',
      state: 'RJ',
      athletes: [
        {
          externalId: '609746',
          fullName: 'Atleta de Teste',
          nickname: 'Teste',
          currentClub: { externalId: '60646', name: 'Outro Clube', state: 'SP' },
        },
      ],
      matches: [
        {
          externalId: '832001',
          reference: '112',
          round: 12,
          startsAt: '2026-04-18T21:30:00.000Z',
          home: { externalId: '60646', name: 'Vasco da Gama Saf', score: 2 },
          away: { externalId: '20005', name: 'São Paulo', score: 1 },
          venue: 'São Januário - Rio de Janeiro - RJ',
          result: 'WIN',
        },
      ],
      statistics: {
        goalsFor: 2,
        goalsAgainst: 1,
        cleanSheets: 0,
        played: 1,
        wins: 1,
        draws: 0,
        losses: 0,
        yellowCards: 3,
        redCards: 0,
      },
    });
  });

  it('fails closed on a crossed team id and inconsistent statistics', () => {
    expect(() => parseCbfTeamProfile(profileHtml(), '20005')).toThrow(/instead of/);
    expect(() =>
      parseCbfTeamProfile(
        profileHtml({
          estatisticas: [
            {
              gols_feitos: '0',
              gols_sofridos: '0',
              jogos_sem_sofrer_gol: '0',
              jogos_disputados: '2',
              vitorias: '1',
              derrotas: '0',
              empates: '0',
              cartoes_amarelos: '0',
              cartoes_vermelhos: '0',
            },
          ],
        }),
        '60646',
      ),
    ).toThrow(/played = wins/);
  });

  it('constructs the only remote URL internally and refuses redirects', async () => {
    const fetchImpl = vi.fn(async () => new Response(profileHtml()));
    const result = await collectCbfTeamProfile('60646', {
      timeoutMs: 1_000,
      maxBytes: 64 * 1024,
      retries: 0,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      CBF_SERIE_A_2026_TEAM_URL('60646'),
      expect.objectContaining({ redirect: 'error' }),
    );
    expect(result.athletes).toHaveLength(1);
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(() => CBF_SERIE_A_2026_TEAM_URL('../admin')).toThrow();
  });
});
