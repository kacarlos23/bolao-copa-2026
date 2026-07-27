import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../api';
import { useCompetition } from '../../app/CompetitionContext';
import { HomeScreen } from './HomeScreen';

vi.mock('../../app/CompetitionContext', () => ({
  useCompetition: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const user: User = {
  id: 'user-fixture',
  username: 'joao',
  nickname: 'João Sirel',
  role: 'USER',
};

function activeContext() {
  return {
    competitions: [],
    seasons: [],
    competition: {
      id: 'competition-fixture',
      slug: 'liga-fixture',
      name: 'Liga Fixture',
      capabilities: { format: 'LEAGUE' as const },
    },
    season: {
      id: 'season-fixture',
      competitionId: 'competition-fixture',
      slug: 'liga-fixture-2026',
      name: 'Liga Fixture 2026',
      year: 2026,
      timezone: 'America/Sao_Paulo',
      status: 'ACTIVE' as const,
      startsAt: null,
      endsAt: null,
      capabilities: { format: 'LEAGUE' as const },
    },
    capabilityConfig: { format: 'LEAGUE' as const },
    capabilities: new Set(['LEAGUE'] as const),
    uiEnabled: true,
    loading: false,
    error: '',
    selectCompetition: vi.fn(),
    selectSeason: vi.fn(),
    retry: vi.fn(),
  } as ReturnType<typeof useCompetition>;
}

describe('HomeScreen', () => {
  it('prioriza a temporada real e mantém as rotas existentes', () => {
    vi.mocked(useCompetition).mockReturnValue(activeContext());
    const onNavigate = vi.fn();
    const onNavigateCompetition = vi.fn();

    render(
      <HomeScreen
        user={user}
        onNavigate={onNavigate}
        onNavigateCompetition={onNavigateCompetition}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Visão geral' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Liga Fixture 2026' })).toBeTruthy();
    expect(screen.getByText('Em andamento')).toBeTruthy();
    expect(screen.getByText('Pontos corridos')).toBeTruthy();

    const predictions = screen.getByRole('link', {
      name: 'Abrir palpites de Liga Fixture 2026',
    });
    expect(predictions.getAttribute('href')).toBe('/competicoes/liga-fixture/palpites');
    fireEvent.click(predictions);
    expect(onNavigateCompetition).toHaveBeenCalledWith('liga-fixture', 'predictions');

    const games = screen.getByRole('link', { name: 'Ver jogos' });
    expect(games.getAttribute('href')).toBe('/competicoes/liga-fixture/jogos');
    fireEvent.click(games);
    expect(onNavigateCompetition).toHaveBeenCalledWith('liga-fixture', 'games');

    fireEvent.click(screen.getByRole('link', { name: 'Trocar campeonato' }));
    expect(onNavigate).toHaveBeenCalledWith('competitions');
  });

  it('orienta para a central sem exibir atalhos de uma temporada inexistente', () => {
    vi.mocked(useCompetition).mockReturnValue({
      ...activeContext(),
      competition: null,
      season: null,
      capabilities: new Set(),
    });

    render(
      <HomeScreen user={user} onNavigate={vi.fn()} onNavigateCompetition={vi.fn()} />,
    );

    expect(screen.getByText('Escolha uma competição')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Ver jogos' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Abrir ranking' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Trocar campeonato' })).toBeTruthy();
  });
});
