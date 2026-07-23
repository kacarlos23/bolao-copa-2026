import { describe, expect, it } from 'vitest';
import { providerOperationalCadenceSchema, resolveProviderCadence } from './provider-cadence.js';
import type { SeasonProviderRuntimeConfig } from './season-runtime-config.js';

const provider: SeasonProviderRuntimeConfig = {
  key: 'fixture',
  priority: 1,
  types: ['RESULTS'],
  enabled: true,
  cadenceSeconds: 300,
  timeoutMs: 10_000,
  includeProfiles: false,
  source: 'fixture://official',
  provenance: 'test',
  settings: {
    operationalCadence: {
      liveSeconds: 10,
      scheduledSeconds: 45,
      idleSeconds: 1_800,
      nearWindowMinutes: 120,
      phases: [{ stageId: 'stage-final', liveSeconds: 5, scheduledSeconds: 20 }],
    },
  },
};

describe('cadência operacional de provider', () => {
  const now = new Date('2026-07-23T12:00:00.000Z');

  it('aumenta a frequência somente para LIVE ou SCHEDULED na janela próxima', () => {
    expect(
      resolveProviderCadence(
        provider,
        {
          status: 'SCHEDULED',
          startsAt: new Date('2026-07-23T13:00:00.000Z'),
          stageId: 'stage-groups',
          roundId: 'round-1',
        },
        now,
      ),
    ).toMatchObject({ mode: 'SCHEDULED_NEAR', cadenceSeconds: 45 });
    expect(
      resolveProviderCadence(
        provider,
        {
          status: 'SCHEDULED',
          startsAt: new Date('2026-07-24T12:00:00.000Z'),
          stageId: 'stage-groups',
          roundId: 'round-2',
        },
        now,
      ),
    ).toMatchObject({ mode: 'IDLE', cadenceSeconds: 1_800 });
  });

  it('aplica configuração específica de fase sem condicional no código', () => {
    expect(
      resolveProviderCadence(
        provider,
        {
          status: 'LIVE',
          startsAt: now,
          stageId: 'stage-final',
          roundId: 'round-final',
        },
        now,
      ),
    ).toMatchObject({ mode: 'LIVE', cadenceSeconds: 5, stageId: 'stage-final' });
  });

  it('recusa configuração que aumentaria a frequência fora da janela próxima', () => {
    expect(
      providerOperationalCadenceSchema.safeParse({
        liveSeconds: 60,
        scheduledSeconds: 120,
        idleSeconds: 30,
        nearWindowMinutes: 180,
        phases: [],
      }).success,
    ).toBe(false);
  });
});
