import { prisma } from '../prisma.js';
import { reprocessBrasileirao2026Ranking } from '../modules/brasileirao/brasileirao-2026-reprocessing.service.js';

function option(name: string) {
  const argument = process.argv.find((item) => item.startsWith(`${name}=`));
  return argument?.slice(name.length + 1);
}

async function main() {
  const result = await reprocessBrasileirao2026Ranking({
    actorId: option('--actor-id') ?? null,
    requestId: option('--request-id'),
    idempotencyKey: option('--idempotency-key'),
    justification: option('--justification'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
