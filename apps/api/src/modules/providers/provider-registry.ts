import { AppError } from '../../http/errors.js';
import {
  refreshBrasileirao2026RoundWindows,
} from '../brasileirao/brasileirao-2026.service.js';
import { importCbfSerieA2026TeamProfiles } from '../teams/team-profile.importer.js';
import { CbfSerieA2026Provider } from './adapters/cbf-serie-a-2026.provider.js';
import type { CompetitionDataProvider } from './competition-data-provider.js';
import type { SeasonProviderRuntimeConfig } from './season-runtime-config.js';

export interface ProviderRuntime {
  provider: CompetitionDataProvider;
  evidence?: () => Promise<unknown>;
  importProfiles?: (seasonId: string) => Promise<unknown[]>;
  afterSync?: (seasonId: string) => Promise<void>;
}

export type ProviderRuntimeFactory = (
  config: SeasonProviderRuntimeConfig,
) => ProviderRuntime;

export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderRuntimeFactory>();

  register(key: string, factory: ProviderRuntimeFactory) {
    if (this.factories.has(key)) throw new Error(`Provider already registered: ${key}`);
    this.factories.set(key, factory);
    return this;
  }

  create(config: SeasonProviderRuntimeConfig) {
    const factory = this.factories.get(config.key);
    if (!factory) {
      throw new AppError(
        400,
        'Esta temporada referencia um provider nao registrado.',
        'SEASON_PROVIDER_NOT_REGISTERED',
      );
    }
    const runtime = factory(config);
    if (runtime.provider.name !== config.key) {
      throw new Error(
        `Provider registry key ${config.key} does not match adapter ${runtime.provider.name}.`,
      );
    }
    return runtime;
  }

  keys() {
    return [...this.factories.keys()].sort();
  }
}

export const seasonProviderRegistry = new ProviderRegistry().register(
  'cbf-official',
  (providerConfig) => {
    const provider = new CbfSerieA2026Provider({
      timeoutMs: providerConfig.timeoutMs,
      maxBytes: 768 * 1024,
      retries: 2,
    });
    return {
      provider,
      evidence: () => provider.evidence(),
      importProfiles: importCbfSerieA2026TeamProfiles,
      afterSync: refreshBrasileirao2026RoundWindows,
    };
  },
);
