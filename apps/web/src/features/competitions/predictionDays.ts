import type { MatchDto } from '@bolao/shared';

export interface PredictionDay {
  key: string;
  matches: MatchDto[];
}

function dateParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function civilDateKey(value: string | Date, timezone: string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const parts = dateParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function civilMonthKey(value: string | Date, timezone: string) {
  return civilDateKey(value, timezone).slice(0, 7);
}

export function shiftMonthKey(monthKey: string, amount: number) {
  const [year, month] = monthKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + amount, 1, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Fetches a deliberately wider UTC interval and lets civil-date grouping trim
 * it. This keeps the query correct for every supported IANA timezone, including
 * months whose first or last local hour belongs to an adjacent UTC date.
 */
export function predictionMonthWindow(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const timezoneEnvelope = 14 * 60 * 60_000;
  return {
    from: new Date(Date.UTC(year, month - 1, 1) - timezoneEnvelope).toISOString(),
    to: new Date(Date.UTC(year, month, 1) + timezoneEnvelope).toISOString(),
  };
}

export function groupPredictionMatchesByDay(
  matches: MatchDto[],
  timezone: string,
  monthKey?: string,
): PredictionDay[] {
  const groups = new Map<string, MatchDto[]>();
  for (const match of [...matches].sort(
    (left, right) =>
      new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime() ||
      left.id.localeCompare(right.id),
  )) {
    const key = civilDateKey(match.startsAt, timezone);
    if (monthKey && !key.startsWith(`${monthKey}-`)) continue;
    const current = groups.get(key) ?? [];
    current.push(match);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, dayMatches]) => ({ key, matches: dayMatches }));
}

export function preferredPredictionDayKey(
  days: PredictionDay[],
  timezone: string,
  isOpen: (match: MatchDto) => boolean,
  now = new Date(),
) {
  if (!days.length) return '';
  const today = civilDateKey(now, timezone);
  const currentDay = days.find((day) => day.key === today);
  if (currentDay) return currentDay.key;
  const nextOpen = days.find(
    (day) => day.key > today && day.matches.some((match) => isOpen(match)),
  );
  if (nextOpen) return nextOpen.key;
  return days.find((day) => day.key > today)?.key ?? days.at(-1)?.key ?? '';
}
