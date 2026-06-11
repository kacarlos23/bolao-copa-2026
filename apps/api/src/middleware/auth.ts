import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../http/errors.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.user) {
    throw new AppError(401, 'Autenticacao obrigatoria.', 'UNAUTHENTICATED');
  }
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.user) {
    throw new AppError(401, 'Autenticacao obrigatoria.', 'UNAUTHENTICATED');
  }
  if (req.session.user.role !== 'ADMIN') {
    throw new AppError(403, 'Acesso restrito ao administrador.', 'FORBIDDEN');
  }
  next();
}
