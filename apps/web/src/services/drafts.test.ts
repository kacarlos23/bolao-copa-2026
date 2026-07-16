import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  draftReducer,
  draftStorageKey,
  hasDirtyDraft,
  loadDraft,
  mergeDraftItem,
  persistDraft,
  saveStatusLabel,
} from './drafts';

describe('drafts por usuário e poolSeason', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
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
});
