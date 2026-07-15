import { MatchStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';
import { dispatchOutboxEvent, enqueueOutboxEvent } from '../events/outbox.js';

export const manualMatchOverrideSchema = z
  .object({
    justification: z.string().trim().min(10).max(500),
    values: z
      .object({
        startsAt: z.string().datetime({ offset: true }).optional(),
        status: z.enum(['SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED']).optional(),
        homeScore: z.number().int().min(0).max(99).nullable().optional(),
        awayScore: z.number().int().min(0).max(99).nullable().optional(),
        finalHomeScore: z.number().int().min(0).max(99).nullable().optional(),
        finalAwayScore: z.number().int().min(0).max(99).nullable().optional(),
      })
      .strict()
      .refine(
        (values) => Object.keys(values).length > 0,
        'At least one override value is required.',
      ),
  })
  .strict();

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function setManualMatchOverride(
  seasonId: string,
  matchId: string,
  actorId: string,
  rawInput: unknown,
) {
  const input = manualMatchOverrideSchema.parse(rawInput);
  const match = await prisma.match.findFirst({ where: { id: matchId, seasonId } });
  if (!match) throw new AppError(404, 'Match not found in the selected season.', 'MATCH_NOT_FOUND');
  const before = {
    startsAt: match.startsAt.toISOString(),
    status: match.status,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    finalHomeScore: match.finalHomeScore,
    finalAwayScore: match.finalAwayScore,
  };
  const startsAt = input.values.startsAt ? new Date(input.values.startsAt) : undefined;
  const eventId = await prisma.$transaction(async (tx) => {
    const saved = await tx.match.update({
      where: { id: match.id },
      data: {
        ...(startsAt ? { startsAt } : {}),
        ...(input.values.status ? { status: input.values.status as MatchStatus } : {}),
        ...(input.values.homeScore !== undefined ? { homeScore: input.values.homeScore } : {}),
        ...(input.values.awayScore !== undefined ? { awayScore: input.values.awayScore } : {}),
        ...(input.values.finalHomeScore !== undefined
          ? { finalHomeScore: input.values.finalHomeScore }
          : {}),
        ...(input.values.finalAwayScore !== undefined
          ? { finalAwayScore: input.values.finalAwayScore }
          : {}),
      },
    });
    await tx.matchOverride.upsert({
      where: { matchId: match.id },
      create: {
        matchId: match.id,
        actorId,
        justification: input.justification,
        values: json(input.values),
        before: json(before),
      },
      update: {
        actorId,
        justification: input.justification,
        values: json(input.values),
        before: json(before),
        active: true,
        removedAt: null,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        actorId,
        action: 'MATCH_OVERRIDE_SET',
        targetId: match.id,
        details: json({ justification: input.justification, before, after: input.values }),
      },
    });
    const event = await enqueueOutboxEvent(tx, {
      type: 'match.override.updated',
      seasonId,
      poolSeasonId: null,
      payload: { matchId: match.id, active: true },
    });
    return { eventId: event.id, saved };
  });
  await dispatchOutboxEvent(eventId.eventId);
  return eventId.saved;
}

export async function removeManualMatchOverride(
  seasonId: string,
  matchId: string,
  actorId: string,
  justification: string,
) {
  const reason = z.string().trim().min(10).max(500).parse(justification);
  const existing = await prisma.matchOverride.findFirst({
    where: { matchId, match: { seasonId }, active: true },
  });
  if (!existing)
    throw new AppError(404, 'Active match override not found.', 'MATCH_OVERRIDE_NOT_FOUND');
  const eventId = await prisma.$transaction(async (tx) => {
    await tx.matchOverride.update({
      where: { id: existing.id },
      data: { active: false, removedAt: new Date() },
    });
    await tx.adminAuditLog.create({
      data: {
        actorId,
        action: 'MATCH_OVERRIDE_REMOVED',
        targetId: matchId,
        details: { justification: reason, overriddenValues: existing.values },
      },
    });
    return (
      await enqueueOutboxEvent(tx, {
        type: 'match.override.updated',
        seasonId,
        poolSeasonId: null,
        payload: { matchId, active: false },
      })
    ).id;
  });
  await dispatchOutboxEvent(eventId);
}
