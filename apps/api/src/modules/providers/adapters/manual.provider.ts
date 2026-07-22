import type {
  CompetitionDataProvider,
  NormalizedMatch,
  NormalizedResult,
  NormalizedStanding,
  NormalizedStructureEntity,
  NormalizedTeam,
  NormalizedTie,
  ProviderContext,
  ProviderHealth,
} from '../competition-data-provider.js';
import {
  normalizedMatchArraySchema,
  normalizedResultArraySchema,
  normalizedStandingArraySchema,
  normalizedStructureArraySchema,
  normalizedTeamArraySchema,
  normalizedTieArraySchema,
} from '../competition-data-provider.js';

export interface ManualProviderPayload {
  teams?: unknown;
  structure?: unknown;
  ties?: unknown;
  schedule?: unknown;
  results?: unknown;
  standings?: unknown;
}

export class ManualProvider implements CompetitionDataProvider {
  readonly name: string = 'manual';
  readonly source: string = 'manual://admin';
  private readonly teams: NormalizedTeam[];
  private readonly structure: NormalizedStructureEntity[];
  private readonly ties: NormalizedTie[];
  private readonly schedule: NormalizedMatch[];
  private readonly results: NormalizedResult[];
  private readonly standings: NormalizedStanding[];

  constructor(payload: ManualProviderPayload) {
    this.teams = normalizedTeamArraySchema.parse(payload.teams ?? []);
    this.structure = normalizedStructureArraySchema.parse(payload.structure ?? []);
    this.ties = normalizedTieArraySchema.parse(payload.ties ?? []);
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

  async syncStructure(_context: ProviderContext) {
    return this.structure;
  }

  async syncTies(_context: ProviderContext) {
    return this.ties;
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
