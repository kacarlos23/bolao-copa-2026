import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MatchDto, RoundDto, TieDto } from '@bolao/shared';

vi.mock('../../components/TeamBadge', () => ({
  TeamBadge: ({ name }: { name: string }) => name,
}));

import {
  CompetitionHero,
  GroupStandings,
  KnockoutBracket,
  MatchPredictionCard,
  RoundSelector,
  StageSelector,
  resolveCompetitionPresentation,
} from './CompetitionExperience';

const teamA = { id: 'team-a', name: 'Atlético', code: 'ATL', flagUrl: null, crestUrl: null };
const teamB = { id: 'team-b', name: 'Nacional', code: 'NAC', flagUrl: null, crestUrl: null };

const groupRound = {
  id: 'round-groups',
  seasonId: 'season-groups',
  stageId: 'stage-groups',
  name: 'Rodada 1',
  order: 1,
  status: 'ACTIVE',
  startsAt: '2026-08-01T18:00:00.000Z',
  endsAt: null,
  stage: { id: 'stage-groups', name: 'Fase de grupos', type: 'GROUP' },
} as RoundDto;

const knockoutRound = {
  ...groupRound,
  id: 'round-final',
  stageId: 'stage-knockout',
  name: 'Final',
  order: 2,
  stage: { id: 'stage-knockout', name: 'Eliminatórias', type: 'KNOCKOUT' },
} as RoundDto;

const match = {
  id: 'match-1',
  seasonId: 'season-groups',
  stageId: groupRound.stageId,
  roundId: groupRound.id,
  tieId: null,
  legNumber: null,
  matchDayId: 'day-1',
  startsAt: '2026-08-01T18:00:00.000Z',
  predictionClosesAt: '2026-08-01T17:55:00.000Z',
  status: 'SCHEDULED',
  homeScore: null,
  awayScore: null,
  finalHomeScore: null,
  finalAwayScore: null,
  regulationHomeScore: null,
  regulationAwayScore: null,
  extraTimeHomeScore: null,
  extraTimeAwayScore: null,
  penaltyHomeScore: null,
  penaltyAwayScore: null,
  homeTeam: teamA,
  awayTeam: teamB,
} as MatchDto;

const tie = {
  id: 'tie-final',
  seasonId: 'season-groups',
  stageId: knockoutRound.stageId,
  roundId: knockoutRound.id,
  key: 'final',
  order: 1,
  expectedLegs: 2,
  status: 'DECIDED',
  decisionMethod: 'PENALTIES',
  aggregateTeamAScore: 2,
  aggregateTeamBScore: 2,
  decidedAt: '2026-11-28T22:00:00.000Z',
  lastRecomputedAt: '2026-11-28T22:00:00.000Z',
  provenance: 'fixture',
  metadata: null,
  teamA,
  teamB,
  winnerTeam: teamB,
  matches: [
    {
      ...match,
      id: 'leg-1',
      tieId: 'tie-final',
      legNumber: 1,
      regulationHomeScore: 1,
      regulationAwayScore: 1,
    },
    {
      ...match,
      id: 'leg-2',
      tieId: 'tie-final',
      legNumber: 2,
      regulationHomeScore: 1,
      regulationAwayScore: 1,
      penaltyHomeScore: 3,
      penaltyAwayScore: 4,
    },
  ],
} as TieDto;

describe('experiência genérica de competições', () => {
  it('resolve tema configurável com fallback local e sem imagem remota', () => {
    expect(
      resolveCompetitionPresentation({ id: 'season-fixture', name: 'Copa fixture' }),
    ).toMatchObject({
      accent: expect.stringMatching(/^#/),
      surface: expect.stringMatching(/^#/),
    });
    render(
      <CompetitionHero
        competition={{ id: 'competition-fixture', name: 'Copa fixture' }}
        season={{ name: 'Copa fixture 2026', year: 2026 }}
        capabilities={new Set(['GROUPS', 'KNOCKOUT'])}
        presentation={{ theme: { accent: '#ffffff', surface: '#123456' } }}
        connection="live"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Copa fixture 2026' })).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('seleciona fases e rodadas pelo mesmo componente', () => {
    const stageChange = vi.fn();
    const roundChange = vi.fn();
    render(
      <>
        <StageSelector
          stages={[groupRound.stage, knockoutRound.stage]}
          selectedStageId={groupRound.stageId}
          onChange={stageChange}
        />
        <RoundSelector
          rounds={[groupRound, knockoutRound]}
          selectedRoundId={groupRound.id}
          onChange={roundChange}
        />
      </>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Eliminatórias' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Final' }));
    expect(stageChange).toHaveBeenCalledWith('stage-knockout');
    expect(roundChange).toHaveBeenCalledWith('round-final');
  });

  it('mostra os grupos A a H sem depender de uma tabela de liga', () => {
    const groups = 'ABCDEFGH'.split('').map((group, index) => ({
      group,
      rows: [
        {
          rank: 1,
          group,
          team: { ...teamA, id: `team-${group}` },
          played: 1,
          wins: 1,
          draws: 0,
          losses: 0,
          goalsFor: 2,
          goalsAgainst: 0,
          goalDifference: 2,
          points: 3 + index,
          yellowCards: 0,
          redCards: 0,
          tieBreakRuleVersion: 'v1',
          lastFive: ['W'],
        },
      ],
    }));
    render(<GroupStandings groups={groups} />);
    expect(screen.getByText('Grupo A')).toBeTruthy();
    expect(screen.getByText('Grupo H')).toBeTruthy();
    expect(screen.queryByText('Turno 1')).toBeNull();
  });

  it('apresenta ida, volta, agregado, pênaltis e classificado em uma chave', () => {
    render(<KnockoutBracket ties={[tie]} rounds={[knockoutRound]} status="success" />);
    expect(screen.getByText('IDA E VOLTA')).toBeTruthy();
    expect(screen.getByText('Agregado 2 × 2')).toBeTruthy();
    expect(screen.getByText('Pênaltis')).toBeTruthy();
    expect(screen.getByText('Classificado')).toBeTruthy();
    expect(screen.getByText('Pên. 3–4')).toBeTruthy();
  });

  it('fecha o palpite individualmente, expõe sync e só abre previsões públicas após o prazo', () => {
    const save = vi.fn();
    const discard = vi.fn();
    const publicPredictions = vi.fn();
    render(
      <MatchPredictionCard
        match={match}
        value={{ home: '1', away: '0' }}
        item={{
          value: { home: '1', away: '0' },
          dirty: { home: true, away: true },
          status: 'dirty',
        }}
        open={false}
        availabilityLabel="FECHADO"
        unavailableReason="O prazo terminou."
        timezone="America/Sao_Paulo"
        onEdit={vi.fn()}
        onSave={save}
        onDiscard={discard}
      />,
    );
    expect(screen.getByText('Não salvo')).toBeTruthy();
    expect(screen.queryByText('Ver palpites públicos')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar palpite não salvo' }));
    expect(discard).toHaveBeenCalledOnce();

    render(
      <MatchPredictionCard
        match={match}
        value={{ home: '1', away: '0' }}
        open={false}
        availabilityLabel="FECHADO"
        timezone="America/Sao_Paulo"
        onEdit={vi.fn()}
        onSave={save}
        onDiscard={discard}
        onOpenPublicPredictions={publicPredictions}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver palpites públicos' }).at(-1)!);
    expect(publicPredictions).toHaveBeenCalledOnce();
  });
});
