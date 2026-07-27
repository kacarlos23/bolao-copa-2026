import sharp from 'sharp';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { avatarUpload, MAX_AVATAR_BYTES, reencodeAvatar } from './avatar.service.js';

describe('avatar content validation', () => {
  it('rejects content disguised only by its declared MIME type', async () => {
    await expect(
      reencodeAvatar(Buffer.from('<script>alert(1)</script>'), 'image/png'),
    ).rejects.toMatchObject({
      code: 'INVALID_AVATAR_CONTENT',
      statusCode: 400,
    });
  });

  it('decodes and reencodes a real image to bounded WEBP content', async () => {
    const png = await sharp({
      create: { width: 20, height: 10, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer();

    const result = await reencodeAvatar(png, 'image/png');
    const metadata = await sharp(result).metadata();

    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(20);
    expect(metadata.height).toBe(10);
  });

  it('accepts one avatar multipart part up to 8 MB', async () => {
    const app = express();
    app.post('/avatar', avatarUpload.single('avatar'), (_req, res) => res.sendStatus(204));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(400).json({ code: (error as { code?: string }).code });
    });

    const response = await request(app)
      .post('/avatar')
      .attach('avatar', Buffer.alloc(MAX_AVATAR_BYTES - 1), {
        filename: 'avatar.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(204);
  });
});
