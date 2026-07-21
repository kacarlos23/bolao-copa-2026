import { describe, expect, it } from 'vitest';
import {
  activePrimaryDestination,
  competitionSectionForScreen,
  pageTitle,
  pathForCompetition,
  pathForLeagueTeam,
  routeFromPath,
  screenForPrimaryDestination,
  screenFromPath,
  teamIdFromPath,
} from './routes';

describe('rotas genéricas do Bolão Sirel', () => {
  it('faz parsing de qualquer slug sem adicionar cases por competição', () => {
    expect(routeFromPath('/competicoes/copa-hibrida-fixture/jogos')).toEqual({
      screen: 'competition-games',
      competitionSlug: 'copa-hibrida-fixture',
      section: 'games',
      teamId: null,
    });
    expect(screenFromPath('/competicoes/copa-hibrida-fixture/chave')).toBe(
      'competition-bracket',
    );
    expect(pathForCompetition('copa-hibrida-fixture', 'standings')).toBe(
      '/competicoes/copa-hibrida-fixture/classificacao',
    );
  });

  it('preserva aliases e deep links publicados da Copa e do Brasileirão', () => {
    expect(routeFromPath('/competicoes/copa-do-mundo-2026/eliminatorias')).toMatchObject({
      competitionSlug: 'world-cup',
      section: 'bracket',
    });
    expect(routeFromPath('/competicoes/brasileirao-serie-a-2026')).toMatchObject({
      competitionSlug: 'brasileirao-serie-a',
      section: 'overview',
    });
    expect(pathForCompetition('world-cup', 'predictions')).toBe(
      '/competicoes/copa-do-mundo-2026/palpites',
    );
  });

  it('gera e interpreta subseções de time no slug selecionado', () => {
    const path = pathForLeagueTeam('copa-hibrida-fixture', 'team/with space', 'matches');
    expect(path).toBe(
      '/competicoes/copa-hibrida-fixture/times/team%2Fwith%20space/partidas',
    );
    expect(screenFromPath(path)).toBe('competition-team-matches');
    expect(teamIdFromPath(path)).toBe('team/with space');
  });

  it('generaliza destinos primários, títulos e seções sem conhecer formato nominal', () => {
    expect(screenForPrimaryDestination('predictions')).toBe('competition-predictions');
    expect(screenForPrimaryDestination('ranking')).toBe('competition-ranking');
    expect(activePrimaryDestination('competition-standings')).toBe('competitions');
    expect(competitionSectionForScreen('competition-ranking')).toBe('ranking');
    expect(pageTitle('competition-ranking', 'Copa Híbrida')).toBe(
      'Ranking de Copa Híbrida · Bolão Sirel',
    );
  });

  it('rejeita seções e slugs malformados', () => {
    expect(screenFromPath('/competicoes/copa-hibrida-fixture/turno')).toBe('not-found');
    expect(screenFromPath('/competicoes/Slug_Invalido/jogos')).toBe('not-found');
    expect(screenFromPath('/qualquer-coisa')).toBe('not-found');
  });
});
