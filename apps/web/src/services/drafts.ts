export type ScoreSide = 'home' | 'away';
export type DraftSaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed';

export interface ScoreValue { home: string; away: string }
export interface DraftItem {
  value: ScoreValue;
  dirty: Record<ScoreSide, boolean>;
  status: DraftSaveStatus;
  savedAt?: string;
  error?: string;
}
export interface DraftState { items: Record<string, DraftItem> }

export interface ActiveDraftGuard {
  key: string;
  userId: string;
  isDirty: () => boolean;
  discard: () => void;
}

const activeDraftGuards = new Map<symbol, ActiveDraftGuard>();

export function registerActiveDraftGuard(guard: ActiveDraftGuard) {
  const token = Symbol(guard.key);
  activeDraftGuards.set(token, guard);
  return () => activeDraftGuards.delete(token);
}

export function getActiveDirtyDraftGuard(userId?: string) {
  const guards = [...activeDraftGuards.values()].reverse();
  return guards.find((guard) => (!userId || guard.userId === userId) && guard.isDirty()) ?? null;
}

export type DraftAction =
  | { type: 'hydrate'; values: Record<string, ScoreValue> }
  | { type: 'edit'; itemId: string; side: ScoreSide; value: string }
  | { type: 'saving'; itemIds: string[] }
  | {
      type: 'saved';
      itemIds: string[];
      savedAt?: string;
      submittedValues?: Record<string, ScoreValue>;
    }
  | { type: 'failed'; itemIds: string[]; error: string }
  | { type: 'discard'; itemIds?: string[] };

const EMPTY_ITEM: DraftItem = {
  value: { home: '', away: '' },
  dirty: { home: false, away: false },
  status: 'clean',
};

export function mergeDraftItem(current: DraftItem | undefined, server: ScoreValue): DraftItem {
  if (!current) return { ...EMPTY_ITEM, value: { ...server } };
  return {
    ...current,
    value: {
      home: current.dirty.home ? current.value.home : server.home,
      away: current.dirty.away ? current.value.away : server.away,
    },
  };
}

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  if (action.type === 'hydrate') {
    const items = { ...state.items };
    for (const [itemId, value] of Object.entries(action.values)) {
      items[itemId] = mergeDraftItem(items[itemId], value);
    }
    return { items };
  }
  if (action.type === 'edit') {
    const current = state.items[action.itemId] ?? EMPTY_ITEM;
    return {
      items: {
        ...state.items,
        [action.itemId]: {
          ...current,
          value: { ...current.value, [action.side]: action.value.replace(/\D/g, '').slice(0, 2) },
          dirty: { ...current.dirty, [action.side]: true },
          status: 'dirty',
          error: undefined,
        },
      },
    };
  }
  const ids = action.type === 'discard' && !action.itemIds ? Object.keys(state.items) : action.itemIds;
  const items = { ...state.items };
  for (const itemId of ids ?? []) {
    const current = items[itemId];
    if (!current) continue;
    if (action.type === 'saving') items[itemId] = { ...current, status: 'saving', error: undefined };
    if (action.type === 'saved') {
      const submitted = action.submittedValues?.[itemId];
      const dirty = submitted
        ? {
            home: current.dirty.home && current.value.home !== submitted.home,
            away: current.dirty.away && current.value.away !== submitted.away,
          }
        : { home: false, away: false };
      const stillDirty = dirty.home || dirty.away;
      items[itemId] = {
        ...current,
        dirty,
        status: stillDirty ? 'dirty' : 'saved',
        savedAt: action.savedAt ?? new Date().toISOString(),
        error: undefined,
      };
    }
    if (action.type === 'failed') items[itemId] = { ...current, status: 'failed', error: action.error };
    if (action.type === 'discard') delete items[itemId];
  }
  return { items };
}

export function draftStorageKey(userId: string, poolSeasonId: string, scope = 'predictions') {
  return `bolao:draft:v2:${encodeURIComponent(userId)}:${encodeURIComponent(poolSeasonId)}:${encodeURIComponent(scope)}`;
}

export function hasDirtyDraft(state: DraftState) {
  return Object.values(state.items).some((item) => item.dirty.home || item.dirty.away);
}

export function dirtyItemIds(state: DraftState) {
  return Object.entries(state.items)
    .filter(([, item]) => item.dirty.home || item.dirty.away)
    .map(([itemId]) => itemId);
}

export function loadDraft(key: string): DraftState {
  if (typeof window === 'undefined') return { items: {} };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '') as DraftState;
    if (!parsed || typeof parsed !== 'object' || !parsed.items) return { items: {} };
    return {
      items: Object.fromEntries(
        Object.entries(parsed.items).filter(
          ([, item]) => Boolean(item?.dirty?.home || item?.dirty?.away),
        ),
      ),
    };
  } catch {
    return { items: {} };
  }
}

export function persistDraft(key: string, state: DraftState) {
  if (typeof window === 'undefined') return;
  const dirtyState = {
    items: Object.fromEntries(
      Object.entries(state.items).filter(([, item]) => item.dirty.home || item.dirty.away),
    ),
  };
  if (Object.keys(dirtyState.items).length === 0) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, JSON.stringify(dirtyState));
}

export function discardStoredDraft(key: string) {
  if (typeof window !== 'undefined') window.localStorage.removeItem(key);
}

export function saveStatusLabel(item?: DraftItem) {
  if (!item || item.status === 'clean') return '';
  if (item.status === 'dirty') return 'Não salvo';
  if (item.status === 'saving') return 'Salvando';
  if (item.status === 'failed') return 'Falhou — tentar novamente';
  const date = item.savedAt ? new Date(item.savedAt) : null;
  const time = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date)
    : null;
  return time ? `Salvo às ${time}` : 'Salvo';
}

export function warnBeforeUnload(shouldWarn: () => boolean) {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (event: BeforeUnloadEvent) => {
    if (!shouldWarn()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', listener);
  return () => window.removeEventListener('beforeunload', listener);
}

export function hasStoredDirtyDraft(
  userId: string,
  context?: { poolSeasonId: string; scope?: string },
) {
  if (typeof window === 'undefined') return false;
  if (!context) return Boolean(getActiveDirtyDraftGuard(userId));
  const expectedKey = draftStorageKey(userId, context.poolSeasonId, context.scope);
  const stored = loadDraft(expectedKey);
  if (hasDirtyDraft(stored)) return true;
  window.localStorage.removeItem(expectedKey);
  return false;
}
