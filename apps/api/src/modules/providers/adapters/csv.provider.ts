import { z } from 'zod';
import {
  assertSafeSourceDocument,
  type CompetitionDataProvider,
  type NormalizedMatch,
  type NormalizedResult,
  type NormalizedStanding,
  type NormalizedTeam,
  normalizedMatchArraySchema,
  normalizedResultArraySchema,
  normalizedStandingArraySchema,
  normalizedTeamArraySchema,
  type ProviderContext,
  type ProviderHealth,
} from '../competition-data-provider.js';

export type CsvImportType = 'TEAMS' | 'SCHEDULE' | 'RESULTS' | 'STANDINGS';

export const MAX_CSV_BYTES = 750 * 1024;
const headersByType: Record<CsvImportType, Set<string>> = {
  TEAMS: new Set(['externalId', 'name', 'code', 'type', 'crestUrl', 'groupName']),
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
    'homeYellowCards',
    'awayYellowCards',
    'homeRedCards',
    'awayRedCards',
    'status',
  ]),
  STANDINGS: new Set([
    'externalId',
    'teamExternalId',
    'teamName',
    'position',
    'played',
    'won',
    'drawn',
    'lost',
    'goalsFor',
    'goalsAgainst',
    'points',
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
    return this.type === 'TEAMS' ? normalizedTeamArraySchema.parse(this.rows) : [];
  }

  async syncSchedule(_context: ProviderContext): Promise<NormalizedMatch[]> {
    return this.type === 'SCHEDULE' ? normalizedMatchArraySchema.parse(this.rows) : [];
  }

  async syncResults(_context: ProviderContext): Promise<NormalizedResult[]> {
    if (this.type !== 'RESULTS') return [];
    return normalizedResultArraySchema.parse(
      this.rows.map((row) =>
        integerFields(row, [
          'homeScore',
          'awayScore',
          'homeYellowCards',
          'awayYellowCards',
          'homeRedCards',
          'awayRedCards',
        ]),
      ),
    );
  }

  async syncStandings(_context: ProviderContext): Promise<NormalizedStanding[]> {
    if (this.type !== 'STANDINGS') return [];
    return normalizedStandingArraySchema.parse(
      this.rows.map((row) =>
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
      ),
    );
  }

  async healthCheck(_context: ProviderContext): Promise<ProviderHealth> {
    return { ok: true, checkedAt: new Date().toISOString(), message: `${this.rows.length} rows` };
  }
}

export const csvImportRequestSchema = z
  .object({
    type: z.enum(['TEAMS', 'SCHEDULE', 'RESULTS', 'STANDINGS']),
    sourceDocument: z.string().trim().min(1).max(200),
    csv: z.string().min(1).max(MAX_CSV_BYTES),
  })
  .strict();
