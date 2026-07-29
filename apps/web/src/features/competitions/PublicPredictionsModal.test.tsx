import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MatchDto, PublicMatchPredictionDto } from '@bolao/shared';
import { predictionPresentation } from './publicPredictionsPresentation';

vi.mock('../../components/TeamBadge', () => ({
  TeamBadge: ({ team }: { team: { name: string } }) => <span>{team.name}</span>,
}));

import { PublicPredictionsModal } from './PublicPredictionsModal';

describe('public prediction presentation', () => {
  it('maps exact, result, one-team goal and miss to distinct requested tones', () => {
    expect(predictionPresentation.EXACT_SCORE.borderColor).toBe('#34d17b');
    expect(predictionPresentation.RESULT.borderColor).toBe('#72b7f2');
    expect(predictionPresentation.ONE_TEAM_GOALS.borderColor).toBe('#ffa654');
    expect(predictionPresentation.MISS.borderColor).toBe('#ff8878');
    expect(
      new Set(Object.values(predictionPresentation).map((item) => item.borderColor)).size,
    ).toBe(4);
  });

  it('renders each avatar before the nickname after the prediction deadline', () => {
    const team = { id: 'team-a', name: 'Time A', code: null, flagUrl: null, crestUrl: null };
    const match = {
      id: 'match-1',
      seasonId: 'season-1',
      stageId: null,
      roundId: null,
      tieId: null,
      legNumber: null,
      matchDayId: 'day-1',
      startsAt: '2026-07-29T22:30:00.000Z',
      predictionClosesAt: '2026-07-29T22:25:00.000Z',
      status: 'FINISHED',
      homeScore: 2,
      awayScore: 1,
      finalHomeScore: 2,
      finalAwayScore: 1,
      regulationHomeScore: null,
      regulationAwayScore: null,
      extraTimeHomeScore: null,
      extraTimeAwayScore: null,
      penaltyHomeScore: null,
      penaltyAwayScore: null,
      homeTeam: team,
      awayTeam: { ...team, id: 'team-b', name: 'Time B' },
    } as MatchDto;
    const predictions = [
      {
        id: 'prediction-1',
        userId: 'user-1',
        matchId: match.id,
        predictedHomeScore: 2,
        predictedAwayScore: 1,
        scoreType: 'EXACT_SCORE',
        user: {
          id: 'user-1',
          nickname: 'Ana',
          avatarUrl: '/uploads/avatars/ana.webp',
        },
      },
      {
        id: 'prediction-2',
        userId: 'user-2',
        matchId: match.id,
        predictedHomeScore: 1,
        predictedAwayScore: 0,
        scoreType: 'RESULT',
        user: { id: 'user-2', nickname: 'Bruno', avatarUrl: null },
      },
    ] as PublicMatchPredictionDto[];

    render(
      <PublicPredictionsModal
        match={match}
        predictions={predictions}
        currentUserId="user-2"
        loading={false}
        error=""
        onClose={vi.fn()}
      />,
    );

    const anaRow = screen.getByLabelText('Ana, 2 a 1, Placar exato');
    const anaAvatar = within(anaRow).getByLabelText('Avatar de Ana');
    const anaNickname = within(anaRow).getByText('Ana');
    expect(
      anaAvatar.compareDocumentPosition(anaNickname) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(anaAvatar.innerHTML).toContain('/uploads/avatars/ana.webp');

    const brunoRow = screen.getByLabelText('Bruno, 1 a 0, Resultado correto');
    expect(within(brunoRow).getByLabelText('Avatar de Bruno')).toBeTruthy();
    expect(within(brunoRow).getByText('B')).toBeTruthy();
    expect(within(brunoRow).getByText('VOCÊ')).toBeTruthy();
  });
});
