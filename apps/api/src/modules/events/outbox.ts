import type { Prisma } from '@prisma/client';
import type { RealtimeEventEnvelope } from '@bolao/shared';
import { prisma } from '../../prisma.js';
import { logger } from '../../logger.js';
import { emitSseEnvelope } from '../../realtime/sse.js';

export interface NewOutboxEvent {
  type: string;
  seasonId: string;
  poolSeasonId: string | null;
  payload: Prisma.InputJsonValue;
  idempotencyKey?: string;
}

export async function enqueueOutboxEvent(
  tx: Prisma.TransactionClient,
  input: NewOutboxEvent,
) {
  const data = {
    type: input.type,
    seasonId: input.seasonId,
    poolSeasonId: input.poolSeasonId,
    payload: input.payload,
    version: 1,
    idempotencyKey: input.idempotencyKey,
  };
  return input.idempotencyKey
    ? tx.outboxEvent.upsert({
        where: { idempotencyKey: input.idempotencyKey },
        update: {},
        create: data,
        select: { id: true },
      })
    : tx.outboxEvent.create({ data, select: { id: true } });
}

export async function dispatchOutboxEvent(eventId: string) {
  const event = await prisma.outboxEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      type: true,
      occurredAt: true,
      seasonId: true,
      poolSeasonId: true,
      version: true,
      payload: true,
      publishedAt: true,
    },
  });
  if (!event || event.publishedAt) return;

  const envelope: RealtimeEventEnvelope = {
    eventId: event.id,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    seasonId: event.seasonId,
    poolSeasonId: event.poolSeasonId,
    version: event.version,
    payload: event.payload as Record<string, unknown>,
  };

  try {
    emitSseEnvelope(envelope);
    await prisma.outboxEvent.updateMany({
      where: { id: event.id, publishedAt: null },
      data: { publishedAt: new Date(), attempts: { increment: 1 }, lastError: null },
    });
  } catch (error) {
    const lastError = error instanceof Error ? error.message.slice(0, 500) : 'unknown error';
    try {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { attempts: { increment: 1 }, lastError },
      });
    } catch (markError) {
      logger.error({ err: markError, eventId }, 'failed to record outbox dispatch error');
    }
    logger.error(
      { err: error, eventId, seasonId: event.seasonId, poolSeasonId: event.poolSeasonId },
      'outbox event dispatch failed',
    );
  }
}

export async function dispatchPendingOutboxEvents(limit = 100) {
  const pending = await prisma.outboxEvent.findMany({
    where: { publishedAt: null },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true },
  });
  for (const event of pending) await dispatchOutboxEvent(event.id);
  return pending.length;
}
