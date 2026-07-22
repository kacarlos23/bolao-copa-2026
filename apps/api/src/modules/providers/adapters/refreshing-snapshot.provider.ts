import type {
  CompetitionDataProvider,
  ProviderContext,
  ProviderHealth,
} from '../competition-data-provider.js';
import { ConmebolProvider } from './snapshot-competition.provider.js';

export interface RefreshingConmebolProviderOptions {
  competition: string;
  source: string;
  collectSnapshot: () => Promise<unknown>;
}

/**
 * Keeps one freshly collected snapshot for the complete administrative run.
 * The provider instance is request-scoped by ProviderRegistry, so every click
 * performs a new collection while TEAMS/STRUCTURE/TIES/SCHEDULE/RESULTS/
 * STANDINGS all reconcile exactly the same official revision.
 */
export class RefreshingConmebolProvider implements CompetitionDataProvider {
  readonly name = 'conmebol-official';
  readonly source: string;
  private delegatePromise?: Promise<ConmebolProvider>;

  constructor(private readonly options: RefreshingConmebolProviderOptions) {
    this.source = options.source;
  }

  private delegate() {
    if (!this.delegatePromise) {
      this.delegatePromise = this.options.collectSnapshot().then(
        (snapshot) =>
          new ConmebolProvider({
            snapshot,
            competition: this.options.competition,
          }),
      );
    }
    return this.delegatePromise;
  }

  async syncTeams(context: ProviderContext) {
    return (await this.delegate()).syncTeams(context);
  }

  async syncStructure(context: ProviderContext) {
    return (await this.delegate()).syncStructure(context);
  }

  async syncTies(context: ProviderContext) {
    return (await this.delegate()).syncTies(context);
  }

  async syncSchedule(context: ProviderContext) {
    return (await this.delegate()).syncSchedule(context);
  }

  async syncResults(context: ProviderContext) {
    return (await this.delegate()).syncResults(context);
  }

  async syncStandings(context: ProviderContext) {
    return (await this.delegate()).syncStandings(context);
  }

  async snapshotEvidence() {
    return (await this.delegate()).snapshotEvidence();
  }

  async healthCheck(context: ProviderContext): Promise<ProviderHealth> {
    try {
      return (await this.delegate()).healthCheck(context);
    } catch (error) {
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : 'official source collection failed',
      };
    }
  }
}
