import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../http/errors.js';
import { prisma } from '../prisma.js';
import { destroySession } from '../session.js';

async function revalidateSession(req: Request) {
  const sessionUser = req.session.user;
  if (!sessionUser) {
    throw new AppError(401, 'Autenticação obrigatória.', 'UNAUTHENTICATED');
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true,
      username: true,
      nickname: true,
      avatarUrl: true,
      role: true,
      status: true,
      sessionVersion: true,
    },
  });

  if (
    !user ||
    user.status !== 'ACTIVE' ||
    user.role !== sessionUser.role ||
    user.sessionVersion !== sessionUser.sessionVersion
  ) {
    await destroySession(req);
    throw new AppError(401, 'Sessão revogada. Entre novamente.', 'SESSION_REVOKED');
  }

  req.session.user = user;
  return user;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  void revalidateSession(req).then(() => next(), next);
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  void revalidateSession(req).then((user) => {
    if (user.role !== 'ADMIN') {
      next(new AppError(403, 'Acesso restrito ao administrador.', 'FORBIDDEN'));
      return;
    }
    next();
  }, next);
}
