import { KnockoutGenerationMode, KnockoutGenerationStatus } from '@prisma/client';
import { firstKnockoutStartsAt } from '../data/knockout-fixtures.js';
import { prisma } from '../prisma.js';
import { emitSse } from '../realtime/sse.js';

export const PREDICTION_CLOSE_MINUTES_KEY = 'prediction.closeMinutes';
export const DEFAULT_PREDICTION_CLOSE_MINUTES = 5;
export const MIN_PREDICTION_CLOSE_MINUTES = 1;
export const MAX_PREDICTION_CLOSE_MINUTES = 120;

type PredictionCloseSettingValue = { minutes: number };

function settingMinutes(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const minutes = (value as Record<string, unknown>).minutes;
  return typeof minutes === 'number' &&
    Number.isInteger(minutes) &&
    minutes >= MIN_PREDICTION_CLOSE_MINUTES &&
    minutes <= MAX_PREDICTION_CLOSE_MINUTES
    ? minutes
    : null;
}

export function predictionCloseAt(startsAt: Date, closeMinutes: number) {
  return new Date(startsAt.getTime() - closeMinutes * 60 * 1000);
}

export function predictionState(startsAt: Date, closeMinutes: number, now = new Date()) {
  const predictionsCloseAt = predictionCloseAt(startsAt, closeMinutes);
  const isOpenForPredictions = startsAt > now && predictionsCloseAt > now;
  return {
    predictionsCloseAt,
    isOpenForPredictions,
    predictionsArePublic: !isOpenForPredictions,
  };
}

export async function ensurePredictionCloseSetting() {
  return prisma.appSetting.upsert({
    where: { key: PREDICTION_CLOSE_MINUTES_KEY },
    update: {},
    create: {
      key: PREDICTION_CLOSE_MINUTES_KEY,
      value: { minutes: DEFAULT_PREDICTION_CLOSE_MINUTES } satisfies PredictionCloseSettingValue,
    },
  });
}

export async function getPredictionCloseSetting() {
  const setting = await prisma.appSetting.findUnique({
    where: { key: PREDICTION_CLOSE_MINUTES_KEY },
  });
  return {
    closeMinutes: settingMinutes(setting?.value) ?? DEFAULT_PREDICTION_CLOSE_MINUTES,
    updatedAt: setting?.updatedAt ?? null,
  };
}

export async function getPredictionCloseMinutes() {
  return (await getPredictionCloseSetting()).closeMinutes;
}

export async function updatePredictionCloseMinutes(actorId: string, closeMinutes: number) {
  const now = new Date();
  const current = await getPredictionCloseSetting();
  const matchDays = await prisma.matchDay.findMany({
    include: { matches: { select: { startsAt: true } } },
  });

  let reopenedMatches = 0;
  let closedMatches = 0;
  for (const day of matchDays) {
    for (const match of day.matches) {
      if (match.startsAt <= now) continue;
      const wasOpen = predictionState(
        match.startsAt,
        current.closeMinutes,
        now,
      ).isOpenForPredictions;
      const isOpen = predictionState(match.startsAt, closeMinutes, now).isOpenForPredictions;
      if (!wasOpen && isOpen) reopenedMatches += 1;
      if (wasOpen && !isOpen) closedMatches += 1;
    }
  }

  const knockoutClosesAt = predictionCloseAt(firstKnockoutStartsAt, closeMinutes);
  const knockoutStatus =
    firstKnockoutStartsAt > now && knockoutClosesAt > now
      ? KnockoutGenerationStatus.ACTIVE
      : KnockoutGenerationStatus.LOCKED;

  const setting = await prisma.$transaction(async (tx) => {
    const savedSetting = await tx.appSetting.upsert({
      where: { key: PREDICTION_CLOSE_MINUTES_KEY },
      update: { value: { minutes: closeMinutes } },
      create: {
        key: PREDICTION_CLOSE_MINUTES_KEY,
        value: { minutes: closeMinutes },
      },
    });

    for (const day of matchDays) {
      const firstMatchStartsAt = day.matches.reduce(
        (earliest, match) => (match.startsAt < earliest ? match.startsAt : earliest),
        day.firstMatchStartsAt,
      );
      const isOpen = day.matches.some(
        (match) => predictionState(match.startsAt, closeMinutes, now).isOpenForPredictions,
      );
      await tx.matchDay.update({
        where: { id: day.id },
        data: {
          firstMatchStartsAt,
          predictionsCloseAt: predictionCloseAt(firstMatchStartsAt, closeMinutes),
          status: isOpen ? 'OPEN' : 'CLOSED',
        },
      });
    }

    await tx.knockoutGeneration.updateMany({
      where: {
        mode: KnockoutGenerationMode.OFFICIAL,
        status: { in: [KnockoutGenerationStatus.ACTIVE, KnockoutGenerationStatus.LOCKED] },
      },
      data: { closesAt: knockoutClosesAt, status: knockoutStatus },
    });

    await tx.adminAuditLog.create({
      data: {
        actorId,
        action: 'SETTING_UPDATED',
        targetId: PREDICTION_CLOSE_MINUTES_KEY,
        details: {
          previousCloseMinutes: current.closeMinutes,
          closeMinutes,
          reopenedMatches,
          closedMatches,
        },
      },
    });
    return savedSetting;
  });

  const payload = {
    predictionCloseMinutes: closeMinutes,
    previousCloseMinutes: current.closeMinutes,
    reopenedMatches,
    closedMatches,
    updatedAt: setting.updatedAt.toISOString(),
  };
  emitSse('prediction-settings.updated', payload);
  emitSse('prediction-board.updated', payload);
  return payload;
}
