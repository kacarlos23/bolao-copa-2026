import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import { prisma } from '../prisma.js';
import { AppError } from '../http/errors.js';
import { logger } from '../logger.js';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_PIXELS = 16_000_000;
const AVATAR_SIZE = 512;
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const allowedFormats = new Set(['jpeg', 'png', 'webp']);

export const avatarUploadDir = path.resolve(process.cwd(), 'uploads', 'avatars');

async function ensureAvatarUploadDir() {
  await fs.mkdir(avatarUploadDir, { recursive: true });
}

function avatarPathFromUrl(avatarUrl?: string | null) {
  if (!avatarUrl?.startsWith('/uploads/avatars/')) return null;
  return path.join(avatarUploadDir, path.basename(avatarUrl));
}

async function removeAvatarFile(avatarUrl?: string | null) {
  const avatarPath = avatarPathFromUrl(avatarUrl);
  if (avatarPath) await fs.rm(avatarPath, { force: true });
}

function detectedFormat(buffer: Buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export async function reencodeAvatar(buffer: Buffer, declaredMimeType: string) {
  const format = detectedFormat(buffer);
  const expectedFormat = declaredMimeType === 'image/jpeg' ? 'jpeg' : declaredMimeType.slice(6);
  if (!format || !allowedFormats.has(format) || format !== expectedFormat) {
    throw new AppError(
      400,
      'O conteúdo do arquivo não corresponde a uma imagem JPG, PNG ou WEBP válida.',
      'INVALID_AVATAR_CONTENT',
    );
  }

  try {
    const image = sharp(buffer, { limitInputPixels: MAX_AVATAR_PIXELS, failOn: 'warning' });
    const metadata = await image.metadata();
    if (
      !metadata.format ||
      !allowedFormats.has(metadata.format) ||
      !metadata.width ||
      !metadata.height
    ) {
      throw new Error('unsupported image');
    }
    return await image
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'Não foi possível validar a imagem enviada.', 'INVALID_AVATAR_CONTENT');
  }
}

export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AVATAR_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
    headerPairs: 20,
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(
        new AppError(400, 'Envie uma imagem JPG, PNG ou WEBP de até 2 MB.', 'INVALID_AVATAR_FILE'),
      );
      return;
    }
    callback(null, true);
  },
});

export async function updateUserAvatar(userId: string, file?: Express.Multer.File) {
  if (!file) {
    throw new AppError(400, 'Arquivo de avatar obrigatório.', 'AVATAR_FILE_REQUIRED');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });
  if (!user) throw new AppError(404, 'Usuário não encontrado.', 'USER_NOT_FOUND');

  const content = await reencodeAvatar(file.buffer, file.mimetype);
  await ensureAvatarUploadDir();
  const filename = `${userId}-${crypto.randomUUID()}.webp`;
  const finalPath = path.join(avatarUploadDir, filename);
  const temporaryPath = path.join(avatarUploadDir, `.${filename}.tmp`);
  const avatarUrl = `/uploads/avatars/${filename}`;

  try {
    await fs.writeFile(temporaryPath, content, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporaryPath, finalPath);
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: {
        id: true,
        username: true,
        nickname: true,
        avatarUrl: true,
        role: true,
        status: true,
      },
    });
    await removeAvatarFile(user.avatarUrl).catch((error) => {
      logger.warn(
        { error, userId },
        'Previous avatar could not be removed; orphan cleanup will retry',
      );
    });
    return updated;
  } catch (error) {
    await Promise.allSettled([
      fs.rm(temporaryPath, { force: true }),
      fs.rm(finalPath, { force: true }),
    ]);
    throw error;
  }
}

export async function resetUserAvatar(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });

  if (!user) throw new AppError(404, 'Usuário não encontrado.', 'USER_NOT_FOUND');

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: null },
    select: { id: true, username: true, nickname: true, avatarUrl: true, role: true, status: true },
  });
  await removeAvatarFile(user.avatarUrl).catch((error) => {
    logger.warn({ error, userId }, 'Avatar could not be removed; orphan cleanup will retry');
  });
  return updated;
}

export async function removeOrphanAvatarFiles(now = Date.now()) {
  await ensureAvatarUploadDir();
  const [entries, users] = await Promise.all([
    fs.readdir(avatarUploadDir, { withFileTypes: true }),
    prisma.user.findMany({ where: { avatarUrl: { not: null } }, select: { avatarUrl: true } }),
  ]);
  const referenced = new Set(
    users
      .map((user) => avatarPathFromUrl(user.avatarUrl))
      .filter((value): value is string => Boolean(value))
      .map((value) => path.basename(value)),
  );
  let removed = 0;

  for (const entry of entries) {
    if (!entry.isFile() || referenced.has(entry.name)) continue;
    const candidate = path.join(avatarUploadDir, entry.name);
    const stat = await fs.stat(candidate);
    if (now - stat.mtimeMs < ORPHAN_GRACE_MS) continue;
    await fs.rm(candidate, { force: true });
    removed += 1;
  }
  if (removed > 0) logger.info({ removed }, 'Orphan avatar files removed');
  return removed;
}
