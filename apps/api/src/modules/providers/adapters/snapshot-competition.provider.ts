import type {
  CompetitionDataProvider,
  ProviderContext,
  ProviderHealth,
} from '../competition-data-provider.js';
import {
  loadSanitizedOfficialFixture,
  parseOfficialSourceSnapshot,
  snapshotEvidence,
  type OfficialSourceSnapshot,
} from '../official-source-snapshot.js';

export interface SnapshotProviderOptions {
  fixtureName?: string;
  snapshot?: unknown;
  competition: string;
}

abstract class SnapshotCompetitionProvider implements CompetitionDataProvider {
  abstract readonly name: string;
  readonly source: string;
  protected readonly snapshot: OfficialSourceSnapshot;

  protected constructor(expectedProvider: string, options: SnapshotProviderOptions) {
    if ((options.fixtureName === undefined) === (options.snapshot === undefined)) {
      throw new Error('Provide exactly one immutable fixtureName or in-memory snapshot.');
    }
    this.snapshot = options.fixtureName
      ? loadSanitizedOfficialFixture(options.fixtureName, {
          provider: expectedProvider,
          competition: options.competition,
        })
      : parseOfficialSourceSnapshot(options.snapshot, {
          provider: expectedProvider,
          competition: options.competition,
        });
    this.source = this.snapshot.source;
  }

  async syncTeams(_context: ProviderContext) {
    return this.snapshot.data.teams;
  }

  async syncStructure(_context: ProviderContext) {
    return this.snapshot.data.structure;
  }

  async syncTies(_context: ProviderContext) {
    return this.snapshot.data.ties;
  }

  async syncSchedule(_context: ProviderContext) {
    return this.snapshot.data.schedule;
  }

  async syncResults(_context: ProviderContext) {
    return this.snapshot.data.results;
  }

  async syncStandings(_context: ProviderContext) {
    return this.snapshot.data.standings;
  }

  async snapshotEvidence() {
    return snapshotEvidence(this.snapshot);
  }

  async healthCheck(_context: ProviderContext): Promise<ProviderHealth> {
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      message: `immutable snapshot ${this.snapshot.snapshotChecksum}`,
    };
  }
}

export class ConmebolProvider extends SnapshotCompetitionProvider {
  readonly name = 'conmebol-official';

  constructor(options: SnapshotProviderOptions) {
    if (!['conmebol-libertadores', 'conmebol-sudamericana'].includes(options.competition)) {
      throw new Error('The shared CONMEBOL provider only accepts Libertadores or Sudamericana.');
    }
    super('conmebol-official', options);
  }
}

export class CbfCopaDoBrasilProvider extends SnapshotCompetitionProvider {
  readonly name = 'cbf-copa-do-brasil-official';

  constructor(options: Omit<SnapshotProviderOptions, 'competition'>) {
    super('cbf-copa-do-brasil-official', { ...options, competition: 'copa-do-brasil' });
  }
}
