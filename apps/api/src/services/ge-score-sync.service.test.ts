import { describe, expect, it } from 'vitest';
import { parseGeScheduleScores } from './ge-score-sync.service.js';

describe('GE schedule score parser', () => {
  it('reads live and finished scores from lista_jogos and ignores future games', () => {
    const html = `<script>{"lista_jogos":[
      {"data_realizacao":"2026-06-24T16:00","equipes":{"mandante":{"nome_popular":"Suíça"},"visitante":{"nome_popular":"Canadá"}},"jogo_ja_comecou":true,"placar_oficial_mandante":1,"placar_oficial_visitante":0,"transmissao":{"broadcast":{"id":"AO_VIVO","label":"acompanhe"},"url":"https://ge.globo.com/jogo/live"}},
      {"data_realizacao":"2026-06-23T17:00","equipes":{"mandante":{"nome_popular":"Inglaterra"},"visitante":{"nome_popular":"Gana"}},"jogo_ja_comecou":true,"placar_oficial_mandante":0,"placar_oficial_visitante":0,"transmissao":{"broadcast":{"id":"ENCERRADA","label":"saiba como foi"},"url":"https://ge.globo.com/jogo/final"}},
      {"data_realizacao":"2026-06-25T17:00","equipes":{"mandante":{"nome_popular":"Equador"},"visitante":{"nome_popular":"Alemanha"}},"jogo_ja_comecou":false,"placar_oficial_mandante":null,"placar_oficial_visitante":null,"transmissao":{"broadcast":{"id":"PRE_DIA"}}}
    ]}</script>`;

    expect(parseGeScheduleScores(html)).toEqual([
      expect.objectContaining({
        homeTeam: 'Suíça',
        awayTeam: 'Canadá',
        homeScore: 1,
        awayScore: 0,
        status: 'ao vivo',
      }),
      expect.objectContaining({
        homeTeam: 'Inglaterra',
        awayTeam: 'Gana',
        homeScore: 0,
        awayScore: 0,
        status: 'encerrado',
      }),
    ]);
  });
});
