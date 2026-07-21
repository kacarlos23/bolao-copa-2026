import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { CompetitionProvider, useCompetition } from './CompetitionContext';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const competitions = [
  {
    id: 'competition-league',
    slug: 'league-fixture',
    name: 'Liga Fixture',
    capabilities: { format: 'LEAGUE' as const, standings: true },
  },
  {
    id: 'competition-hybrid',
    slug: 'hybrid-fixture',
    name: 'Copa Híbrida Fixture',
    capabilities: { format: 'GROUPS' as const, groupStage: true, knockout: true },
  },
];

const seasonByCompetition = {
  'league-fixture': {
    id: 'season-league',
    competitionId: 'competition-league',
    slug: 'league-season',
    name: 'Liga Fixture 2026',
    year: 2026,
    timezone: 'America/Sao_Paulo',
    status: 'ACTIVE' as const,
    startsAt: null,
    endsAt: null,
    capabilities: { format: 'LEAGUE' as const },
  },
  'hybrid-fixture': {
    id: 'season-hybrid',
    competitionId: 'competition-hybrid',
    slug: 'hybrid-season',
    name: 'Copa Híbrida Fixture 2026',
    year: 2026,
    timezone: 'America/Sao_Paulo',
    status: 'ACTIVE' as const,
    startsAt: null,
    endsAt: null,
    capabilities: { groupStage: true, knockout: true },
  },
};

function Harness() {
  const context = useCompetition();
  return (
    <div>
      <span>{context.season?.name ?? 'carregando'}</span>
      <span>{context.uiEnabled ? 'ui habilitada' : 'ui bloqueada'}</span>
      <span>{context.loading ? 'contexto carregando' : 'contexto pronto'}</span>
      <button onClick={() => void context.selectCompetition('competition-league')}>
        abrir liga
      </button>
      {context.seasons.map((season) => (
        <button
          key={season.id}
          aria-label={`selecionar ${season.name}`}
          onClick={() => context.selectSeason(season.id)}
        >
          {season.year}
        </button>
      ))}
    </div>
  );
}

describe('CompetitionContext', () => {
  it('prioriza a competição da rota e troca temporadas sem request cruzada', async () => {
    window.localStorage.setItem('bolao:selected-competition', 'competition-league');
    vi.spyOn(api, 'competitions').mockResolvedValue({
      competitions,
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    });
    const seasonsSpy = vi.spyOn(api, 'competitionSeasons').mockImplementation(async (slug) => ({
      competition: competitions.find((item) => item.slug === slug)!,
      seasons: [seasonByCompetition[slug as keyof typeof seasonByCompetition]],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    }));
    vi.spyOn(api, 'seasonUiFeature').mockResolvedValue({ uiEnabled: true });

    render(
      <CompetitionProvider initialCompetitionSlug="hybrid-fixture">
        <Harness />
      </CompetitionProvider>,
    );

    expect(await screen.findByText('Copa Híbrida Fixture 2026')).toBeTruthy();
    expect(seasonsSpy).toHaveBeenCalledTimes(1);
    expect(seasonsSpy).toHaveBeenLastCalledWith('hybrid-fixture', expect.any(AbortSignal));
    expect(JSON.stringify(seasonsSpy.mock.calls)).not.toContain('brasileirao');

    fireEvent.click(screen.getByRole('button', { name: 'abrir liga' }));
    await waitFor(() => expect(screen.getByText('Liga Fixture 2026')).toBeTruthy());
    expect(seasonsSpy).toHaveBeenLastCalledWith('league-fixture', expect.any(AbortSignal));
  });

  it('ignora resposta atrasada da temporada anterior durante troca rápida', async () => {
    const league2025 = {
      ...seasonByCompetition['league-fixture'],
      id: 'season-league-2025',
      slug: 'league-season-2025',
      name: 'Liga Fixture 2025',
      year: 2025,
    };
    vi.spyOn(api, 'competitions').mockResolvedValue({
      competitions: [competitions[0]],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
    vi.spyOn(api, 'competitionSeasons').mockResolvedValue({
      competition: competitions[0],
      seasons: [seasonByCompetition['league-fixture'], league2025],
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    });
    const resolvers = new Map<string, (value: { uiEnabled: boolean }) => void>();
    vi.spyOn(api, 'seasonUiFeature').mockImplementation(
      (seasonId) =>
        new Promise((resolve) => {
          resolvers.set(seasonId, resolve);
        }),
    );

    render(
      <CompetitionProvider initialCompetitionSlug="league-fixture">
        <Harness />
      </CompetitionProvider>,
    );
    await waitFor(() => expect(resolvers.has('season-league')).toBe(true));
    resolvers.get('season-league')?.({ uiEnabled: true });
    expect(await screen.findByText('contexto pronto')).toBeTruthy();
    resolvers.delete('season-league');

    fireEvent.click(screen.getByRole('button', { name: 'selecionar Liga Fixture 2025' }));
    await waitFor(() => expect(resolvers.has('season-league-2025')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'selecionar Liga Fixture 2026' }));
    await waitFor(() => expect(resolvers.has('season-league')).toBe(true));
    resolvers.get('season-league')?.({ uiEnabled: true });
    resolvers.get('season-league-2025')?.({ uiEnabled: false });

    expect(await screen.findByText('contexto pronto')).toBeTruthy();
    expect(screen.getByText('Liga Fixture 2026')).toBeTruthy();
    expect(screen.getByText('ui habilitada')).toBeTruthy();
  });
});
