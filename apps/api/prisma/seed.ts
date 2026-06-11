import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_USERNAME ?? 'admin';
  const nickname = process.env.ADMIN_NICKNAME ?? 'Administrador';
  const password = process.env.ADMIN_PASSWORD;

  if (!password || password.length < 6) {
    throw new Error('ADMIN_PASSWORD deve ter pelo menos 6 caracteres.');
  }

  const usernameLower = username.toLowerCase();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  await prisma.user.upsert({
    where: { usernameLower },
    update: {
      nickname,
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
    create: {
      username,
      usernameLower,
      nickname,
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });

  console.log(`Admin inicial pronto: ${username}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
