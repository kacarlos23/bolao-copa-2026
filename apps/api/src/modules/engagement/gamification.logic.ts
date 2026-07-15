import type { ScoreType } from '@prisma/client';

export type StreakType = 'ANY_HIT' | 'OUTCOME' | 'EXACT';

export interface FinalScoreEvent {
  eventKey: string;
  userId: string;
  startsAt: Date;
  order: number;
  points: number;
  scoreType: ScoreType;
  isFinal: boolean;
}

export interface DerivedStreak {
  type: StreakType;
  currentCount: number;
  bestCount: number;
  lastEventKey: string | null;
}

export function compareFinalScoreEvents(left: FinalScoreEvent, right: FinalScoreEvent) {
  return (
    left.startsAt.getTime() - right.startsAt.getTime() ||
    left.order - right.order ||
    left.eventKey.localeCompare(right.eventKey)
  );
}

function hits(type: StreakType, event: FinalScoreEvent) {
  if (type === 'EXACT') return event.scoreType === 'EXACT_SCORE';
  if (type === 'OUTCOME') return event.scoreType === 'EXACT_SCORE' || event.scoreType === 'RESULT';
  return event.points > 0;
}

export function deriveStreaks(events: FinalScoreEvent[]): DerivedStreak[] {
  const ordered = events.filter((event) => event.isFinal).sort(compareFinalScoreEvents);
  return (['ANY_HIT', 'OUTCOME', 'EXACT'] as const).map((type) => {
    let currentCount = 0;
    let bestCount = 0;
    for (const event of ordered) {
      currentCount = hits(type, event) ? currentCount + 1 : 0;
      bestCount = Math.max(bestCount, currentCount);
    }
    return {
      type,
      currentCount,
      bestCount,
      lastEventKey: ordered.at(-1)?.eventKey ?? null,
    };
  });
}

export function achievementIdempotencyKey(
  poolSeasonId: string,
  userId: string,
  definitionKey: string,
  definitionVersion: number,
) {
  return `${poolSeasonId}:${userId}:${definitionKey}:v${definitionVersion}`;
}

export function movementDelta(fromRank: number, toRank: number) {
  return fromRank - toRank;
}
