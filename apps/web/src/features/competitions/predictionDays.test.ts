import type { MatchDto } from '@bolao/shared';
import { describe, expect, it } from 'vitest';
import {
  civilDateKey,
  groupPredictionMatchesByDay,
  predictionMonthWindow,
  preferredPredictionDayKey,
  shiftMonthKey,
} from './predictionDays';

function match(id: string, startsAt: string, roundId: string): MatchDto {
  return {
    id,
    seasonId: 'season-1',
    stageId: 'stage-1',
    roundId,
    matchDayId: `day-${startsAt.slice(0, 10)}`,
    startsAt,
    predictionClosesAt: null,
    status: 'SCHEDULED',
    homeScore: null,
    awayScore: null,
    finalHomeScore: null,
    finalAwayScore: null,
    homeTeam: { id: `home-${id}`, name: 'Mandante', code: null, flagUrl: null, crestUrl: null },
    awayTeam: { id: `away-${id}`, name: 'Visitante', code: null, flagUrl: null, crestUrl: null },
  };
}

describe('agenda de palpites por data civil', () => {
  it('agrupa partidas de rodadas diferentes no mesmo dia da temporada', () => {
    const days = groupPredictionMatchesByDay(
      [
        match('later', '2026-07-17T01:30:00.000Z', 'round-19'),
        match('earlier', '2026-07-16T22:30:00.000Z', 'round-7'),
      ],
      'America/Sao_Paulo',
      '2026-07',
    );

    expect(days).toHaveLength(1);
    expect(days[0]?.key).toBe('2026-07-16');
    expect(days[0]?.matches.map((item) => item.id)).toEqual(['earlier', 'later']);
  });

  it('usa a timezone da temporada, não o dia UTC nem a timezone do navegador', () => {
    expect(civilDateKey('2026-07-17T01:30:00.000Z', 'America/Sao_Paulo')).toBe('2026-07-16');
    expect(civilDateKey('2026-07-17T01:30:00.000Z', 'UTC')).toBe('2026-07-17');
  });

  it('seleciona hoje, depois o próximo dia aberto e por fim o dia mais recente', () => {
    const days = groupPredictionMatchesByDay(
      [
        match('past', '2026-07-14T22:30:00.000Z', 'round-18'),
        match('today', '2026-07-16T22:30:00.000Z', 'round-19'),
        match('future', '2026-07-18T22:30:00.000Z', 'round-20'),
      ],
      'America/Sao_Paulo',
    );
    const open = (item: MatchDto) => item.id === 'future';

    expect(
      preferredPredictionDayKey(days, 'America/Sao_Paulo', open, new Date('2026-07-16T12:00:00Z')),
    ).toBe('2026-07-16');
    expect(
      preferredPredictionDayKey(days, 'America/Sao_Paulo', open, new Date('2026-07-17T12:00:00Z')),
    ).toBe('2026-07-18');
    expect(
      preferredPredictionDayKey(days, 'America/Sao_Paulo', open, new Date('2026-07-20T12:00:00Z')),
    ).toBe('2026-07-18');
  });

  it('navega meses e cria um envelope UTC inclusivo para timezones extremas', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
    expect(predictionMonthWindow('2026-07')).toEqual({
      from: '2026-06-30T10:00:00.000Z',
      to: '2026-08-01T14:00:00.000Z',
    });
  });
});
