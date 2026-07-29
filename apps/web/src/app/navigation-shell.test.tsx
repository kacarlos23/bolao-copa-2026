import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type User } from '../api';
import { AppHeader } from './AppHeader';
import { CompetitionSubnav } from './CompetitionSubnav';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

vi.mock('./CompetitionContext', () => ({
  useCompetition: () => ({
    capabilities: new Set(['GROUPS', 'KNOCKOUT']),
    capabilityConfig: {
      workspace: 'WORLD_CUP_LEGACY',
      groupStage: true,
      knockoutBracket: true,
    },
  }),
}));

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
    writable: true,
  });
  window.dispatchEvent(new Event('resize'));
}

afterEach(() => {
  cleanup();
  setViewport(1024);
});

const user = {
  id: 'user-tarmac',
  username: 'Tarmac',
  nickname: 'Tarmac',
  role: 'USER',
  avatarUrl: null,
} as User;

describe('shell de navegação', () => {
  it('usa Bolão Sirel e mantém a Copa fora da navegação global', () => {
    setViewport(1280);
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

  it('usa navegação inferior fixa com os quatro destinos reais no mobile', () => {
    setViewport(375);
    const onNavigatePrimary = vi.fn();
    render(
      <AppHeader
        user={user}
        screen="home"
        onNavigatePrimary={onNavigatePrimary}
        onRefresh={vi.fn()}
        onUserChange={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('desktop-primary-navigation')).toBeNull();
    const navigation = screen.getByTestId('mobile-primary-navigation');
    expect(window.getComputedStyle(navigation).position).toBe('fixed');
    const links = screen.getAllByRole('link').filter((link) => navigation.contains(link));
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Início',
      'Competições',
      'Palpites',
      'Ranking',
    ]);
    expect(links).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Início' }).getAttribute('aria-current')).toBe('page');

    fireEvent.click(screen.getByRole('link', { name: 'Palpites' }));
    expect(onNavigatePrimary).toHaveBeenCalledWith('predictions');
  });

  it('mantém um seletor de arquivo conectado e permite alterar a foto de perfil', async () => {
    const onUserChange = vi.fn();
    const updatedUser = { ...user, avatarUrl: '/uploads/avatars/new-avatar.webp' };
    const upload = vi.spyOn(api, 'uploadAvatar').mockResolvedValue({ user: updatedUser });
    const inputClick = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(
      <AppHeader
        user={user}
        screen="home"
        onNavigatePrimary={vi.fn()}
        onRefresh={vi.fn()}
        onUserChange={onUserChange}
        onLogout={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu de Tarmac' }));
    const changeButton = screen.getByRole('button', { name: 'Alterar foto de perfil' });
    const fileInput = screen.getByLabelText('Selecionar nova foto de perfil');
    expect(changeButton.hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('JPG, PNG ou WEBP · até 8 MB')).toBeTruthy();

    fireEvent.click(changeButton);
    expect(inputClick).toHaveBeenCalledOnce();

    const file = new File(['valid-image'], 'avatar.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
    expect(onUserChange).toHaveBeenCalledWith(updatedUser);
  });

  it('abre a Copa como competição legada com subpáginas próprias', () => {
    const onNavigate = vi.fn();
    render(
      <CompetitionSubnav
        section="overview"
        competitionSlug="world-cup"
        competitionName="Copa do Mundo 2026"
        onNavigate={onNavigate}
        onChangeCompetition={vi.fn()}
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
        section="overview"
        competitionSlug="brasileirao-serie-a"
        competitionName="Brasileirão Série A 2026"
        seasons={
          [
            { id: 'season-2026', name: 'Brasileirão Série A 2026', year: 2026 },
            { id: 'season-2025', name: 'Brasileirão Série A 2025', year: 2025 },
          ] as never
        }
        selectedSeasonId="season-2026"
        onNavigate={vi.fn()}
        onChangeCompetition={vi.fn()}
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

  it('mantém Times selecionado dentro das subseções de um clube', () => {
    render(
      <CompetitionSubnav
        section="team-matches"
        competitionSlug="brasileirao-serie-a"
        competitionName="Brasileirão Série A 2026"
        onNavigate={vi.fn()}
        onChangeCompetition={vi.fn()}
      />,
    );

    expect(screen.getByRole('link', { name: 'Times' }).getAttribute('aria-current')).toBe('page');
  });
});
