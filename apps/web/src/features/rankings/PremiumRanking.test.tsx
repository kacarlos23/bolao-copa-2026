import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankingRowDto } from '@bolao/shared';
import type { EngagementDashboard, RankingAward } from '../../api';
import { PremiumRanking, RankingUserAvatar } from './PremiumRanking';

vi.mock('@expo/vector-icons', () => {
  const Icon = ({ name }: { name: string }) => <span>{name}</span>;
  return { default: Icon, Ionicons: Icon };
});

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

function row(rank: number, nickname: string, points: number): RankingRowDto {
  return {
    rank,
    userId: `user-${rank}`,
    nickname,
    avatarUrl: null,
    points,
    finalPoints: points,
    played: 2,
    exactScores: rank === 1 ? 2 : 1,
    resultHits: 1,
    oneGoalHits: 0,
    misses: 0,
    lastFive: [15, 3],
    lastFiveMatches: [],
    hasLiveData: rank === 2,
    movement: {
      delta: rank === 1 ? 1 : 0,
      fromRank: rank + 1,
      toRank: rank,
      isProvisional: false,
      changedAt: '2026-07-16T12:00:00.000Z',
    },
  };
}

describe('PremiumRanking', () => {
  beforeEach(() => setViewport(1366));
  afterEach(() => {
    cleanup();
    setViewport(1366);
  });

  it('usa uma imagem web real e mostra as iniciais quando o avatar falha', () => {
    const { rerender } = render(
      <RankingUserAvatar
        row={{ nickname: 'Ana Beatriz', avatarUrl: '/uploads/avatars/ana.webp' }}
      />,
    );

    const image = screen.getByRole('img', { name: 'Foto de perfil de Ana Beatriz' });
    expect(image.getAttribute('src')).toBe('/uploads/avatars/ana.webp');
    expect(image.getAttribute('style')).toContain('object-fit: cover');

    fireEvent.error(image);
    expect(screen.getByText('AB')).toBeTruthy();

    rerender(
      <RankingUserAvatar
        row={{ nickname: 'Ana Beatriz', avatarUrl: '/uploads/avatars/ana-v2.webp' }}
      />,
    );
    expect(screen.getByRole('img', { name: 'Foto de perfil de Ana Beatriz' })).toBeTruthy();
  });

  it('renderiza pódio, indicadores, filtros, radar e destaque do usuário', () => {
    const ranking = [row(1, 'Ana', 30), row(2, 'Bruno', 24), row(3, 'Carla', 20)];
    render(
      <PremiumRanking
        seasonName="Brasileirão Série A 2026"
        ranking={ranking}
        roundRanking={ranking}
        currentUserId="user-2"
        scope="overall"
        onScopeChange={vi.fn()}
        connection="live"
        syncing={false}
        lastSyncedAt="2026-07-16T12:00:00.000Z"
        onRefresh={vi.fn()}
        awards={[]}
        engagement={null}
        tieBreakers={[]}
      />,
    );

    expect(screen.getByText('Corrida pelo topo')).toBeTruthy();
    expect(screen.getByText('SUA POSIÇÃO')).toBeTruthy();
    expect(screen.getAllByText('VOCÊ').length).toBeGreaterThan(0);
  });

  it('abre perfil e sala de troféus por ações acessíveis', () => {
    const ranking = [row(1, 'Ana', 30), row(2, 'Bruno', 24), row(3, 'Carla', 20)];
    render(
      <PremiumRanking
        seasonName="Brasileirão Série A 2026"
        ranking={ranking}
        roundRanking={ranking}
        currentUserId="user-2"
        scope="overall"
        onScopeChange={vi.fn()}
        connection="live"
        syncing={false}
        lastSyncedAt={null}
        onRefresh={vi.fn()}
        awards={[]}
        engagement={null}
        tieBreakers={[]}
      />,
    );

    fireEvent.click(screen.getByLabelText('Abrir perfil de Ana, 1º lugar'));
    expect(screen.getByText('1º lugar · 30 pontos')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Fechar perfil'));
    fireEvent.click(screen.getByText('Sala de Troféus'));
    expect(screen.getByText('Temporada & conquistas')).toBeTruthy();
    expect(screen.getAllByText('Brasileirão Série A 2026').length).toBeGreaterThan(0);
  });

  it('identifica a sala e o hero ao trocar de temporada sem fallback para liga', () => {
    const ranking = [row(1, 'Ana', 30)];
    render(
      <PremiumRanking
        seasonName="CONMEBOL Libertadores 2026"
        ranking={ranking}
        roundRanking={ranking}
        currentUserId="user-1"
        scope="overall"
        availableScopes={new Set(['OVERALL', 'STAGE', 'ROUND'])}
        onScopeChange={vi.fn()}
        connection="live"
        syncing={false}
        lastSyncedAt={null}
        onRefresh={vi.fn()}
        awards={[]}
        engagement={null}
        tieBreakers={[]}
      />,
    );

    expect(screen.getByText('CONMEBOL LIBERTADORES 2026')).toBeTruthy();
    expect(screen.queryByText('BRASILEIRÃO SÉRIE A · 2026')).toBeNull();
    expect(screen.queryByText('Turno 1')).toBeNull();
    fireEvent.click(screen.getByText('Sala de Troféus'));
    expect(screen.getByText('CONMEBOL Libertadores 2026')).toBeTruthy();
  });

  it('keeps the premium ranking and fundraising KPI visible with zero scores', () => {
    render(
      <PremiumRanking
        seasonName="Brasileirão Série A 2026"
        ranking={[]}
        roundRanking={[]}
        currentUserId="user-1"
        scope="overall"
        onScopeChange={vi.fn()}
        connection="live"
        syncing={false}
        lastSyncedAt={null}
        onRefresh={vi.fn()}
        awards={[]}
        engagement={null}
        tieBreakers={[]}
        fundraisingCents={0}
      />,
    );

    expect(screen.getByText('Corrida pelo topo')).toBeTruthy();
    expect(screen.getByText('Valor arrecadado')).toBeTruthy();
    expect(screen.getByText(/R\$\s*0,00/)).toBeTruthy();
    expect(screen.getByText('Ação entre amigos para custear a viagem')).toBeTruthy();
    expect(screen.getByText('0 participante(s)')).toBeTruthy();
  });

  it('formats the fundraising KPI with Brazilian thousands and cents', () => {
    render(
      <PremiumRanking
        seasonName="Brasileirão Série A 2026"
        ranking={[row(1, 'Ana', 0)]}
        roundRanking={[]}
        currentUserId="user-1"
        scope="overall"
        onScopeChange={vi.fn()}
        connection="live"
        syncing={false}
        lastSyncedAt={null}
        onRefresh={vi.fn()}
        awards={[]}
        engagement={null}
        tieBreakers={[]}
        fundraisingCents={125_000}
      />,
    );

    expect(screen.getByText(/R\$\s*1\.250,00/)).toBeTruthy();
  });

  it('preserva a ordem do backend, movimento, filtros, escopos e critérios reais', () => {
    const ranking = [
      row(2, 'Bruno', 24),
      row(1, 'Ana', 30),
      {
        ...row(3, 'Carla', 20),
        movement: {
          delta: -2,
          fromRank: 1,
          toRank: 3,
          isProvisional: true,
          changedAt: '2026-07-16T12:00:00.000Z',
        },
      },
    ];
    const onScopeChange = vi.fn();
    render(
      <PremiumRanking
        seasonName="Brasileirão Série A 2026"
        ranking={ranking}
        roundRanking={[
          { ...ranking[0], points: 7 },
          { ...ranking[1], points: 5 },
          { ...ranking[2], points: 2 },
        ]}
        currentUserId="user-2"
        scope="overall"
        availableScopes={new Set(['OVERALL', 'ROUND'])}
        onScopeChange={onScopeChange}
        connection="live"
        syncing={false}
        lastSyncedAt={null}
        onRefresh={vi.fn()}
        awards={[]}
        engagement={null}
        tieBreakers={['Placar exato', 'Resultado correto']}
      />,
    );

    const renderedRows = screen.getAllByTestId(/^ranking-row-/);
    expect(renderedRows.map((item) => item.getAttribute('data-testid'))).toEqual([
      'ranking-row-user-2',
      'ranking-row-user-1',
      'ranking-row-user-3',
    ]);
    expect(
      within(screen.getByTestId('ranking-row-user-3')).getByLabelText(
        'Movimento caiu 2 posições',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Critérios de desempate')).toBeTruthy();
    expect(screen.getByText(/Placar exato → Resultado correto/)).toBeTruthy();
    expect(screen.queryByText('Turno 1')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rodada' }));
    expect(onScopeChange).toHaveBeenCalledWith('round');

    fireEvent.click(screen.getByRole('button', { name: 'Ao vivo' }));
    expect(screen.getAllByTestId(/^ranking-row-/)).toHaveLength(1);
    expect(screen.getByTestId('ranking-row-user-2')).toBeTruthy();
  });

  it('usa lista compacta sem tabela larga em 320 px e mantém as métricas da linha', () => {
    setViewport(320);
    const ranking = [row(1, 'Ana', 30), row(2, 'Bruno', 24), row(3, 'Carla', 20)];
    render(
      <PremiumRanking
        seasonName="Brasileirão Série A 2026"
        ranking={ranking}
        roundRanking={ranking.map((item, index) => ({ ...item, points: 9 - index }))}
        currentUserId="user-2"
        scope="overall"
        onScopeChange={vi.fn()}
        connection="live"
        syncing={false}
        lastSyncedAt={null}
        onRefresh={vi.fn()}
        awards={[]}
        engagement={null}
        tieBreakers={[]}
      />,
    );

    expect(screen.getByTestId('ranking-list-compact')).toBeTruthy();
    expect(screen.queryByTestId('ranking-table-desktop')).toBeNull();
    const currentRow = within(screen.getByTestId('ranking-row-user-2'));
    expect(currentRow.getByText('Bruno · Você')).toBeTruthy();
    expect(currentRow.getByText('24')).toBeTruthy();
    expect(currentRow.getByText('8')).toBeTruthy();
    expect(currentRow.getByText('Provisório')).toBeTruthy();
    expect(currentRow.getByLabelText('Movimento estável 0 posições')).toBeTruthy();
  });

  it('mantém awards, conquistas e sequências retornados pela API', () => {
    const ranking = [row(1, 'Ana', 30)];
    const awards: RankingAward[] = [
      {
        key: 'overall',
        title: 'Campeã geral',
        subtitle: 'Maior pontuação consolidada',
        scope: 'OVERALL',
        tier: 'major',
        status: 'locked',
        icon: 'trophy',
        winner: {
          userId: 'user-1',
          nickname: 'Ana',
          avatarUrl: null,
          points: 30,
          exactScores: 2,
          resultHits: 1,
          oneGoalHits: 0,
          misses: 0,
        },
      },
    ];
    const engagement: EngagementDashboard = {
      achievements: [
        {
          id: 'achievement-1',
          progress: { current: 3, target: 5 },
          isProvisional: false,
          achievedAt: null,
          revokedAt: null,
          definition: {
            key: 'regularidade',
            version: 1,
            name: 'Regularidade',
            description: 'Pontuar em cinco rodadas.',
            rarity: 'COMMON',
          },
        },
      ],
      streaks: [{ type: 'RESULT_HIT', currentCount: 2, bestCount: 4 }],
      notifications: [],
      preferences: {
        inAppEnabled: true,
        pushEnabled: false,
        emailEnabled: false,
        quietHoursEnabled: false,
        timezone: 'America/Sao_Paulo',
      },
    };
    render(
      <PremiumRanking
        seasonName="Brasileirão Série A 2026"
        ranking={ranking}
        roundRanking={ranking}
        currentUserId="user-1"
        scope="overall"
        onScopeChange={vi.fn()}
        connection="live"
        syncing={false}
        lastSyncedAt={null}
        onRefresh={vi.fn()}
        awards={awards}
        engagement={engagement}
        tieBreakers={[]}
      />,
    );

    fireEvent.click(screen.getByText('Sala de Troféus'));
    expect(screen.getByText('Campeã geral')).toBeTruthy();
    expect(screen.getAllByText('Ana').length).toBeGreaterThan(0);
    expect(screen.getByText('Regularidade')).toBeTruthy();
    expect(screen.getByText('3/5')).toBeTruthy();
    expect(screen.getByText('2 atual · 4 melhor')).toBeTruthy();
  });
});
