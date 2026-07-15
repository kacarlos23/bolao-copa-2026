import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

export async function serializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 4,
  timeoutMs = 30_000,
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: 'Serializable',
        maxWait: 5_000,
        timeout: timeoutMs,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'P2034' || attempt >= maxAttempts) throw error;
      const delayMs = 10 * 2 ** (attempt - 1) + Math.floor(Math.random() * 10);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
