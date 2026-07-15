import type {
  CompetitionDataProvider,
  NormalizedMatch,
  NormalizedResult,
  NormalizedStanding,
  NormalizedTeam,
  ProviderContext,
  ProviderHealth,
} from '../competition-data-provider.js';
import {
  normalizedMatchArraySchema,
  normalizedResultArraySchema,
  normalizedStandingArraySchema,
  normalizedTeamArraySchema,
} from '../competition-data-provider.js';

export interface ManualProviderPayload {
  teams?: unknown;
  schedule?: unknown;
  results?: unknown;
  standings?: unknown;
}

export class ManualProvider implements CompetitionDataProvider {
  readonly name: string = 'manual';
  readonly source: string = 'manual://admin';
  private readonly teams: NormalizedTeam[];
  private readonly schedule: NormalizedMatch[];
  private readonly results: NormalizedResult[];
  private readonly standings: NormalizedStanding[];

  constructor(payload: ManualProviderPayload) {
    this.teams = normalizedTeamArraySchema.parse(payload.teams ?? []);
    this.schedule = normalizedMatchArraySchema.parse(payload.schedule ?? []);
    this.results = normalizedResultArraySchema.parse(payload.results ?? []);
    this.standings = normalizedStandingArraySchema.parse(payload.standings ?? []);
  }

  async syncTeams(_context: ProviderContext) {
    return this.teams;
  }

  async syncSchedule(_context: ProviderContext) {
    return this.schedule;
  }

  async syncResults(_context: ProviderContext) {
    return this.results;
  }

  async syncStandings(_context: ProviderContext) {
    return this.standings;
  }

  async healthCheck(_context: ProviderContext): Promise<ProviderHealth> {
    return { ok: true, checkedAt: new Date().toISOString() };
  }
}
