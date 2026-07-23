import { z } from 'zod';
import type { SeasonProviderRuntimeConfig } from './season-runtime-config.js';

const cadenceSeconds = z.number().int().min(5).max(86_400);

export const providerPhaseCadenceSchema = z
  .object({
    stageId: z.string().trim().min(1).max(200).optional(),
    roundId: z.string().trim().min(1).max(200).optional(),
    liveSeconds: cadenceSeconds.optional(),
    scheduledSeconds: cadenceSeconds.optional(),
    idleSeconds: cadenceSeconds.optional(),
    nearWindowMinutes: z.number().int().min(5).max(10_080).optional(),
  })
  .strict()
  .refine((value) => value.stageId || value.roundId, {
    message: 'A cadência de fase exige stageId ou roundId.',
  });

export const providerOperationalCadenceSchema = z
  .object({
    liveSeconds: cadenceSeconds.default(15),
    scheduledSeconds: cadenceSeconds.default(60),
    idleSeconds: cadenceSeconds.default(900),
    nearWindowMinutes: z.number().int().min(5).max(10_080).default(180),
    phases: z.array(providerPhaseCadenceSchema).max(100).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.liveSeconds > value.idleSeconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['liveSeconds'],
        message: 'liveSeconds não pode ser maior que idleSeconds.',
      });
    }
    if (value.scheduledSeconds > value.idleSeconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduledSeconds'],
        message: 'scheduledSeconds não pode ser maior que idleSeconds.',
      });
    }
    value.phases.forEach((phase, index) => {
      const idle = phase.idleSeconds ?? value.idleSeconds;
      if ((phase.liveSeconds ?? value.liveSeconds) > idle) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['phases', index, 'liveSeconds'],
          message: 'A cadência LIVE da fase não pode ser mais lenta que IDLE.',
        });
      }
      if ((phase.scheduledSeconds ?? value.scheduledSeconds) > idle) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['phases', index, 'scheduledSeconds'],
          message: 'A cadência SCHEDULED da fase não pode ser mais lenta que IDLE.',
        });
      }
    });
  });

export type ProviderOperationalCadence = z.infer<typeof providerOperationalCadenceSchema>;

export type SeasonMatchSignal = {
  status: 'LIVE' | 'SCHEDULED';
  startsAt: Date;
  stageId: string | null;
  roundId: string | null;
};

export type ProviderCadencePlan = {
  cadenceSeconds: number;
  mode: 'LIVE' | 'SCHEDULED_NEAR' | 'IDLE';
  stageId: string | null;
  roundId: string | null;
  nearWindowMinutes: number;
};

export function configuredOperationalCadence(provider: SeasonProviderRuntimeConfig) {
  const raw = provider.settings.operationalCadence;
  const parsed = providerOperationalCadenceSchema.safeParse(raw);
  const fallback = providerOperationalCadenceSchema.parse({
    liveSeconds: Math.min(provider.cadenceSeconds, 15),
    scheduledSeconds: Math.min(provider.cadenceSeconds, 60),
    idleSeconds: Math.max(provider.cadenceSeconds, 900),
  });
  return parsed.success ? parsed.data : fallback;
}

export function resolveProviderCadence(
  provider: SeasonProviderRuntimeConfig,
  signal: SeasonMatchSignal | null,
  now = new Date(),
): ProviderCadencePlan {
  const configured = configuredOperationalCadence(provider);
  const phase =
    signal &&
    configured.phases.find(
      (candidate) =>
        (!candidate.stageId || candidate.stageId === signal.stageId) &&
        (!candidate.roundId || candidate.roundId === signal.roundId),
    );
  const nearWindowMinutes = phase?.nearWindowMinutes ?? configured.nearWindowMinutes;
  const scheduledNear =
    signal?.status === 'SCHEDULED' &&
    signal.startsAt.getTime() >= now.getTime() &&
    signal.startsAt.getTime() - now.getTime() <= nearWindowMinutes * 60_000;
  const mode =
    signal?.status === 'LIVE' ? 'LIVE' : scheduledNear ? 'SCHEDULED_NEAR' : 'IDLE';
  const cadence =
    mode === 'LIVE'
      ? (phase?.liveSeconds ?? configured.liveSeconds)
      : mode === 'SCHEDULED_NEAR'
        ? (phase?.scheduledSeconds ?? configured.scheduledSeconds)
        : (phase?.idleSeconds ?? configured.idleSeconds);
  return {
    cadenceSeconds: cadence,
    mode,
    stageId: signal?.stageId ?? null,
    roundId: signal?.roundId ?? null,
    nearWindowMinutes,
  };
}
