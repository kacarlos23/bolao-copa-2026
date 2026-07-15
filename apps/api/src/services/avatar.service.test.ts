import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { reencodeAvatar } from './avatar.service.js';

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
});
