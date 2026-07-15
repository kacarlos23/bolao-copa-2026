import { describe, expect, it } from 'vitest';
import {
  activePrimaryDestination,
  competitionForScreen,
  competitionSlugForScreen,
  pageTitle,
  pathForScreen,
  screenForCompetitionSlug,
  screenForPrimaryDestination,
  screenFromPath,
} from './routes';

describe('rotas do Bolão Sirel', () => {
  it('mantém cada área da Copa dentro da rota legada da competição', () => {
    expect(pathForScreen('cup')).toBe('/competicoes/copa-do-mundo-2026');
    expect(pathForScreen('knockout')).toContain('/competicoes/copa-do-mundo-2026/');
    expect(screenFromPath('/competicoes/copa-do-mundo-2026/times/')).toBe('teams');
  });

  it('resolve subpáginas da liga e rejeita caminho desconhecido', () => {
    expect(screenFromPath('/competicoes/brasileirao-serie-a-2026/classificacao')).toBe(
      'brasileirao-standings',
    );
    expect(screenFromPath('/qualquer-coisa')).toBe('not-found');
  });

  it('direciona palpites e ranking conforme as capabilities selecionadas', () => {
    expect(screenForPrimaryDestination('predictions', new Set(['LEAGUE']))).toBe(
      'brasileirao-predictions',
    );
    expect(screenForPrimaryDestination('ranking', new Set(['GROUPS', 'KNOCKOUT']))).toBe('ranking');
    expect(activePrimaryDestination('brasileirao-standings')).toBe('competitions');
  });

  it('usa a nova identidade nos títulos globais', () => {
    expect(pageTitle('home')).toBe('Início · Bolão Sirel');
  });

  it('preserva a identidade exata das competições publicadas', () => {
    expect(competitionSlugForScreen('brasileirao-ranking')).toBe('brasileirao-serie-a');
    expect(competitionSlugForScreen('predictions')).toBe('world-cup');
    expect(screenForCompetitionSlug('brasileirao-serie-a')).toBe('brasileirao');
    expect(screenForCompetitionSlug('world-cup')).toBe('cup');
    expect(screenForCompetitionSlug('outra-liga')).toBeNull();
    expect(
      competitionForScreen(
        [{ slug: 'liga-incorreta' }, { slug: 'brasileirao-serie-a' }],
        'brasileirao',
      ),
    ).toEqual({ slug: 'brasileirao-serie-a' });
  });
});
