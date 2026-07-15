import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvedAdvancingTeam } from '../knockoutDraft';
import { usePrefersReducedMotion } from '../motion';
import { AsyncState } from './AsyncState';
import { ConnectionIndicator } from './ConnectionIndicator';
import { RankingTable, movementLabel } from './RankingTable';
import { ToastProvider, useToast } from './Toast';

const ranking = [
  { rank: 1, userId: 'leader', nickname: 'Ana', avatarUrl: null, points: 24, finalPoints: 24, played: 4, exactScores: 2, resultHits: 1, oneGoalHits: 1, misses: 0, lastFive: [], lastFiveMatches: [], hasLiveData: false },
  { rank: 2, userId: 'current', nickname: 'Maria', avatarUrl: null, points: 21, finalPoints: 21, played: 4, exactScores: 1, resultHits: 2, oneGoalHits: 1, misses: 0, lastFive: [], lastFiveMatches: [], hasLiveData: false },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('componentes obrigatórios de release', () => {
  it('explica ranking, movimento, distância e desempate sem critério oculto', () => {
    render(<RankingTable ranking={ranking} currentUserId="current" previousRanks={new Map([['current', 4]])} roundRanking={ranking} />);
    expect(screen.getByText(/3 pts para Ana/)).toBeTruthy();
    expect(screen.getAllByText('Subiu 2 posições')).toHaveLength(2);
    expect(screen.getByText(/Posição compartilhada/)).toBeTruthy();
    expect(movementLabel(-1)).toBe('Caiu 1 posição');
  });

  it('mantém feedback de erro recuperável e estados SSE inequívocos', () => {
    const retry = vi.fn();
    const { rerender } = render(<AsyncState status="error" error="Falha fixture" onRetry={retry} />);
    fireEvent.click(screen.getByText('Tentar novamente'));
    expect(retry).toHaveBeenCalledOnce();
    rerender(<ConnectionIndicator status="offline" />);
    expect(screen.getByLabelText('Atualizações: Offline')).toBeTruthy();
  });

  it('anuncia, substitui e permite fechar feedback toast', () => {
    function Harness() {
      const toast = useToast();
      return <Pressable accessibilityRole="button" onPress={() => toast.showToast('Salvo com fixture', 'success')}><Text>Mostrar aviso</Text></Pressable>;
    }
    render(<ToastProvider><Harness /></ToastProvider>);
    fireEvent.click(screen.getByText('Mostrar aviso'));
    expect(screen.getByText('Salvo com fixture')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Fechar aviso'));
    expect(screen.queryByText('Salvo com fixture')).toBeNull();
  });

  it('exige classificado válido no empate do mata-mata', () => {
    const participants = { homeTeamId: 'home', awayTeamId: 'away' };
    expect(resolvedAdvancingTeam({ home: '1', away: '1', advancingTeamId: null }, participants)).toBeNull();
    expect(resolvedAdvancingTeam({ home: '1', away: '1', advancingTeamId: 'other' }, participants)).toBeNull();
    expect(resolvedAdvancingTeam({ home: '1', away: '1', advancingTeamId: 'away' }, participants)).toBe('away');
    expect(resolvedAdvancingTeam({ home: '2', away: '1', advancingTeamId: null }, participants)).toBe('home');
  });

  it('lê reduced motion do sistema e acompanha mudança da preferência', () => {
    let listener: (() => void) | undefined;
    let reduced = true;
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return reduced; },
      addEventListener: (_type: string, next: () => void) => { listener = next; },
      removeEventListener: vi.fn(),
    })));
    function Probe() {
      const prefersReduced = usePrefersReducedMotion();
      useEffect(() => undefined, [prefersReduced]);
      return <Text>{prefersReduced ? 'movimento reduzido' : 'movimento completo'}</Text>;
    }
    render(<Probe />);
    expect(screen.getByText('movimento reduzido')).toBeTruthy();
    reduced = false;
    listener?.();
  });
});
