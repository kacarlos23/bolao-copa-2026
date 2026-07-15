import { describe, expect, it } from 'vitest';
import { mergePredictionDraft, predictionSaveFailureMessage } from './predictionDraft';

describe('prediction draft reconciliation', () => {
  it('keeps dirty fields while refreshing clean values from polling or SSE', () => {
    expect(
      mergePredictionDraft(
        {
          dirty: { home: '2', away: '1' },
          clean: { home: '0', away: '0' },
        },
        {
          dirty: { home: '0', away: '0' },
          clean: { home: '3', away: '2' },
        },
        new Set(['dirty']),
      ),
    ).toEqual({
      dirty: { home: '2', away: '1' },
      clean: { home: '3', away: '2' },
    });
  });

  it('describes partial saves as partial rather than total success', () => {
    expect(predictionSaveFailureMessage(2, ['mata-mata: indisponível'])).toBe(
      '2 palpite(s) foram salvos; os demais falharam. mata-mata: indisponível',
    );
    expect(predictionSaveFailureMessage(0, ['fase de grupos: indisponível'])).toBe(
      'fase de grupos: indisponível',
    );
  });
});
