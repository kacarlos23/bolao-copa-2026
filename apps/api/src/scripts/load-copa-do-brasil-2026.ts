import 'dotenv/config';
import { prisma } from '../prisma.js';
import {
  COPA_DO_BRASIL_2026_SEASON_SLUG,
  COPA_DO_BRASIL_2026_FIXTURE,
  prepareCopaDoBrasil2026,
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

async function main() {
  const mode = readMode();
  const provider = createCopaDoBrasilProvider({ fixtureName: COPA_DO_BRASIL_2026_FIXTURE });
  const source = await readCopaDoBrasilSource(provider);
  if (mode === 'dry-run') {
    process.stdout.write(
      `${JSON.stringify(
        {
          gate: 'PASS',
          mode,
          domainWrites: 0,
          evidence: source.evidence,
          readiness: source.readiness,
          plannedSyncTypes: ['TEAMS', 'STRUCTURE', 'TIES', 'SCHEDULE', 'RESULTS'],
          standingsImported: 0,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  let season = await prisma.competitionSeason.findFirst({
    where: { slug: COPA_DO_BRASIL_2026_SEASON_SLUG },
    select: { id: true },
  });
  if (mode === 'apply') {
    const prepared = await prepareCopaDoBrasil2026({
      readiness: source.readiness,
      evidence: source.evidence,
    });
    season = { id: prepared.season.id };
  }
  if (!season) throw new Error('Run --apply before --verify.');

  const runs = await synchronizeCopaDoBrasil(
    provider,
    season.id,
    source.evidence,
    mode === 'verify' ? 'VERIFY' : 'APPLY',
  );
  const smoke = await copaDoBrasilAdministrativeSmoke(season.id);
  process.stdout.write(
    `${JSON.stringify(
      {
        gate: 'PASS',
        mode,
        seasonId: season.id,
        evidence: source.evidence,
        readiness: source.readiness,
        runs: runs.map((run) => ({
          type: run.type,
          status: run.status,
          checksum: run.checksum,
          counts: run.counts,
        })),
        administrativeSmoke: smoke,
      },
      null,
      2,
    )}\n`,
  );
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
