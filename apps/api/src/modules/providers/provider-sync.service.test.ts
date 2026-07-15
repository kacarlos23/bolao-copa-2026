import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { CompetitionDataProvider } from './competition-data-provider.js';

const mocks = vi.hoisted(() => {
  const state = {
    runs: [] as Array<Record<string, any>>,
    mappings: [] as Array<Record<string, any>>,
    teams: [] as Array<Record<string, any>>,
    seasonTeams: [] as Array<{ seasonId: string; teamId: string }>,
    nextId: 1,
  };
  const prisma: Record<string, any> = {};
  prisma.providerSyncLock = {
    deleteMany: vi.fn(async () => ({ count: 1 })),
    create: vi.fn(async ({ data }: any) => data),
  };
  prisma.providerSyncRun = {
    findUnique: vi.fn(async ({ where }: any) => {
      const key = where.provider_seasonId_type_idempotencyKey;
      return (
        state.runs.find(
          (run) =>
            run.provider === key.provider &&
            run.seasonId === key.seasonId &&
            run.type === key.type &&
            run.idempotencyKey === key.idempotencyKey,
        ) ?? null
      );
    }),
    create: vi.fn(async ({ data }: any) => {
      const run = {
        id: `run-${state.nextId++}`,
        ...data,
        dryRun: data.dryRun ?? false,
        status: 'RUNNING',
        checksum: null,
        fetchedCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        quarantinedCount: 0,
        startedAt: new Date(),
        finishedAt: null,
      };
      state.runs.push(run);
      return run;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const run = state.runs.find((candidate) => candidate.id === where.id)!;
      Object.assign(run, data);
      return run;
    }),
  };
  prisma.providerEntityMapping = {
    findUnique: vi.fn(async ({ where }: any) => {
      const key = where.provider_entityType_externalId;
      return (
        state.mappings.find(
          (mapping) =>
            mapping.provider === key.provider &&
            mapping.entityType === key.entityType &&
            mapping.externalId === key.externalId,
        ) ?? null
      );
    }),
    create: vi.fn(async ({ data }: any) => {
      const mapping = { id: `mapping-${state.nextId++}`, ...data };
      state.mappings.push(mapping);
      return mapping;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const mapping = state.mappings.find((candidate) => candidate.id === where.id)!;
      Object.assign(mapping, data);
      return mapping;
    }),
  };
  prisma.seasonTeam = {
    findMany: vi.fn(async ({ where }: any) =>
      state.seasonTeams
        .filter((entry) => entry.seasonId === where.seasonId)
        .map((entry) => ({ team: state.teams.find((team) => team.id === entry.teamId)! })),
    ),
    create: vi.fn(async ({ data }: any) => {
      state.seasonTeams.push(data);
      return data;
    }),
  };
  prisma.team = {
    create: vi.fn(async ({ data }: any) => {
      const team = {
        id: `team-${state.nextId++}`,
        code: null,
        type: null,
        crestUrl: null,
        ...data,
      };
      state.teams.push(team);
      return team;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const team = state.teams.find((candidate) => candidate.id === where.id)!;
      Object.assign(team, data);
      return team;
    }),
  };
  prisma.syncQuarantine = { createMany: vi.fn(async () => ({ count: 0 })) };
  prisma.$transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma));

  function reset() {
    state.runs.length = 0;
    state.mappings.length = 0;
    state.teams.length = 0;
    state.seasonTeams.length = 0;
    state.nextId = 1;
    for (const model of Object.values(prisma)) {
      if (typeof model === 'function' && 'mockClear' in model) model.mockClear();
      if (model && typeof model === 'object') {
        for (const method of Object.values(model)) {
          if (typeof method === 'function' && 'mockClear' in method) {
            (method as ReturnType<typeof vi.fn>).mockClear();
          }
        }
      }
    }
  }
  return { prisma, state, reset };
});

vi.mock('../../prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('../events/outbox.js', () => ({
  enqueueOutboxEvent: vi.fn(async () => ({ id: 'event-1' })),
  dispatchOutboxEvent: vi.fn(),
}));

import { activeProviderSyncCount, runProviderSync } from './provider-sync.service.js';

function teamProvider(): CompetitionDataProvider {
  return {
    name: 'fixture',
    source: 'fixture://teams',
    syncTeams: vi.fn(async () => [{ externalId: 'bra', name: 'Brasil', code: 'BRA' }]),
    syncSchedule: vi.fn(async () => []),
    syncResults: vi.fn(async () => []),
    healthCheck: vi.fn(async () => ({ ok: true, checkedAt: new Date().toISOString() })),
  };
}

describe('auditable provider pipeline', () => {
  beforeEach(() => mocks.reset());

  it('creates no domain insert on the second import of the same payload', async () => {
    const provider = teamProvider();
    const first = await runProviderSync(provider, {
      type: 'TEAMS',
      seasonId: 'season-1',
      idempotencyKey: 'fixture-load-1',
    });
    const second = await runProviderSync(provider, {
      type: 'TEAMS',
      seasonId: 'season-1',
      idempotencyKey: 'fixture-load-2',
    });

    expect(first.counts.inserted).toBe(1);
    expect(second.counts).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
    expect(mocks.prisma.team.create).toHaveBeenCalledOnce();
    expect(mocks.prisma.providerEntityMapping.create).toHaveBeenCalledOnce();
  });

  it('reuses a completed idempotency key without fetching or writing again', async () => {
    const provider = teamProvider();
    const options = {
      type: 'TEAMS' as const,
      seasonId: 'season-1',
      idempotencyKey: 'same-request-key',
    };
    await runProviderSync(provider, options);
    const result = await runProviderSync(provider, options);

    expect(result.reused).toBe(true);
    expect(provider.syncTeams).toHaveBeenCalledOnce();
    expect(mocks.prisma.team.create).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent work for the same provider, season and type', async () => {
    let release!: (value: Array<{ externalId: string; name: string }>) => void;
    const pending = new Promise<Array<{ externalId: string; name: string }>>((resolve) => {
      release = resolve;
    });
    const provider = { ...teamProvider(), syncTeams: vi.fn(async () => pending) };
    const first = runProviderSync(provider, {
      type: 'TEAMS',
      seasonId: 'season-1',
      idempotencyKey: 'concurrent-one',
    });
    const second = runProviderSync(provider, {
      type: 'TEAMS',
      seasonId: 'season-1',
      idempotencyKey: 'concurrent-one',
    });
    release([{ externalId: 'bra', name: 'Brasil' }]);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    expect(provider.syncTeams).toHaveBeenCalledOnce();
    expect(mocks.prisma.providerSyncLock.create).toHaveBeenCalledOnce();
  });

  it('persists ambiguous normalized names in quarantine', async () => {
    mocks.state.teams.push(
      { id: 'team-one', name: 'Atletico MG', code: null, type: 'CLUB', crestUrl: null },
      { id: 'team-two', name: 'Atlético-MG', code: null, type: 'CLUB', crestUrl: null },
    );
    mocks.state.seasonTeams.push(
      { seasonId: 'season-1', teamId: 'team-one' },
      { seasonId: 'season-1', teamId: 'team-two' },
    );
    const provider = {
      ...teamProvider(),
      syncTeams: vi.fn(async () => [{ externalId: 'cam', name: 'Atlético MG' }]),
    };
    const result = await runProviderSync(provider, {
      type: 'TEAMS',
      seasonId: 'season-1',
      idempotencyKey: 'ambiguous-team',
    });

    expect(result.status).toBe('PARTIAL');
    expect(result.counts).toMatchObject({ inserted: 0, quarantined: 1 });
    expect(mocks.prisma.syncQuarantine.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ reason: 'AMBIGUOUS_NAME', externalId: 'cam' })],
    });
  });

  it('reports a distributed lock held by another process', async () => {
    mocks.prisma.providerSyncLock.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['key'] },
      }),
    );
    await expect(
      runProviderSync(teamProvider(), {
        type: 'TEAMS',
        seasonId: 'season-1',
        idempotencyKey: 'locked-request',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PROVIDER_SYNC_LOCKED' });
    expect(activeProviderSyncCount()).toBe(0);
  });

  it('releases the distributed lock and activeRun after a provider timeout', async () => {
    const timeout = new DOMException('aborted', 'AbortError');
    const provider = { ...teamProvider(), syncTeams: vi.fn(async () => Promise.reject(timeout)) };

    await expect(
      runProviderSync(provider, {
        type: 'TEAMS',
        seasonId: 'season-1',
        idempotencyKey: 'timeout-request',
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(activeProviderSyncCount()).toBe(0);
    expect(mocks.prisma.providerSyncLock.deleteMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ ownerId: expect.any(String) }),
    });
    expect(mocks.state.runs[0]).toMatchObject({ status: 'FAILED', errorCode: 'AbortError' });
  });
});
