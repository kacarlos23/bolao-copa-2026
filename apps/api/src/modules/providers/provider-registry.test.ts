import { describe, expect, it, vi } from 'vitest';
import { ProviderRegistry } from './provider-registry.js';

const config = {
  key: 'fixture-provider',
  priority: 1,
  types: ['RESULTS'] as const,
  enabled: true,
  timeoutMs: 5_000,
  includeProfiles: false,
};

describe('ProviderRegistry', () => {
  it('cria adapters exclusivamente pela chave configurada', () => {
    const factory = vi.fn(() => ({
      provider: { name: 'fixture-provider', source: 'fixture://source' } as never,
    }));
    const registry = new ProviderRegistry().register('fixture-provider', factory);

    expect(registry.create(config as never).provider.name).toBe('fixture-provider');
    expect(factory).toHaveBeenCalledWith(config);
    expect(registry.keys()).toEqual(['fixture-provider']);
  });

  it('rejeita chave ausente e adapter com identidade divergente', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.create(config as never)).toThrow();
    registry.register('fixture-provider', () => ({
      provider: { name: 'outro-provider', source: 'fixture://source' } as never,
    }));
    expect(() => registry.create(config as never)).toThrow(/does not match adapter/);
  });
});
