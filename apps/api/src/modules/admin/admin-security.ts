import crypto from 'node:crypto';
import type { Request } from 'express';
import { AuditAction, Prisma } from '@prisma/client';
import { z } from 'zod';
import { config } from '../../config.js';
import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';
import { serializableTransaction } from '../../prisma-transaction.js';
import { stableHash } from '../scoring/scoring-rules.service.js';

export const justificationSchema = z.string().trim().min(10).max(500);
export const entityIdSchema = z.string().trim().min(1).max(200);
export const idempotencyKeySchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/);
export const reinforcedConfirmationSchema = z.object({
  previewId: entityIdSchema,
  confirmation: z.string().min(12).max(200),
}).strict();

type AdminRequestContext = {
  actorId: string;
  requestId: string;
  idempotencyKey: string;
  origin: string;
};

type AdminScope = {
  seasonId?: string | null;
  poolSeasonId?: string | null;
  targetType: string;
  targetId?: string | null;
};

export function adminRequestContext(req: Request): AdminRequestContext {
  const actorId = req.session.user?.id;
  if (!actorId) throw new AppError(401, 'Autenticação obrigatória.', 'UNAUTHENTICATED');
  return {
    actorId,
    requestId: String(req.res?.locals.requestId ?? 'unavailable'),
    idempotencyKey: idempotencyKeySchema.parse(req.get('idempotency-key')),
    origin: `${req.method} ${req.originalUrl.split('?')[0]}`,
  };
}

export function setAdminScope(req: Request, scope: Pick<AdminScope, 'seasonId' | 'poolSeasonId'>) {
  if (scope.seasonId) req.res!.locals.seasonId = scope.seasonId;
  if (scope.poolSeasonId) req.res!.locals.poolSeasonId = scope.poolSeasonId;
}

export async function assertSeasonPoolScope(
  database: Pick<Prisma.TransactionClient, 'competitionSeason' | 'poolSeason'>,
  seasonId?: string | null,
  poolSeasonId?: string | null,
) {
  if (!seasonId && poolSeasonId) {
    throw new AppError(400, 'seasonId é obrigatório quando poolSeasonId é informado.', 'SEASON_REQUIRED');
  }
  if (seasonId) {
    const season = await database.competitionSeason.findUnique({ where: { id: seasonId }, select: { id: true } });
    if (!season) throw new AppError(404, 'Temporada não encontrada.', 'SEASON_NOT_FOUND');
  }
  if (poolSeasonId) {
    const poolSeason = await database.poolSeason.findFirst({
      where: { id: poolSeasonId, seasonId: seasonId! },
      select: { id: true },
    });
    if (!poolSeason) {
      throw new AppError(400, 'PoolSeason não pertence à temporada.', 'POOL_SEASON_MISMATCH');
    }
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function operationHash(action: string, scope: AdminScope, input: unknown) {
  return stableHash({ action, ...scope, input });
}

function confirmationFor(operation: { id: string; requestHash: string; affectedCount: number }) {
  const proof = crypto
    .createHmac('sha256', config.SESSION_SECRET)
    .update(`${operation.id}:${operation.requestHash}:${operation.affectedCount}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  return `CONFIRMAR ${operation.affectedCount} ${proof}`;
}

function sameText(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function replayOperation(context: AdminRequestContext, action: string, requestHash: string) {
  const existing = await prisma.adminOperation.findUnique({
    where: { idempotencyKey: context.idempotencyKey },
  });
  if (!existing) return null;
  if (existing.actorId !== context.actorId || existing.action !== action || existing.requestHash !== requestHash) {
    throw new AppError(409, 'A chave de idempotência já foi usada com outra operação.', 'IDEMPOTENCY_KEY_REUSED');
  }
  return existing;
}

export async function createAdminPreview(input: {
  context: AdminRequestContext;
  action: string;
  scope: AdminScope;
  justification: string;
  request: unknown;
  preview: unknown;
  affectedCount: number;
  ttlMinutes?: number;
}) {
  await assertSeasonPoolScope(prisma, input.scope.seasonId, input.scope.poolSeasonId);
  const requestHash = operationHash(input.action, input.scope, input.request);
  const replay = await replayOperation(input.context, input.action, requestHash);
  if (replay) {
    if (!['PREVIEW', 'CONSUMED'].includes(replay.status)) {
      throw new AppError(409, 'A prévia ainda não está disponível.', 'PREVIEW_NOT_READY');
    }
    return {
      previewId: replay.id,
      affectedCount: replay.affectedCount,
      preview: replay.preview,
      expiresAt: replay.expiresAt?.toISOString() ?? null,
      confirmation: confirmationFor(replay),
      replayed: true,
      consumed: replay.status === 'CONSUMED',
    };
  }
  try {
    const created = await prisma.adminOperation.create({
      data: {
        actorId: input.context.actorId,
        action: input.action,
        targetType: input.scope.targetType,
        targetId: input.scope.targetId,
        seasonId: input.scope.seasonId,
        poolSeasonId: input.scope.poolSeasonId,
        requestId: input.context.requestId,
        idempotencyKey: input.context.idempotencyKey,
        requestHash,
        status: 'PREVIEW',
        justification: justificationSchema.parse(input.justification),
        preview: json(input.preview),
        affectedCount: input.affectedCount,
        expiresAt: new Date(Date.now() + (input.ttlMinutes ?? 15) * 60_000),
      },
    });
    const confirmation = confirmationFor(created);
    await prisma.adminOperation.update({
      where: { id: created.id },
      data: { confirmationHash: stableHash(confirmation) },
    });
    return {
      previewId: created.id,
      affectedCount: created.affectedCount,
      preview: created.preview,
      expiresAt: created.expiresAt?.toISOString() ?? null,
      confirmation,
      replayed: false,
      consumed: false,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const concurrent = await replayOperation(input.context, input.action, requestHash);
      if (concurrent) {
        return {
          previewId: concurrent.id,
          affectedCount: concurrent.affectedCount,
          preview: concurrent.preview,
          expiresAt: concurrent.expiresAt?.toISOString() ?? null,
          confirmation: confirmationFor(concurrent),
          replayed: true,
          consumed: concurrent.status === 'CONSUMED',
        };
      }
    }
    throw error;
  }
}

async function consumePreview(
  tx: Prisma.TransactionClient,
  input: {
    context: AdminRequestContext;
    action: string;
    scope: AdminScope;
    previewId: string;
    confirmation: string;
    requestHash?: string;
  },
) {
  const preview = await tx.adminOperation.findUnique({ where: { id: input.previewId } });
  if (!preview || preview.status !== 'PREVIEW') {
    throw new AppError(409, 'Prévia ausente, inválida ou já consumida.', 'PREVIEW_INVALID');
  }
  if (
    preview.actorId !== input.context.actorId ||
    preview.action !== input.action ||
    preview.seasonId !== (input.scope.seasonId ?? null) ||
    preview.poolSeasonId !== (input.scope.poolSeasonId ?? null) ||
    preview.targetType !== input.scope.targetType ||
    preview.targetId !== (input.scope.targetId ?? null)
  ) {
    throw new AppError(403, 'A prévia não autoriza este escopo.', 'PREVIEW_SCOPE_MISMATCH');
  }
  if (input.requestHash && preview.requestHash !== input.requestHash) {
    throw new AppError(409, 'O payload diverge do que foi aprovado na prévia.', 'PREVIEW_REQUEST_MISMATCH');
  }
  if (!preview.expiresAt || preview.expiresAt.getTime() <= Date.now()) {
    throw new AppError(409, 'A prévia expirou; gere uma nova.', 'PREVIEW_EXPIRED');
  }
  const expected = confirmationFor(preview);
  if (!sameText(expected, input.confirmation) || preview.confirmationHash !== stableHash(input.confirmation)) {
    throw new AppError(400, 'Confirmação reforçada inválida.', 'INVALID_REINFORCED_CONFIRMATION');
  }
  await tx.adminOperation.update({ where: { id: preview.id }, data: { status: 'CONSUMED', completedAt: new Date() } });
  return preview;
}

export async function authorizeAdminPreview(input: {
  context: AdminRequestContext;
  action: string;
  scope: AdminScope;
  confirmation: z.infer<typeof reinforcedConfirmationSchema>;
  request: unknown;
}) {
  await serializableTransaction(async (tx) => {
    await assertSeasonPoolScope(tx, input.scope.seasonId, input.scope.poolSeasonId);
    await consumePreview(tx, { ...input, ...input.confirmation, requestHash: operationHash(input.action, input.scope, input.request) });
  });
}

export type MutationResult<T> = {
  before: unknown;
  after: unknown;
  result: T;
  affectedCount: number;
  details?: unknown;
};

export async function executeSensitiveMutation<T>(input: {
  context: AdminRequestContext;
  action: AuditAction;
  operation: string;
  scope: AdminScope;
  justification: string;
  request: unknown;
  confirmation?: z.infer<typeof reinforcedConfirmationSchema>;
  mutate: (tx: Prisma.TransactionClient) => Promise<MutationResult<T>>;
}): Promise<{ result: T; affectedCount: number; replayed: boolean }> {
  const requestHash = operationHash(input.operation, input.scope, input.request);
  const replay = await replayOperation(input.context, input.operation, requestHash);
  if (replay) {
    if (replay.status === 'COMPLETED') {
      const stored = replay.result as { result: T; affectedCount: number };
      return { ...stored, replayed: true };
    }
    throw new AppError(409, 'Operação idempotente já está em andamento ou falhou.', 'OPERATION_IN_PROGRESS');
  }
  try {
    return await serializableTransaction(async (tx) => {
      await assertSeasonPoolScope(tx, input.scope.seasonId, input.scope.poolSeasonId);
      await tx.adminOperation.create({
        data: {
          actorId: input.context.actorId,
          action: input.operation,
          targetType: input.scope.targetType,
          targetId: input.scope.targetId,
          seasonId: input.scope.seasonId,
          poolSeasonId: input.scope.poolSeasonId,
          requestId: input.context.requestId,
          idempotencyKey: input.context.idempotencyKey,
          requestHash,
          status: 'RUNNING',
          justification: justificationSchema.parse(input.justification),
        },
      });
      if (input.confirmation) {
        await consumePreview(tx, {
          context: input.context,
          action: input.operation,
          scope: input.scope,
          ...input.confirmation,
          requestHash,
        });
      }
      const changed = await input.mutate(tx);
      await tx.adminAuditLog.create({
        data: {
          actorId: input.context.actorId,
          action: input.action,
          targetId: input.scope.targetId,
          requestId: input.context.requestId,
          seasonId: input.scope.seasonId,
          poolSeasonId: input.scope.poolSeasonId,
          justification: input.justification,
          idempotencyKey: `audit:${input.context.idempotencyKey}`,
          origin: input.context.origin,
          before: json(changed.before),
          after: json(changed.after),
          details: json({ affectedCount: changed.affectedCount, ...(changed.details ? { data: changed.details } : {}) }),
        },
      });
      const storedResult = { result: changed.result, affectedCount: changed.affectedCount };
      await tx.adminOperation.update({
        where: { idempotencyKey: input.context.idempotencyKey },
        data: { status: 'COMPLETED', affectedCount: changed.affectedCount, result: json(storedResult), completedAt: new Date() },
      });
      return { ...storedResult, replayed: false };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const concurrent = await replayOperation(input.context, input.operation, requestHash);
      if (concurrent?.status === 'COMPLETED') {
        const stored = concurrent.result as { result: T; affectedCount: number };
        return { ...stored, replayed: true };
      }
      if (concurrent) throw new AppError(409, 'Operação concorrente em andamento.', 'OPERATION_IN_PROGRESS');
    }
    throw error;
  }
}
