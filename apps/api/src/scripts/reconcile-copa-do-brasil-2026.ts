import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../prisma.js';
import {
  COPA_DO_BRASIL_2026_FIXTURE,
  COPA_DO_BRASIL_2026_SEASON_SLUG,
} from '../modules/copa-do-brasil/copa-do-brasil-2026.service.js';
import {
  copaDoBrasilAdministrativeSmoke,
  createCopaDoBrasilProvider,
  readCopaDoBrasilSource,
  synchronizeCopaDoBrasil,
} from '../modules/copa-do-brasil/copa-do-brasil-2026.sync.js';

type Mode = 'dry-run' | 'apply' | 'verify';

function readMode(): Mode {
  if (process.argv.includes('--apply')) return 'apply';
  if (process.argv.includes('--verify')) return 'verify';
  if (process.argv.includes('--dry-run') || process.argv.length === 2) return 'dry-run';
  throw new Error('Use --dry-run, --apply or --verify.');
}

function metadata(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function reconcileRules(source: Awaited<ReturnType<typeof readCopaDoBrasilSource>>) {
  const expectedMatches = [14, 44, 24, 12, 32, 16, 0, 0, 0];
  const expectedResults = [14, 44, 24, 12, 32, 0, 0, 0, 0];
  const expectedTies = [14, 44, 24, 12, 16, 8, 0, 0, 0];
  const phase = (value: unknown) => Number(metadata(value).phase);
  const matchesByPhase = expectedMatches.map(
    (_, index) =>
      source.schedule.filter((match) => phase(match.providerMetadata) === index + 1).length,
  );
  const resultsByPhase = expectedResults.map(
    (_, index) =>
      source.results.filter((result) => phase(result.providerMetadata) === index + 1).length,
  );
  const tiesByPhase = expectedTies.map(
    (_, index) => source.ties.filter((tie) => phase(tie.metadata) === index + 1).length,
  );
  const matchExternalIds = new Set(source.schedule.map((match) => match.externalId));
  const resultMatchIds = new Set(source.results.map((result) => result.matchExternalId));
  const scheduleTieIds = new Set(source.schedule.map((match) => match.tieExternalId));
  const tieIds = new Set(source.ties.map((tie) => tie.externalId));
  const deferredRounds = source.structure.filter(
    (item) =>
      item.kind === 'ROUND' &&
      item.order >= 7 &&
      Number(metadata(item.metadata).deferredTieSlots) > 0,
  );
  if (
    JSON.stringify(matchesByPhase) !== JSON.stringify(expectedMatches) ||
    JSON.stringify(resultsByPhase) !== JSON.stringify(expectedResults) ||
    JSON.stringify(tiesByPhase) !== JSON.stringify(expectedTies) ||
    matchExternalIds.size !== source.schedule.length ||
    [...resultMatchIds].some((matchId) => !matchId || !matchExternalIds.has(matchId)) ||
    [...scheduleTieIds].some((tieId) => !tieId || !tieIds.has(tieId)) ||
    deferredRounds.length !== 3 ||
    source.results.filter((result) => result.penaltyHomeScore !== undefined).length !== 33
  ) {
    throw new Error(
      `Copa do Brasil sporting reconciliation failed: ${JSON.stringify({
        matchesByPhase,
        resultsByPhase,
        tiesByPhase,
        duplicateMatches: source.schedule.length - matchExternalIds.size,
        deferredRounds: deferredRounds.length,
        penalties: source.results.filter((result) => result.penaltyHomeScore !== undefined).length,
      })}`,
    );
  }
  return {
    status: 'PASS',
    matchesByPhase,
    resultsByPhase,
    tiesByPhase,
    uniqueMatchIds: matchExternalIds.size,
    uniqueTieIds: tieIds.size,
    deferredBracketSlots: 7,
    penaltyResults: 33,
    standings: 0,
  };
}

async function main() {
  const mode = readMode();
  const provider = createCopaDoBrasilProvider({ fixtureName: COPA_DO_BRASIL_2026_FIXTURE });
  const source = await readCopaDoBrasilSource(provider);
  const sporting = reconcileRules(source);
  if (mode === 'dry-run') {
    process.stdout.write(
      `${JSON.stringify({ gate: 'PASS', mode, domainWrites: 0, evidence: source.evidence, readiness: source.readiness, sporting }, null, 2)}\n`,
    );
    return;
  }
  const season = await prisma.competitionSeason.findFirst({
    where: { slug: COPA_DO_BRASIL_2026_SEASON_SLUG },
    select: { id: true },
  });
  if (!season) throw new Error('Run load --apply before reconcile --apply/--verify.');
  const runs = await synchronizeCopaDoBrasil(
    provider,
    season.id,
    source.evidence,
    mode === 'verify' ? 'VERIFY' : 'APPLY',
  );
  const smoke = await copaDoBrasilAdministrativeSmoke(season.id);
  const report = {
    formatVersion: 1,
    suite: 'cbf-copa-do-brasil-2026-source-reconciliation-local',
    status: 'passed',
    mode,
    productionEvidence: false,
    evidence: source.evidence,
    readiness: source.readiness,
    sporting,
    runs: runs.map((run) => ({ type: run.type, status: run.status, counts: run.counts })),
    administrativeSmoke: smoke,
  };
  const outputDir = path.resolve(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '..',
    'output',
    'release-gates',
  );
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, 'cbf-copa-do-brasil-2026-reconciliation-local.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({ gate: 'PASS', ...report }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
