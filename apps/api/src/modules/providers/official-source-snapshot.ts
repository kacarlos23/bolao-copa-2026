import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  normalizedMatchArraySchema,
  normalizedResultArraySchema,
  normalizedStandingArraySchema,
  normalizedStructureArraySchema,
  normalizedTeamArraySchema,
  normalizedTieArraySchema,
  type ProviderSnapshotEvidence,
} from './competition-data-provider.js';
import { checksum } from './provider-utils.js';

const artifactSchema = z
  .object({
    kind: z.enum(['PAGE', 'PDF', 'RESPONSE']),
    source: z.string().trim().min(1).max(500),
    contentType: z.string().trim().min(1).max(120),
    bodyBase64: z.string().min(1),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative(),
  })
  .strict();

const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.string().trim().min(1).max(80),
    competition: z.string().trim().min(1).max(120),
    season: z.string().trim().min(1).max(80),
    source: z.string().trim().min(1).max(500),
    collectedAt: z.string().datetime({ offset: true }),
    snapshotChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    artifacts: z.array(artifactSchema).min(1).max(20),
    data: z
      .object({
        teams: normalizedTeamArraySchema,
        structure: normalizedStructureArraySchema,
        ties: normalizedTieArraySchema,
        schedule: normalizedMatchArraySchema,
        results: normalizedResultArraySchema,
        standings: normalizedStandingArraySchema,
      })
      .strict(),
  })
  .strict();

export type OfficialSourceSnapshot = z.infer<typeof snapshotSchema>;

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

export function computeOfficialSnapshotChecksum(
  value: Omit<OfficialSourceSnapshot, 'snapshotChecksum'>,
) {
  return checksum(value);
}

export function parseOfficialSourceSnapshot(
  value: unknown,
  expected: { provider: string; competition?: string },
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Provider snapshot must be an object.');
  }
  const { snapshotChecksum: suppliedChecksum, ...rawContent } = value as Record<string, unknown>;
  const actualChecksum = checksum(rawContent);
  if (actualChecksum !== suppliedChecksum) {
    throw new Error(
      `Immutable provider snapshot checksum mismatch: expected ${String(suppliedChecksum)}, received ${actualChecksum}.`,
    );
  }
  const snapshot = snapshotSchema.parse(value);
  if (snapshot.provider !== expected.provider) {
    throw new Error(
      `Snapshot provider mismatch: expected ${expected.provider}, received ${snapshot.provider}.`,
    );
  }
  if (expected.competition && snapshot.competition !== expected.competition) {
    throw new Error(
      `Snapshot competition mismatch: expected ${expected.competition}, received ${snapshot.competition}.`,
    );
  }
  for (const artifact of snapshot.artifacts) {
    const bytes = Buffer.from(artifact.bodyBase64, 'base64');
    if (bytes.byteLength !== artifact.byteLength || sha256(bytes) !== artifact.checksum) {
      throw new Error(
        `Immutable ${artifact.kind} artifact checksum mismatch for ${artifact.source}.`,
      );
    }
  }
  return snapshot;
}

const fixturesDirectory = fileURLToPath(new URL('./__fixtures__/official/', import.meta.url));

export function loadSanitizedOfficialFixture(
  fixtureName: string,
  expected: { provider: string; competition?: string },
) {
  if (basename(fixtureName) !== fixtureName || !fixtureName.endsWith('.sanitized.json')) {
    throw new Error('Only sanitized provider fixture basenames are accepted.');
  }
  const fixturePath = resolve(fixturesDirectory, fixtureName);
  const raw = readFileSync(fixturePath, 'utf8');
  return parseOfficialSourceSnapshot(JSON.parse(raw), expected);
}

export function snapshotEvidence(snapshot: OfficialSourceSnapshot): ProviderSnapshotEvidence {
  return {
    provider: snapshot.provider,
    competition: snapshot.competition,
    season: snapshot.season,
    source: snapshot.source,
    collectedAt: snapshot.collectedAt,
    checksum: snapshot.snapshotChecksum,
    byteLength: Buffer.byteLength(JSON.stringify(snapshot), 'utf8'),
    artifacts: snapshot.artifacts.map((artifact) => ({
      kind: artifact.kind,
      source: artifact.source,
      contentType: artifact.contentType,
      checksum: artifact.checksum,
      byteLength: artifact.byteLength,
    })),
  };
}
