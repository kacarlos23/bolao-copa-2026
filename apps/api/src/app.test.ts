import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';

describe('app', () => {
  it('returns health status', async () => {
    const response = await request(createApp()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it('protects the internal realtime relay', async () => {
    const response = await request(createApp())
      .post('/api/internal/realtime/sync-completed')
      .send({ ranking: [], updatedMatchIds: [], updatedKnockoutFixtureIds: [], updatedAt: new Date().toISOString() });

    expect(response.status).toBe(401);
  });

  it('accepts a realtime update with the internal secret', async () => {
    const response = await request(createApp())
      .post('/api/internal/realtime/sync-completed')
      .set('x-internal-events-secret', config.INTERNAL_EVENTS_SECRET ?? config.SESSION_SECRET)
      .send({ ranking: [], updatedMatchIds: ['match-1'], updatedKnockoutFixtureIds: [], updatedAt: new Date().toISOString() });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
