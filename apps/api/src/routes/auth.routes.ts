import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema, registerSchema } from '@bolao/shared';
import { asyncHandler } from '../http/async-handler.js';
import { getPublicUser, loginUser, publicUser, registerUser } from '../services/auth.service.js';
import { requireAuth } from '../middleware/auth.js';
import { avatarUpload, resetUserAvatar, updateUserAvatar } from '../services/avatar.service.js';
import { createCsrfToken, destroySession, ensureCsrfToken, regenerateSession } from '../session.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

authRouter.get('/csrf', (req, res) => {
  res.json({ csrfToken: ensureCsrfToken(req) });
});

authRouter.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const user = await registerUser(input);
    await regenerateSession(req);
    req.session.user = user;
    req.session.csrfToken = createCsrfToken();
    res.status(201).json({ user: publicUser(user) });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await loginUser(input);
    await regenerateSession(req);
    req.session.user = user;
    req.session.csrfToken = createCsrfToken();
    res.json({ user: publicUser(user) });
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await destroySession(req);
    res.clearCookie('bolao.sid');
    res.status(204).send();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getPublicUser(req.session.user!.id);
    req.session.user = user;
    res.json({ user: publicUser(user) });
  }),
);

authRouter.post(
  '/me/avatar',
  requireAuth,
  avatarUpload.single('avatar'),
  asyncHandler(async (req, res) => {
    const user = await updateUserAvatar(req.session.user!.id, req.file);
    req.session.user = { ...req.session.user!, ...user };
    res.json({ user });
  }),
);

authRouter.delete(
  '/me/avatar',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await resetUserAvatar(req.session.user!.id);
    req.session.user = { ...req.session.user!, ...user };
    res.json({ user });
  }),
);
