import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const REQUIRED_COUNTS = ['activeUsers', 'matches', 'predictions', 'scores', 'knockoutFixtures'];

export function validateSnapshot(snapshot, label = 'snapshot') {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error(`${label} deve ser um objeto JSON.`);
  }
  if (snapshot.formatVersion !== 1 || snapshot.scope !== 'world-cup-2026') {
    throw new Error(`${label} tem versao ou escopo incompativel.`);
  }
  if (!snapshot.counts || typeof snapshot.counts !== 'object') {
    throw new Error(`${label}.counts ausente.`);
  }
  for (const field of REQUIRED_COUNTS) {
    if (!Number.isSafeInteger(snapshot.counts[field]) || snapshot.counts[field] < 0) {
      throw new Error(`${label}.counts.${field} deve ser um inteiro nao negativo.`);
    }
  }
  if (!Array.isArray(snapshot.ranking) || !Array.isArray(snapshot.userTotals)) {
    throw new Error(`${label} deve conter ranking e userTotals como listas.`);
  }
}

function samePrimitive(before, after) {
  return Object.is(before, after);
}

export function compareSnapshots(before, after) {
  validateSnapshot(before, 'before');
  validateSnapshot(after, 'after');

  return compareValues(before, after);
}

function compareValues(before, after) {
  const differences = [];

  function visit(left, right, currentPath) {
    if (samePrimitive(left, right)) return;

    const leftIsObject = left !== null && typeof left === 'object';
    const rightIsObject = right !== null && typeof right === 'object';
    if (!leftIsObject || !rightIsObject || Array.isArray(left) !== Array.isArray(right)) {
      differences.push({ path: currentPath, before: left, after: right });
      return;
    }

    if (Array.isArray(left)) {
      if (left.length !== right.length) {
        differences.push({
          path: `${currentPath}.length`,
          before: left.length,
          after: right.length,
        });
      }
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) {
        visit(left[index], right[index], `${currentPath}[${index}]`);
      }
      return;
    }

    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      visit(left[key], right[key], currentPath ? `${currentPath}.${key}` : key);
    }
  }

  visit(before, after, '');
  return differences;
}

export function compareBackfillSnapshots(before, after) {
  validateSnapshot(before, 'before');
  validateSnapshot(after, 'after');
  if (!before.businessContentHashes || !after.businessContentHashes) {
    throw new Error('Snapshots de backfill devem conter businessContentHashes.');
  }

  const projection = (snapshot) => ({
    formatVersion: snapshot.formatVersion,
    scope: snapshot.scope,
    counts: snapshot.counts,
    scoreCounts: snapshot.scoreCounts,
    predictionCounts: snapshot.predictionCounts,
    businessContentHashes: snapshot.businessContentHashes,
    ranking: snapshot.ranking,
    userTotals: snapshot.userTotals,
  });
  return compareValues(projection(before), projection(after));
}

async function readSnapshot(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function main() {
  const args = process.argv.slice(2);
  const backfillMode = args.includes('--backfill');
  const [beforeFile, afterFile] = args.filter((argument) => argument !== '--backfill');
  if (!beforeFile || !afterFile) {
    throw new Error(
      'Uso: node scripts/compare-copa-snapshots.mjs [--backfill] <antes.json> <depois.json>',
    );
  }

  const before = await readSnapshot(beforeFile);
  const after = await readSnapshot(afterFile);
  const differences = backfillMode
    ? compareBackfillSnapshots(before, after)
    : compareSnapshots(before, after);

  if (differences.length === 0) {
    process.stdout.write('Snapshots identicos.\n');
    return;
  }

  process.stderr.write(`Snapshots divergentes: ${differences.length} diferenca(s).\n`);
  for (const difference of differences.slice(0, 50)) {
    process.stderr.write(
      `${difference.path || '<root>'}: ${JSON.stringify(difference.before)} -> ${JSON.stringify(difference.after)}\n`,
    );
  }
  if (differences.length > 50) {
    process.stderr.write(`... ${differences.length - 50} diferenca(s) omitida(s).\n`);
  }
  process.exitCode = 1;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`Falha ao comparar snapshots: ${error.message}\n`);
    process.exitCode = 2;
  });
}
