import { describe, expect, it } from 'vitest';
import { registerSchema, upsertKnockoutSimulationSchema } from './schemas.js';

describe('registerSchema', () => {
  it('accepts a real name with spaces as username', () => {
    const result = registerSchema.safeParse({
      username: 'Maria Silva',
      nickname: 'maria.silva',
      password: 'Ab1@xy',
    });

    expect(result.success).toBe(true);
  });

  it('rejects passwords shorter than 6 characters', () => {
    const result = registerSchema.safeParse({
      username: 'Maria Silva',
      nickname: 'maria.silva',
      password: 'A1@xy',
    });

    expect(result.success).toBe(false);
  });
});

describe('upsertKnockoutSimulationSchema', () => {
  it('defaults missing group scores to an empty list', () => {
    expect(upsertKnockoutSimulationSchema.parse({})).toEqual({ groupScores: [] });
  });
});
