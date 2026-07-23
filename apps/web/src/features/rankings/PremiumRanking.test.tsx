import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RankingRowDto } from '@bolao/shared';
import { PremiumRanking } from './PremiumRanking';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span>{name}</span>,
}));

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
  afterEach(cleanup);

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
    expect(screen.getByText('RADAR DO RANKING')).toBeTruthy();
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
});
