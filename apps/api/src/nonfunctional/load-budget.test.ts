import type { Response } from 'express';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareRankingRows, type RankingRowBase } from '../services/ranking.service.js';
import { addSseClient, closeAllSseClients, emitSse } from '../realtime/sse.js';

afterEach(() => closeAllSseClients());

describe('budgets de carga locais e determinísticos', () => {
  it('ordena 10 mil linhas de ranking abaixo do budget de 1 segundo', () => {
    const rows: RankingRowBase[] = Array.from({ length: 10_000 }, (_, index) => ({
      nickname: `fixture-${index}`,
      points: (index * 17) % 1000,
      exactScores: index % 20,
      resultHits: index % 30,
      oneGoalHits: index % 40,
      misses: index % 10,
    }));
    const started = performance.now();
    rows.sort(compareRankingRows);
    const durationMs = performance.now() - started;
    expect(durationMs).toBeLessThan(1_000);
    expect(rows).toHaveLength(10_000);
  });

  it('entrega 50 eventos a 100 clientes SSE sem exceder capacidade ou 2 segundos', () => {
    const responses = Array.from({ length: 101 }, () => ({
      write: vi.fn(() => true), flush: vi.fn(), once: vi.fn(), off: vi.fn(), end: vi.fn(),
      status: vi.fn(function (this: unknown) { return this; }), writableEnded: false, destroyed: false,
    } as unknown as Response));
    for (const response of responses.slice(0, 100)) expect(addSseClient(response)).toBe(true);
    expect(addSseClient(responses[100])).toBe(false);
    expect(responses[100].status).toHaveBeenCalledWith(503);
    const started = performance.now();
    for (let index = 0; index < 50; index += 1) emitSse('ranking.updated', { index });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(responses[0].write).toHaveBeenCalledTimes(51);
  });
});
