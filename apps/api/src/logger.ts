import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-internal-events-secret"]',
      'res.headers["set-cookie"]',
    ],
    censor: '[Redacted]',
  },
});
