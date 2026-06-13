import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { prisma } from '../prisma.js';
import { AppError } from '../http/errors.js';

const allowedMimeTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

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
  if (!avatarPath) return;
  await fs.rm(avatarPath, { force: true });
}

export const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, callback) => {
      try {
        await ensureAvatarUploadDir();
        callback(null, avatarUploadDir);
      } catch (error) {
        callback(error as Error, avatarUploadDir);
      }
    },
    filename: (req, file, callback) => {
      const extension = allowedMimeTypes.get(file.mimetype) ?? path.extname(file.originalname).toLowerCase();
      callback(null, `${req.session.user?.id ?? 'user'}-${Date.now()}-${crypto.randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new AppError(400, 'Envie uma imagem JPG, PNG ou WEBP de ate 2 MB.', 'INVALID_AVATAR_FILE'));
      return;
    }

    callback(null, true);
  },
});

export async function updateUserAvatar(userId: string, file?: Express.Multer.File) {
  if (!file) {
    throw new AppError(400, 'Arquivo de avatar obrigatorio.', 'AVATAR_FILE_REQUIRED');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });

  if (!user) throw new AppError(404, 'Usuario nao encontrado.', 'USER_NOT_FOUND');

  const avatarUrl = `/uploads/avatars/${file.filename}`;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl },
    select: { id: true, username: true, nickname: true, avatarUrl: true, role: true, status: true },
  });

  await removeAvatarFile(user.avatarUrl);
  return updated;
}

export async function resetUserAvatar(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });

  if (!user) throw new AppError(404, 'Usuario nao encontrado.', 'USER_NOT_FOUND');

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: null },
    select: { id: true, username: true, nickname: true, avatarUrl: true, role: true, status: true },
  });

  await removeAvatarFile(user.avatarUrl);
  return updated;
}
