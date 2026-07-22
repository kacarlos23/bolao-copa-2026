import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectCopaDoBrasil2026Snapshot } from '../modules/providers/adapters/cbf-copa-do-brasil-2026.provider.js';
import { assertCopaDoBrasil2026Readiness } from '../modules/copa-do-brasil/copa-do-brasil-2026.service.js';

const collected = await collectCopaDoBrasil2026Snapshot();
const data = collected.snapshot.data;
const readiness = assertCopaDoBrasil2026Readiness({
  teams: data.teams,
  structure: data.structure,
  ties: data.ties,
  schedule: data.schedule,
  results: data.results,
  standings: data.standings,
  evidence: {
    provider: collected.snapshot.provider,
    competition: collected.snapshot.competition,
    season: collected.snapshot.season,
    source: collected.snapshot.source,
    collectedAt: collected.snapshot.collectedAt,
    collectionTimezone: collected.snapshot.collectionTimezone,
    sourceOffset: collected.snapshot.sourceOffset,
    checksum: collected.snapshot.snapshotChecksum,
    byteLength: Buffer.byteLength(JSON.stringify(collected.snapshot), 'utf8'),
    artifacts: collected.snapshot.artifacts.map((artifact) => ({
      kind: artifact.kind,
      source: artifact.source,
      contentType: artifact.contentType,
      checksum: artifact.checksum,
      byteLength: artifact.byteLength,
    })),
  },
});
const fixturePath = path.resolve(
  import.meta.dirname,
  '..',
  'modules',
  'providers',
  '__fixtures__',
  'official',
  'cbf-copa-do-brasil-2026.sanitized.json',
);
await mkdir(path.dirname(fixturePath), { recursive: true });
await writeFile(fixturePath, `${JSON.stringify(collected.snapshot, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ gate: 'PASS', fixturePath, evidence: collected.evidence, readiness }, null, 2)}\n`,
);
