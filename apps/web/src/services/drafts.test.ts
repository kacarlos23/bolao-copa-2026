import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  draftReducer,
  draftStorageKey,
  discardStoredDraft,
  hasDirtyDraft,
  hasStoredDirtyDraft,
  loadDraft,
  mergeDraftItem,
  persistDraft,
  registerActiveDraftGuard,
  saveStatusLabel,
  warnBeforeUnload,
} from './drafts';

describe('drafts por usuário e poolSeason', () => {
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        get length() { return values.size; },
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        key: (index: number) => [...values.keys()][index] ?? null,
      },
    });
  });

  it('não deixa polling ou SSE sobrescrever somente o campo dirty', () => {
    const current = draftReducer({ items: {} }, { type: 'hydrate', values: { match: { home: '0', away: '0' } } });
    const dirty = draftReducer(current, { type: 'edit', itemId: 'match', side: 'home', value: '2' });
    const refreshed = draftReducer(dirty, { type: 'hydrate', values: { match: { home: '1', away: '3' } } });

    expect(refreshed.items.match.value).toEqual({ home: '2', away: '3' });
    expect(refreshed.items.match.dirty).toEqual({ home: true, away: false });
  });

  it('persiste isolado pela chave userId+poolSeasonId e restaura o dirty', () => {
    const key = draftStorageKey('user-1', 'pool-season-1');
    const state = draftReducer({ items: {} }, { type: 'edit', itemId: 'match-1', side: 'away', value: '4' });
    persistDraft(key, state);

    expect(key).toContain('user-1');
    expect(key).toContain('pool-season-1');
    expect(loadDraft(key)).toEqual(state);
    expect(hasDirtyDraft(loadDraft(key))).toBe(true);
  });

  it('expõe estados inequívocos de salvamento', () => {
    const saving = draftReducer(
      draftReducer({ items: {} }, { type: 'edit', itemId: 'match', side: 'home', value: '1' }),
      { type: 'saving', itemIds: ['match'] },
    );
    const saved = draftReducer(saving, { type: 'saved', itemIds: ['match'], savedAt: '2026-07-15T12:30:00.000Z' });
    const failed = draftReducer(saving, { type: 'failed', itemIds: ['match'], error: 'Conflito' });

    expect(saveStatusLabel(saving.items.match)).toBe('Salvando');
    expect(saveStatusLabel(saved.items.match)).toMatch(/^Salvo às/);
    expect(saveStatusLabel(failed.items.match)).toBe('Falhou — tentar novamente');
    expect(mergeDraftItem(undefined, { home: '1', away: '0' }).status).toBe('clean');
  });

  it('não limpa uma edição feita depois que o salvamento começou', () => {
    const edited = draftReducer(
      draftReducer(
        draftReducer(
          { items: {} },
          { type: 'edit', itemId: 'match', side: 'home', value: '1' },
        ),
        { type: 'edit', itemId: 'match', side: 'away', value: '0' },
      ),
      { type: 'saving', itemIds: ['match'] },
    );
    const changedWhileSaving = draftReducer(edited, {
      type: 'edit',
      itemId: 'match',
      side: 'home',
      value: '2',
    });
    const staleResponse = draftReducer(changedWhileSaving, {
      type: 'saved',
      itemIds: ['match'],
      submittedValues: { match: { home: '1', away: '0' } },
    });

    expect(staleResponse.items.match.value).toEqual({ home: '2', away: '0' });
    expect(staleResponse.items.match.dirty).toEqual({ home: true, away: false });
    expect(staleResponse.items.match.status).toBe('dirty');
    expect(saveStatusLabel(staleResponse.items.match)).toBe('Não salvo');
  });

  it('remove o draft persistido depois de um salvamento confirmado', () => {
    const key = draftStorageKey('user-1', 'season-1', 'league-predictions');
    const dirty = draftReducer(
      { items: {} },
      { type: 'edit', itemId: 'match', side: 'home', value: '2' },
    );
    persistDraft(key, dirty);
    const saved = draftReducer(dirty, {
      type: 'saved',
      itemIds: ['match'],
      submittedValues: { match: { home: '2', away: '' } },
    });
    persistDraft(key, saved);

    expect(values.has(key)).toBe(false);
    expect(
      hasStoredDirtyDraft('user-1', { poolSeasonId: 'season-1', scope: 'league-predictions' }),
    ).toBe(false);
  });

  it('ignora e remove draft clean armazenado', () => {
    const key = draftStorageKey('user-1', 'season-1');
    values.set(
      key,
      JSON.stringify({
        items: {
          match: {
            value: { home: '1', away: '0' },
            dirty: { home: false, away: false },
            status: 'saved',
          },
        },
      }),
    );

    expect(hasStoredDirtyDraft('user-1', { poolSeasonId: 'season-1' })).toBe(false);
    expect(values.has(key)).toBe(false);
  });

  it('draft de outra temporada não bloqueia o contexto atual', () => {
    persistDraft(
      draftStorageKey('user-1', 'season-old'),
      draftReducer(
        { items: {} },
        { type: 'edit', itemId: 'match', side: 'away', value: '3' },
      ),
    );

    expect(hasStoredDirtyDraft('user-1', { poolSeasonId: 'season-current' })).toBe(false);
    expect(hasStoredDirtyDraft('user-1', { poolSeasonId: 'season-old' })).toBe(true);
  });

  it('descarta somente a chave solicitada', () => {
    const active = draftStorageKey('user-1', 'season-current');
    const other = draftStorageKey('user-1', 'season-other');
    values.set(active, '{"items":{}}');
    values.set(other, '{"items":{}}');

    discardStoredDraft(active);

    expect(values.has(active)).toBe(false);
    expect(values.has(other)).toBe(true);
  });

  it('beforeunload só é interceptado quando o callback informa dirty', () => {
    const listeners = new Map<string, EventListener>();
    const addEventListener = vi.fn((name: string, listener: EventListener) => listeners.set(name, listener));
    const removeEventListener = vi.fn();
    vi.stubGlobal('window', { addEventListener, removeEventListener });
    const clean = warnBeforeUnload(() => false);
    const cleanEvent = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent;
    listeners.get('beforeunload')?.(cleanEvent);
    expect(cleanEvent.preventDefault).not.toHaveBeenCalled();
    clean();

    warnBeforeUnload(() => true);
    const dirtyEvent = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent;
    listeners.get('beforeunload')?.(dirtyEvent);
    expect(dirtyEvent.preventDefault).toHaveBeenCalledOnce();
  });

  it('o guard interno considera somente o editor ativo, separado do beforeunload', () => {
    const discard = vi.fn();
    const unregister = registerActiveDraftGuard({
      key: 'active',
      userId: 'user-1',
      isDirty: () => true,
      discard,
    });

    expect(hasStoredDirtyDraft('user-1')).toBe(true);
    expect(hasStoredDirtyDraft('other-user')).toBe(false);
    unregister();
    expect(hasStoredDirtyDraft('user-1')).toBe(false);
  });
});
