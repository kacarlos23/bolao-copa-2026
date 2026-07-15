import { beforeEach, describe, expect, it, vi } from 'vitest';

const transaction = vi.hoisted(() => vi.fn());
vi.mock('./prisma.js', () => ({ prisma: { $transaction: transaction } }));

import { serializableTransaction } from './prisma-transaction.js';

describe('serializableTransaction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retries PostgreSQL write conflicts and returns the committed result', async () => {
    transaction
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'P2034' }))
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'P2034' }))
      .mockResolvedValueOnce('committed');

    await expect(serializableTransaction(async () => 'unused')).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry an unrelated database error', async () => {
    const error = Object.assign(new Error('invalid input'), { code: 'P2003' });
    transaction.mockRejectedValue(error);

    await expect(serializableTransaction(async () => 'unused')).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledOnce();
  });
});
