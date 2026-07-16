import 'dotenv/config';
import { prisma } from '../prisma.js';
import { importCbfSerieA2026TeamProfiles } from '../modules/teams/team-profile.importer.js';

async function main() {
  if (process.env.CBF_TEAM_PROFILES_IMPORT_ENABLED !== 'true') {
    throw new Error(
      'CBF team profile import is disabled. Obtain content authorization and set CBF_TEAM_PROFILES_IMPORT_ENABLED=true before running it.',
    );
  }
  const season = await prisma.competitionSeason.findFirst({
    where: { slug: 'brasileirao-serie-a-2026' },
    orderBy: { year: 'desc' },
    select: { id: true, name: true },
  });
  if (!season) throw new Error('Brasileirão Série A 2026 season was not found.');
  const profiles = await importCbfSerieA2026TeamProfiles(season.id);
  process.stdout.write(`${JSON.stringify({ season, profiles }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
