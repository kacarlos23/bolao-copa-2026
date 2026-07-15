import { normalizeEntityName } from './competition-data-provider.js';

export interface NamedCandidate {
  id: string;
  name: string;
}

export function uniqueNameCandidate<T extends NamedCandidate>(name: string, candidates: T[]) {
  const normalized = normalizeEntityName(name);
  const matches = candidates.filter(
    (candidate) => normalizeEntityName(candidate.name) === normalized,
  );
  return { candidate: matches.length === 1 ? matches[0] : null, matches };
}

export function partitionDuplicateExternalIds<T extends { externalId: string }>(items: T[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.externalId, (counts.get(item.externalId) ?? 0) + 1);
  return {
    accepted: items.filter((item) => counts.get(item.externalId) === 1),
    duplicates: items.filter((item) => (counts.get(item.externalId) ?? 0) > 1),
  };
}

export function resultUpdateAllowed(currentStatus: string, incomingStatus: string) {
  return currentStatus !== 'FINISHED' || incomingStatus === 'FINISHED';
}

export function valuesAfterManualOverride<T extends Record<string, unknown>>(
  synchronized: T,
  override: Record<string, unknown> | null,
) {
  return override ? { ...synchronized, ...override } : synchronized;
}

export function chooseMatchIdentity(mappedInternalId: string | null, fallbackIds: string[]) {
  if (mappedInternalId) return { internalId: mappedInternalId, ambiguous: false };
  return {
    internalId: fallbackIds.length === 1 ? fallbackIds[0] : null,
    ambiguous: fallbackIds.length > 1,
  };
}
