import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGeProviderHtml } from './ge.provider.js';

describe('GeProvider anti-corruption parser', () => {
  it('normalizes local schedule and result fixtures with stable external IDs', () => {
    const html = readFileSync(new URL('../__fixtures__/ge-schedule.html', import.meta.url), 'utf8');
    const parsed = parseGeProviderHtml(html);

    expect(parsed.teams).toHaveLength(4);
    expect(parsed.schedule).toEqual([
      expect.objectContaining({ externalId: 'match:ge-1001', status: 'FINISHED' }),
      expect.objectContaining({ externalId: 'match:ge-1002', status: 'SCHEDULED' }),
    ]);
    expect(parsed.results).toEqual([
      expect.objectContaining({
        externalId: 'result:match:ge-1001',
        matchExternalId: 'match:ge-1001',
        homeScore: 2,
        awayScore: 1,
        status: 'FINISHED',
      }),
    ]);
  });
});
