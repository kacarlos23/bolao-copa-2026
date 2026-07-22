import { z } from 'zod';
import {
  assertSafeSourceDocument,
  type CompetitionDataProvider,
  type NormalizedMatch,
  type NormalizedResult,
  type NormalizedStanding,
  type NormalizedStructureEntity,
  type NormalizedTeam,
  type NormalizedTie,
  normalizedMatchArraySchema,
  normalizedResultArraySchema,
  normalizedStandingArraySchema,
  normalizedStructureArraySchema,
  normalizedTeamArraySchema,
  normalizedTieArraySchema,
  type ProviderContext,
  type ProviderHealth,
} from '../competition-data-provider.js';

export type CsvImportType = 'TEAMS' | 'STRUCTURE' | 'TIES' | 'SCHEDULE' | 'RESULTS' | 'STANDINGS';

export const MAX_CSV_BYTES = 750 * 1024;
const headersByType: Record<CsvImportType, Set<string>> = {
  TEAMS: new Set([
    'externalId',
    'name',
    'code',
    'type',
    'crestUrl',
    'groupName',
    'countryCode',
    'federation',
    'providerMetadata',
  ]),
  STRUCTURE: new Set([
    'kind',
    'externalId',
    'stageExternalId',
    'slug',
    'name',
    'type',
    'order',
    'status',
    'startsAt',
    'endsAt',
    'metadata',
  ]),
  TIES: new Set([
    'externalId',
    'key',
    'order',
    'stageExternalId',
    'roundExternalId',
    'teamAExternalId',
    'teamBExternalId',
    'teamAName',
    'teamBName',
    'expectedLegs',
    'status',
    'decisionMethod',
    'winnerTeamExternalId',
    'provenance',
    'metadata',
  ]),
  SCHEDULE: new Set([
    'externalId',
    'homeTeamExternalId',
    'awayTeamExternalId',
    'homeTeamName',
    'awayTeamName',
    'startsAt',
    'status',
    'stageExternalId',
    'roundExternalId',
    'tieExternalId',
    'legNumber',
    'groupName',
    'kickoffConfirmed',
    'venueName',
    'venueCity',
    'venueCountryCode',
    'providerMetadata',
  ]),
  RESULTS: new Set([
    'externalId',
    'matchExternalId',
    'homeTeamExternalId',
    'awayTeamExternalId',
    'homeTeamName',
    'awayTeamName',
    'startsAt',
    'homeScore',
    'awayScore',
    'regulationHomeScore',
    'regulationAwayScore',
    'extraTimeHomeScore',
    'extraTimeAwayScore',
    'penaltyHomeScore',
    'penaltyAwayScore',
    'homeYellowCards',
    'awayYellowCards',
    'homeRedCards',
    'awayRedCards',
    'status',
    'providerMetadata',
  ]),
  STANDINGS: new Set([
    'externalId',
    'teamExternalId',
    'teamName',
    'groupName',
    'position',
    'played',
    'won',
    'drawn',
    'lost',
    'goalsFor',
    'goalsAgainst',
    'points',
    'qualification',
    'providerMetadata',
  ]),
};

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  cells.push(cell.trim());
  return cells;
}

export function parseCsvRows(csv: string, type: CsvImportType) {
  if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES) {
    throw new Error(`CSV exceeds the ${MAX_CSV_BYTES} byte limit.`);
  }
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV must contain a header and at least one data row.');
  const headers = parseCsvLine(lines[0]);
  if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate headers.');
  for (const header of headers) {
    if (!headersByType[type].has(header)) throw new Error(`Unexpected CSV header: ${header}`);
  }

  return lines.slice(1).map((line, rowIndex) => {
    const cells = parseCsvLine(line);
    if (cells.length !== headers.length) {
      throw new Error(
        `CSV row ${rowIndex + 2} has ${cells.length} fields; expected ${headers.length}.`,
      );
    }
    return Object.fromEntries(
      headers.flatMap((header, index) => (cells[index] === '' ? [] : [[header, cells[index]]])),
    );
  });
}

function integerFields(row: Record<string, string>, fields: string[]) {
  const converted: Record<string, unknown> = { ...row };
  for (const field of fields) {
    if (converted[field] !== undefined) converted[field] = Number(converted[field]);
  }
  return converted;
}

function jsonFields(row: Record<string, unknown>, fields: string[]) {
  const converted = { ...row };
  for (const field of fields) {
    if (typeof converted[field] === 'string') converted[field] = JSON.parse(converted[field]);
  }
  return converted;
}

function csvBoolean(value: unknown) {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`CSV boolean value is invalid: ${String(value)}`);
}

function normalizeCsvRow(type: CsvImportType, row: Record<string, string>) {
  if (type === 'TEAMS') return jsonFields(row, ['providerMetadata']);
  if (type === 'STRUCTURE') {
    return jsonFields(integerFields(row, ['order']), ['metadata']);
  }
  if (type === 'TIES') {
    return jsonFields(integerFields(row, ['order', 'expectedLegs']), ['metadata']);
  }
  if (type === 'SCHEDULE') {
    const converted = jsonFields(integerFields(row, ['legNumber']), ['providerMetadata']);
    const venueName = converted.venueName;
    const normalized: Record<string, unknown> = {
      ...converted,
      kickoffConfirmed: csvBoolean(converted.kickoffConfirmed),
      ...(venueName
        ? {
            venue: {
              name: venueName,
              ...(converted.venueCity ? { city: converted.venueCity } : {}),
              ...(converted.venueCountryCode ? { countryCode: converted.venueCountryCode } : {}),
            },
          }
        : {}),
    };
    delete normalized.venueName;
    delete normalized.venueCity;
    delete normalized.venueCountryCode;
    if (normalized.kickoffConfirmed === undefined) delete normalized.kickoffConfirmed;
    return normalized;
  }
  if (type === 'RESULTS') {
    return jsonFields(
      integerFields(row, [
        'homeScore',
        'awayScore',
        'regulationHomeScore',
        'regulationAwayScore',
        'extraTimeHomeScore',
        'extraTimeAwayScore',
        'penaltyHomeScore',
        'penaltyAwayScore',
        'homeYellowCards',
        'awayYellowCards',
        'homeRedCards',
        'awayRedCards',
      ]),
      ['providerMetadata'],
    );
  }
  return jsonFields(
    integerFields(row, [
      'position',
      'played',
      'won',
      'drawn',
      'lost',
      'goalsFor',
      'goalsAgainst',
      'points',
    ]),
    ['providerMetadata'],
  );
}

export class CsvProvider implements CompetitionDataProvider {
  readonly name = 'csv';
  readonly source: string;
  private readonly rows: Array<Record<string, string>>;

  constructor(
    private readonly type: CsvImportType,
    csv: string,
    sourceDocument: string,
  ) {
    this.source = `csv://${assertSafeSourceDocument(sourceDocument)}`;
    this.rows = parseCsvRows(csv, type);
  }

  async syncTeams(_context: ProviderContext): Promise<NormalizedTeam[]> {
    return this.type === 'TEAMS'
      ? normalizedTeamArraySchema.parse(this.rows.map((row) => normalizeCsvRow(this.type, row)))
      : [];
  }

  async syncStructure(_context: ProviderContext): Promise<NormalizedStructureEntity[]> {
    return this.type === 'STRUCTURE'
      ? normalizedStructureArraySchema.parse(
          this.rows.map((row) => normalizeCsvRow(this.type, row)),
        )
      : [];
  }

  async syncTies(_context: ProviderContext): Promise<NormalizedTie[]> {
    return this.type === 'TIES'
      ? normalizedTieArraySchema.parse(this.rows.map((row) => normalizeCsvRow(this.type, row)))
      : [];
  }

  async syncSchedule(_context: ProviderContext): Promise<NormalizedMatch[]> {
    return this.type === 'SCHEDULE'
      ? normalizedMatchArraySchema.parse(this.rows.map((row) => normalizeCsvRow(this.type, row)))
      : [];
  }

  async syncResults(_context: ProviderContext): Promise<NormalizedResult[]> {
    if (this.type !== 'RESULTS') return [];
    return normalizedResultArraySchema.parse(
      this.rows.map((row) => normalizeCsvRow(this.type, row)),
    );
  }

  async syncStandings(_context: ProviderContext): Promise<NormalizedStanding[]> {
    if (this.type !== 'STANDINGS') return [];
    return normalizedStandingArraySchema.parse(
      this.rows.map((row) => normalizeCsvRow(this.type, row)),
    );
  }

  async healthCheck(_context: ProviderContext): Promise<ProviderHealth> {
    return { ok: true, checkedAt: new Date().toISOString(), message: `${this.rows.length} rows` };
  }
}

export const csvImportRequestSchema = z
  .object({
    type: z.enum(['TEAMS', 'STRUCTURE', 'TIES', 'SCHEDULE', 'RESULTS', 'STANDINGS']),
    sourceDocument: z.string().trim().min(1).max(200),
    csv: z.string().min(1).max(MAX_CSV_BYTES),
  })
  .strict();
