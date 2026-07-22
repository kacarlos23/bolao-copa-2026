import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { normalizeEntityName } from '../providers/competition-data-provider.js';
import {
  collectCbfTeamProfile,
  type CollectedCbfTeamProfile,
} from './cbf-team-profile.provider.js';

const PROVIDER = 'cbf-official';

interface ImportTarget {
  teamId: string;
  teamName: string;
  externalTeamId: string;
}

interface ExistingTeamProfile {
  checksum: string;
  athletes: Prisma.JsonValue;
  matches: Prisma.JsonValue;
}

function profileAthleteIds(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) return new Set<string>();
  return new Set(
    value.flatMap((athlete) => {
      if (!athlete || Array.isArray(athlete) || typeof athlete !== 'object') return [];
      const externalId = athlete.externalId;
      return typeof externalId === 'string' ? [externalId] : [];
    }),
  );
}

export function shouldApplyCbfTeamProfile(
  existing: ExistingTeamProfile | undefined,
  incoming: CollectedCbfTeamProfile,
) {
  if (!existing) return true;
  if (existing.checksum === incoming.checksum) return false;

  // A season profile is cumulative. CBF edge replicas can briefly return an older,
  // incomplete roster or match history; preserving the last complete official
  // snapshot prevents alternating checksums on consecutive admin refreshes.
  const existingAthletes = profileAthleteIds(existing.athletes);
  const incomingAthletes = new Set(incoming.athletes.map((athlete) => athlete.externalId));
  if ([...existingAthletes].some((externalId) => !incomingAthletes.has(externalId))) {
    return false;
  }
  if (Array.isArray(existing.matches) && incoming.matches.length < existing.matches.length) {
    return false;
  }
  return true;
}

export async function importCbfSerieA2026TeamProfiles(seasonId: string, concurrency = 1) {
  const [mappings, seasonTeams, existingProfiles] = await Promise.all([
    prisma.providerEntityMapping.findMany({
      where: { seasonId, provider: PROVIDER, entityType: 'TEAM' },
      select: { internalId: true, externalId: true },
      orderBy: { externalId: 'asc' },
    }),
    prisma.seasonTeam.findMany({
      where: { seasonId },
      select: { team: { select: { id: true, name: true } } },
    }),
    prisma.teamProfileSnapshot.findMany({
      where: { seasonId, provider: PROVIDER },
      select: { teamId: true, checksum: true, athletes: true, matches: true },
    }),
  ]);
  const teamById = new Map(seasonTeams.map(({ team }) => [team.id, team]));
  const targets: ImportTarget[] = mappings.map((mapping) => {
    const team = teamById.get(mapping.internalId);
    const externalTeamId = mapping.externalId.match(/^team:(\d+)$/)?.[1];
    if (!team || !externalTeamId) {
      throw new Error(`Invalid CBF team mapping ${mapping.externalId} for season ${seasonId}.`);
    }
    return { teamId: team.id, teamName: team.name, externalTeamId };
  });
  if (targets.length !== seasonTeams.length || targets.length !== 20) {
    throw new Error(`Expected 20 reconciled CBF teams, received ${targets.length}.`);
  }

  const collected = new Array<{ target: ImportTarget; profile: CollectedCbfTeamProfile }>(
    targets.length,
  );
  let nextIndex = 0;
  const worker = async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= targets.length) return;
      const target = targets[index]!;
      const profile = await collectCbfTeamProfile(target.externalTeamId);
      if (normalizeEntityName(profile.name) !== normalizeEntityName(target.teamName)) {
        throw new Error(
          `CBF profile ${profile.externalTeamId} name ${profile.name} does not match ${target.teamName}.`,
        );
      }
      collected[index] = { target, profile };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, concurrency)) }, worker));

  const existingByTeamId = new Map(existingProfiles.map((profile) => [profile.teamId, profile]));
  const changed = collected.filter(({ target, profile }) =>
    shouldApplyCbfTeamProfile(existingByTeamId.get(target.teamId), profile),
  );
  if (changed.length)
    await prisma.$transaction(
      changed.map(({ target, profile }) =>
        prisma.teamProfileSnapshot.upsert({
          where: {
            seasonId_teamId_provider: { seasonId, teamId: target.teamId, provider: PROVIDER },
          },
          create: {
            seasonId,
            teamId: target.teamId,
            provider: PROVIDER,
            externalTeamId: profile.externalTeamId,
            state: profile.state,
            countryCode: 'BRA',
            federation: 'CBF',
            providerMetadata: { competition: 'SERIE_A', providerContract: 'cbf-team-profile-v1' },
            sourceUrl: profile.sourceUrl,
            collectedAt: new Date(profile.collectedAt),
            checksum: profile.checksum,
            statistics: profile.statistics as Prisma.InputJsonValue,
            athletes: profile.athletes as Prisma.InputJsonValue,
            matches: profile.matches as Prisma.InputJsonValue,
          },
          update: {
            externalTeamId: profile.externalTeamId,
            state: profile.state,
            countryCode: 'BRA',
            federation: 'CBF',
            providerMetadata: { competition: 'SERIE_A', providerContract: 'cbf-team-profile-v1' },
            sourceUrl: profile.sourceUrl,
            collectedAt: new Date(profile.collectedAt),
            checksum: profile.checksum,
            statistics: profile.statistics as Prisma.InputJsonValue,
            athletes: profile.athletes as Prisma.InputJsonValue,
            matches: profile.matches as Prisma.InputJsonValue,
          },
        }),
      ),
    );
  return changed.map(({ target, profile }) => ({
    teamId: target.teamId,
    externalTeamId: profile.externalTeamId,
    athletes: profile.athletes.length,
    matches: profile.matches.length,
    checksum: profile.checksum,
    collectedAt: profile.collectedAt,
  }));
}
