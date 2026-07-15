import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { addSseClient } from '../realtime/sse.js';

export const sseRouter = Router();

sseRouter.get('/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  addSseClient(res, req);
});
