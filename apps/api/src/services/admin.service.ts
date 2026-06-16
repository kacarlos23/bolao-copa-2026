import argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { AppError } from '../http/errors.js';
import { worldCup2026GroupStageMatches, worldCup2026Teams } from '../data/world-cup-2026.js';
import { getPredictionCloseMinutes, predictionCloseAt } from './prediction-settings.service.js';

export async function listUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      username: true,
      nickname: true,
      avatarUrl: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function setUserStatus(actorId: string, userId: string, blocked: boolean) {
  if (actorId === userId) {
    throw new AppError(
      400,
      'O administrador não pode bloquear a própria conta.',
      'SELF_BLOCK_NOT_ALLOWED',
    );
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { status: blocked ? 'BLOCKED' : 'ACTIVE' },
    select: {
      id: true,
      username: true,
      nickname: true,
      avatarUrl: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      actorId,
      action: blocked ? 'USER_BLOCKED' : 'USER_UNBLOCKED',
      targetId: userId,
    },
  });

  return user;
}

export async function resetUserPassword(actorId: string, userId: string, password: string) {
  if (password.length < 6) {
    throw new AppError(400, 'A senha deve ter pelo menos 6 caracteres.', 'WEAK_PASSWORD');
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  await prisma.adminAuditLog.create({
    data: { actorId, action: 'PASSWORD_RESET', targetId: userId },
  });
}

function localDateStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function flagUrl(iso2?: string) {
  return iso2 ? `https://flagcdn.com/w80/${iso2}.png` : null;
}

export async function listTeams() {
  return prisma.team.findMany({ orderBy: [{ name: 'asc' }] });
}

export async function seedOfficialWorldCupData(actorId: string) {
  await prisma.match.deleteMany({ where: { externalId: { startsWith: 'sportapi:match:' } } });
  await prisma.team.deleteMany({ where: { externalId: { startsWith: 'sportapi:team:' } } });

  for (const team of worldCup2026Teams) {
    await prisma.team.upsert({
      where: { externalId: `official:team:${team.code}` },
      update: {
        name: team.name,
        code: team.code,
        fifaRank: team.fifaRank,
        flagUrl: flagUrl(team.iso2),
        metadata: { iso2: team.iso2, flagEmoji: team.flagEmoji, group: team.group },
      },
      create: {
        externalId: `official:team:${team.code}`,
        name: team.name,
        code: team.code,
        fifaRank: team.fifaRank,
        flagUrl: flagUrl(team.iso2),
        metadata: { iso2: team.iso2, flagEmoji: team.flagEmoji, group: team.group },
      },
    });
  }

  let matches = 0;
  for (const match of worldCup2026GroupStageMatches) {
    await createOrUpdateMatch({
      actorId,
      homeTeamCode: match.homeCode,
      awayTeamCode: match.awayCode,
      startsAt: match.startsAt,
      source: 'official',
      metadata: { source: 'ge/fifa', round: match.round, group: match.group },
    });
    matches += 1;
  }

  await prisma.adminAuditLog.create({
    data: {
      actorId,
      action: 'MANUAL_SYNC',
      details: { source: 'official-local-seed', teams: worldCup2026Teams.length, matches },
    },
  });

  return { teams: worldCup2026Teams.length, matches };
}

export async function createOrUpdateMatch({
  actorId,
  homeTeamCode,
  awayTeamCode,
  startsAt,
  source = 'manual',
  metadata = {},
}: {
  actorId: string;
  homeTeamCode: string;
  awayTeamCode: string;
  startsAt: string;
  source?: 'manual' | 'official';
  metadata?: Prisma.InputJsonValue;
}) {
  if (homeTeamCode === awayTeamCode) {
    throw new AppError(400, 'Selecione duas seleções diferentes.', 'SAME_TEAM_MATCH');
  }

  const startsAtDate = new Date(startsAt);
  if (Number.isNaN(startsAtDate.getTime())) {
    throw new AppError(400, 'Data e horário do jogo inválidos.', 'INVALID_MATCH_DATE');
  }

  const [homeTeam, awayTeam] = await Promise.all([
    prisma.team.findFirst({ where: { code: homeTeamCode } }),
    prisma.team.findFirst({ where: { code: awayTeamCode } }),
  ]);

  if (!homeTeam || !awayTeam) {
    throw new AppError(400, 'Seleção não encontrada no cadastro.', 'TEAM_NOT_FOUND');
  }

  const predictionCloseMinutes = await getPredictionCloseMinutes();
  const date = localDateStart(startsAtDate);
  const closeAt = predictionCloseAt(startsAtDate, predictionCloseMinutes);
  const existingDay = await prisma.matchDay.findUnique({ where: { date } });
  const firstMatchStartsAt =
    existingDay && existingDay.firstMatchStartsAt < startsAtDate
      ? existingDay.firstMatchStartsAt
      : startsAtDate;
  const matchDayCloseAt = predictionCloseAt(firstMatchStartsAt, predictionCloseMinutes);

  const matchDay = await prisma.matchDay.upsert({
    where: { date },
    update: {
      firstMatchStartsAt,
      predictionsCloseAt: matchDayCloseAt,
      status: matchDayCloseAt.getTime() > Date.now() ? 'OPEN' : 'CLOSED',
    },
    create: {
      date,
      firstMatchStartsAt,
      predictionsCloseAt: closeAt,
      status: closeAt.getTime() > Date.now() ? 'OPEN' : 'CLOSED',
    },
  });

  const externalId = `${source}:match:${homeTeam.code}-${awayTeam.code}-${startsAtDate.toISOString()}`;
  const match = await prisma.match.upsert({
    where: { externalId },
    update: {
      matchDayId: matchDay.id,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      startsAt: startsAtDate,
      status: 'SCHEDULED',
      rawPayload: metadata,
      lastSyncedAt: null,
    },
    create: {
      externalId,
      matchDayId: matchDay.id,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      startsAt: startsAtDate,
      status: 'SCHEDULED',
      rawPayload: metadata,
    },
  });

  const dayMatches = await prisma.match.findMany({
    where: { matchDayId: matchDay.id },
    select: { startsAt: true },
  });
  const aggregateFirstMatch = dayMatches.reduce(
    (earliest, item) => (item.startsAt < earliest ? item.startsAt : earliest),
    startsAtDate,
  );
  const now = new Date();
  await prisma.matchDay.update({
    where: { id: matchDay.id },
    data: {
      firstMatchStartsAt: aggregateFirstMatch,
      predictionsCloseAt: predictionCloseAt(aggregateFirstMatch, predictionCloseMinutes),
      status: dayMatches.some(
        (item) =>
          item.startsAt > now && predictionCloseAt(item.startsAt, predictionCloseMinutes) > now,
      )
        ? 'OPEN'
        : 'CLOSED',
    },
  });

  if (source === 'manual') {
    await prisma.adminAuditLog.create({
      data: {
        actorId,
        action: 'MATCH_ADJUSTED',
        targetId: match.id,
        details: { homeTeamCode, awayTeamCode, startsAt },
      },
    });
  }

  return match;
}
