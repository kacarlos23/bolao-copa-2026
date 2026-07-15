import { ZodError } from 'zod';
import type { ErrorRequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { isAppError } from '../http/errors.js';
import { logger } from '../logger.js';

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = String(res.locals.requestId ?? req.id ?? 'unavailable');
  if (isAppError(error)) {
    logger.warn(
      {
        requestId,
        statusCode: error.statusCode,
        code: error.code,
        seasonId: res.locals.seasonId,
        poolSeasonId: res.locals.poolSeasonId,
        poolSlug: res.locals.poolSlug,
      },
      'application request rejected',
    );
    res.status(error.statusCode).json({
      error: {
        status: error.statusCode,
        code: error.code,
        message: error.message,
        issues: error.issues,
        requestId,
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
    logger.warn(
      {
        requestId,
        code: 'VALIDATION_ERROR',
        seasonId: res.locals.seasonId,
        poolSeasonId: res.locals.poolSeasonId,
        poolSlug: res.locals.poolSlug,
        issues,
      },
      'request validation failed',
    );
    res.status(400).json({
      error: {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: issues[0]?.message ?? 'Dados inválidos.',
        issues,
        requestId,
      },
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'Envie uma imagem de até 2 MB.'
        : 'Upload de avatar inválido.';
    res.status(400).json({
      error: { status: 400, code: error.code, message, issues: [], requestId },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res.status(409).json({
      error: {
        status: 409,
        code: 'CONFLICT',
        message: 'Registro duplicado.',
        issues: [],
        requestId,
      },
    });
    return;
  }

  logger.error({ err: error, requestId }, 'request failed');
  res.status(500).json({
    error: {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Erro interno.',
      issues: [],
      requestId,
    },
  });
};
