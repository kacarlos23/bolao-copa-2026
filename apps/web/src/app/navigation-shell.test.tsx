import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api';
import { AppHeader } from './AppHeader';
import { CompetitionSubnav } from './CompetitionSubnav';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

afterEach(cleanup);

const user = {
  id: 'user-tarmac',
  username: 'Tarmac',
  nickname: 'Tarmac',
  role: 'USER',
  avatarUrl: null,
} as User;

describe('shell de navegação', () => {
  it('usa Bolão Sirel e mantém a Copa fora da navegação global', () => {
    render(
      <AppHeader
        user={user}
        screen="home"
        onNavigatePrimary={vi.fn()}
        onRefresh={vi.fn()}
        onUserChange={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(screen.getByText('Bolão Sirel')).toBeTruthy();
    expect(screen.queryByText('Copa')).toBeNull();
    expect(screen.getByRole('link', { name: 'Início' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getAllByRole('link')).toHaveLength(5);
  });

  it('abre a Copa como competição legada com subpáginas próprias', () => {
    const onNavigate = vi.fn();
    render(
      <CompetitionSubnav
        screen="cup"
        competitionName="Copa do Mundo 2026"
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByText('LEGADO')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Seções de Copa do Mundo 2026' })).toBeTruthy();
    const predictionsLink = screen.getByRole('link', { name: 'Palpites' });
    expect(predictionsLink.getAttribute('href')).toBe('/competicoes/copa-do-mundo-2026/palpites');
    fireEvent.click(predictionsLink);
    expect(onNavigate).toHaveBeenCalledWith('predictions');
  });

  it('expõe temporadas como botões pressionáveis sem perder o contexto da rota', () => {
    const onSelectSeason = vi.fn();
    render(
      <CompetitionSubnav
        screen="brasileirao"
        competitionName="Brasileirão Série A 2026"
        seasons={
          [
            { id: 'season-2026', name: 'Brasileirão Série A 2026', year: 2026 },
            { id: 'season-2025', name: 'Brasileirão Série A 2025', year: 2025 },
          ] as never
        }
        selectedSeasonId="season-2026"
        onNavigate={vi.fn()}
        onSelectSeason={onSelectSeason}
      />,
    );

    expect(
      screen
        .getByRole('button', { name: 'Brasileirão Série A 2026, atual' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Brasileirão Série A 2025' }));
    expect(onSelectSeason).toHaveBeenCalledWith('season-2025');
  });
});
