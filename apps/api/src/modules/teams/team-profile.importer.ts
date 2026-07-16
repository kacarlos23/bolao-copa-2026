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

export async function importCbfSerieA2026TeamProfiles(seasonId: string, concurrency = 3) {
  const mappings = await prisma.providerEntityMapping.findMany({
    where: { seasonId, provider: PROVIDER, entityType: 'TEAM' },
    select: { internalId: true, externalId: true },
    orderBy: { externalId: 'asc' },
  });
  const seasonTeams = await prisma.seasonTeam.findMany({
    where: { seasonId },
    select: { team: { select: { id: true, name: true } } },
  });
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

  await prisma.$transaction(
    collected.map(({ target, profile }) =>
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
  return collected.map(({ target, profile }) => ({
    teamId: target.teamId,
    externalTeamId: profile.externalTeamId,
    athletes: profile.athletes.length,
    matches: profile.matches.length,
    checksum: profile.checksum,
    collectedAt: profile.collectedAt,
  }));
}
