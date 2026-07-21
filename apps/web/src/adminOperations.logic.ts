type PrioritizableMatch = {
  id: string;
  startsAt: string;
  status: string;
};

export function civilDateKey(value: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function prioritizeAdminMatches<T extends PrioritizableMatch>(
  matches: readonly T[],
  now = new Date(),
  timezone = 'America/Sao_Paulo',
) {
  const today = civilDateKey(now, timezone);
  const nowTime = now.getTime();
  const priority = (match: T) => {
    const startsAt = new Date(match.startsAt);
    if (civilDateKey(startsAt, timezone) === today) return 0;
    if (match.status === 'LIVE') return 1;
    if (startsAt.getTime() >= nowTime) return 2;
    return 3;
  };

  return [...matches].sort((left, right) => {
    const priorityDifference = priority(left) - priority(right);
    if (priorityDifference !== 0) return priorityDifference;
    const leftTime = new Date(left.startsAt).getTime();
    const rightTime = new Date(right.startsAt).getTime();
    const timeDifference = priority(left) === 3 ? rightTime - leftTime : leftTime - rightTime;
    return timeDifference || left.id.localeCompare(right.id);
  });
}
