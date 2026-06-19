import { prisma } from '../prisma.js';
import { emitSse } from '../realtime/sse.js';

export const SCORE_SYNC_ENABLED_KEY = 'scoreSync.enabled';
export const DEFAULT_SCORE_SYNC_ENABLED = true;

type ScoreSyncSettingValue = { enabled: boolean };

function settingEnabled(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const enabled = (value as Record<string, unknown>).enabled;
  return typeof enabled === 'boolean' ? enabled : null;
}

export async function ensureScoreSyncSetting() {
  return prisma.appSetting.upsert({
    where: { key: SCORE_SYNC_ENABLED_KEY },
    update: {},
    create: {
      key: SCORE_SYNC_ENABLED_KEY,
      value: { enabled: DEFAULT_SCORE_SYNC_ENABLED } satisfies ScoreSyncSettingValue,
    },
  });
}

export async function getScoreSyncSetting() {
  const setting = await prisma.appSetting.findUnique({
    where: { key: SCORE_SYNC_ENABLED_KEY },
  });
  return {
    enabled: settingEnabled(setting?.value) ?? DEFAULT_SCORE_SYNC_ENABLED,
    updatedAt: setting?.updatedAt ?? null,
  };
}

export async function updateScoreSyncSetting(actorId: string, enabled: boolean) {
  const current = await getScoreSyncSetting();
  const setting = await prisma.$transaction(async (tx) => {
    const savedSetting = await tx.appSetting.upsert({
      where: { key: SCORE_SYNC_ENABLED_KEY },
      update: { value: { enabled } },
      create: { key: SCORE_SYNC_ENABLED_KEY, value: { enabled } },
    });

    await tx.adminAuditLog.create({
      data: {
        actorId,
        action: 'SETTING_UPDATED',
        targetId: SCORE_SYNC_ENABLED_KEY,
        details: {
          previousEnabled: current.enabled,
          enabled,
        },
      },
    });

    return savedSetting;
  });

  const payload = {
    enabled,
    previousEnabled: current.enabled,
    updatedAt: setting.updatedAt.toISOString(),
  };
  emitSse('score-sync-settings.updated', payload);
  return payload;
}
