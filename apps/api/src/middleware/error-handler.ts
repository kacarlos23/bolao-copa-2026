import { ZodError } from 'zod';
import type { ErrorRequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { isAppError } from '../http/errors.js';
import { logger } from '../logger.js';

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (isAppError(error)) {
    res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    return;
  }

  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => issue.message);
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: issues[0] ?? 'Dados invalidos.',
        issues: error.flatten(),
      },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'Registro duplicado.' } });
    return;
  }

  logger.error(error);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno.' } });
};
