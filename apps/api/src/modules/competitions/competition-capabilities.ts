import { competitionCapabilitiesSchema, type CompetitionCapabilities } from '@bolao/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

const compatibilityMetadataSchema = z
  .object({ legacyDefault: z.boolean().optional() })
  .passthrough();

/**
 * Converts persisted metadata compatibility flags into an explicit capability.
 * It intentionally has no knowledge of competition or season slugs.
 */
export function publicCompetitionCapabilities(
  capabilities: Prisma.JsonValue | null,
  metadata: Prisma.JsonValue | null,
): CompetitionCapabilities | null {
  const parsed = capabilities == null ? null : competitionCapabilitiesSchema.parse(capabilities);
  const compatibility = compatibilityMetadataSchema.safeParse(metadata);
  if (!compatibility.success || !compatibility.data.legacyDefault) return parsed;
  return competitionCapabilitiesSchema.parse({
    ...(parsed ?? {}),
    workspace: 'WORLD_CUP_LEGACY',
  });
}
