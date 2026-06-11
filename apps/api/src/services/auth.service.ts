import argon2 from 'argon2';
import type { LoginInput, RegisterInput } from '@bolao/shared';
import { prisma } from '../prisma.js';
import { AppError } from '../http/errors.js';

export async function registerUser(input: RegisterInput) {
  const username = input.username.trim();
  const usernameLower = username.toLowerCase();
  const nickname = input.nickname.trim();
  const [existingUsername, existingNickname] = await Promise.all([
    prisma.user.findUnique({ where: { usernameLower } }),
    prisma.user.findFirst({ where: { nickname: { equals: nickname, mode: 'insensitive' } } }),
  ]);

  if (existingUsername) {
    throw new AppError(409, 'Nome real ja esta em uso.', 'USERNAME_TAKEN');
  }

  if (existingNickname) {
    throw new AppError(409, 'Nickname ja esta em uso.', 'NICKNAME_TAKEN');
  }

  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

  return prisma.user.create({
    data: {
      username,
      usernameLower,
      nickname,
      passwordHash,
    },
    select: { id: true, username: true, nickname: true, role: true, status: true },
  });
}

export async function loginUser(input: LoginInput) {
  const nickname = input.username.trim();
  const user = await prisma.user.findFirst({
    where: { nickname: { equals: nickname, mode: 'insensitive' } },
  });

  if (!user || user.status !== 'ACTIVE') {
    throw new AppError(401, 'Credenciais invalidas.', 'INVALID_CREDENTIALS');
  }

  const valid = await argon2.verify(user.passwordHash, input.password);
  if (!valid) {
    throw new AppError(401, 'Credenciais invalidas.', 'INVALID_CREDENTIALS');
  }

  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
  };
}
