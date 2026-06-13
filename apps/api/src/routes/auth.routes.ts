import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema, registerSchema } from '@bolao/shared';
import { asyncHandler } from '../http/async-handler.js';
import { getPublicUser, loginUser, registerUser } from '../services/auth.service.js';
import { requireAuth } from '../middleware/auth.js';
import { avatarUpload, resetUserAvatar, updateUserAvatar } from '../services/avatar.service.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

authRouter.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const user = await registerUser(input);
    req.session.user = user;
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await loginUser(input);
    req.session.regenerate((error) => {
      if (error) throw error;
      req.session.user = user;
      res.json({ user });
    });
  }),
);

authRouter.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('bolao.sid');
    res.status(204).send();
  });
});

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getPublicUser(req.session.user!.id);
    req.session.user = user;
    res.json({ user });
  }),
);

authRouter.post(
  '/me/avatar',
  requireAuth,
  avatarUpload.single('avatar'),
  asyncHandler(async (req, res) => {
    const user = await updateUserAvatar(req.session.user!.id, req.file);
    req.session.user = user;
    res.json({ user });
  }),
);

authRouter.delete(
  '/me/avatar',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await resetUserAvatar(req.session.user!.id);
    req.session.user = user;
    res.json({ user });
  }),
);
