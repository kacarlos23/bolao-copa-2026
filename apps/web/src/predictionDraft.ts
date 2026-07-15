export interface PredictionDraftScore {
  home: string;
  away: string;
}

export function mergePredictionDraft(
  current: Record<string, PredictionDraftScore>,
  server: Record<string, PredictionDraftScore>,
  dirtyMatchIds: ReadonlySet<string>,
) {
  const next = { ...current };
  for (const [matchId, score] of Object.entries(server)) {
    if (!dirtyMatchIds.has(matchId)) next[matchId] = score;
  }
  return next;
}

export function mergePredictionDraftFields(
  current: Record<string, PredictionDraftScore>,
  server: Record<string, PredictionDraftScore>,
  dirtyFieldsByMatch: ReadonlyMap<string, ReadonlySet<'home' | 'away'>>,
) {
  const next = { ...current };
  for (const [matchId, score] of Object.entries(server)) {
    const dirty = dirtyFieldsByMatch.get(matchId);
    const existing = current[matchId];
    next[matchId] = {
      home: dirty?.has('home') ? (existing?.home ?? '') : score.home,
      away: dirty?.has('away') ? (existing?.away ?? '') : score.away,
    };
  }
  return next;
}

export function predictionSaveFailureMessage(savedCount: number, failures: readonly string[]) {
  if (failures.length === 0) return '';
  const prefix = savedCount ? `${savedCount} palpite(s) foram salvos; os demais falharam. ` : '';
  return `${prefix}${failures.join(' | ')}`;
}
