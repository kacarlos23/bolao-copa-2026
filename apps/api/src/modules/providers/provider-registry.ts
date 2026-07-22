import { AppError } from '../../http/errors.js';
import { sharedProviderResponseCache } from '../../http/fetch-policy.js';
import { z } from 'zod';
import { refreshBrasileirao2026RoundWindows } from '../brasileirao/brasileirao-2026.service.js';
import { importCbfSerieA2026TeamProfiles } from '../teams/team-profile.importer.js';
import { CbfSerieA2026Provider } from './adapters/cbf-serie-a-2026.provider.js';
import { FifaWorldCup2026Provider } from './adapters/fifa-world-cup-2026.provider.js';
import { GeProvider } from './adapters/ge.provider.js';
import { RefreshingConmebolProvider } from './adapters/refreshing-snapshot.provider.js';
import {
  CbfCopaDoBrasilProvider,
  ConmebolProvider,
} from './adapters/snapshot-competition.provider.js';
import type { CompetitionDataProvider } from './competition-data-provider.js';
import type { SeasonProviderRuntimeConfig } from './season-runtime-config.js';
import { collectSudamericana2026Snapshot } from '../../scripts/collect-sudamericana-2026.js';
import { collectLibertadores2026Snapshot } from '../../scripts/collect-libertadores-2026.js';
import { syncFifaWorldCup2026LegacyKnockout } from './fifa-world-cup-2026-sync.service.js';

export interface ProviderRuntime {
  provider: CompetitionDataProvider;
  evidence?: () => Promise<unknown>;
  importProfiles?: (seasonId: string) => Promise<unknown[]>;
  afterSync?: (seasonId: string) => Promise<unknown>;
}

export type ProviderRuntimeFactory = (config: SeasonProviderRuntimeConfig) => ProviderRuntime;

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

const snapshotSettingsSchema = z
  .object({
    fixtureName: z.string().trim().min(1).max(160).optional(),
    competition: z.string().trim().min(1).max(120).optional(),
    collectionStrategy: z
      .enum([
        'IMMUTABLE_FIXTURE',
        'LIVE_SUDAMERICANA_2026',
        'LIVE_LIBERTADORES_2026',
        'LIVE_CBF_COPA_DO_BRASIL_2026',
      ])
      .optional(),
  })
  .passthrough()
  .superRefine((settings, context) => {
    if (settings.collectionStrategy === 'IMMUTABLE_FIXTURE' && !settings.fixtureName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fixtureName'],
        message: 'Fixture is required.',
      });
    }
  });

export const seasonProviderRegistry = new ProviderRegistry()
  .register('fifa-official', () => {
    const provider = new FifaWorldCup2026Provider();
    return {
      provider,
      evidence: () => provider.snapshotEvidence(),
      afterSync: async (seasonId) =>
        syncFifaWorldCup2026LegacyKnockout(await provider.legacyKnockoutUpdates(), seasonId),
    };
  })
  .register('ge', (providerConfig) => ({
    provider: new GeProvider({
      timeoutMs: providerConfig.timeoutMs,
      maxBytes: 5 * 1024 * 1024,
      retries: 2,
      cache: sharedProviderResponseCache,
      cacheTtlMs: 30_000,
    }),
  }))
  .register('cbf-official', (providerConfig) => {
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
  })
  .register('conmebol-official', (providerConfig) => {
    const settings = snapshotSettingsSchema.parse(providerConfig.settings);
    if (!settings.competition) throw new Error('CONMEBOL provider requires competition setting.');
    if (
      settings.collectionStrategy === 'LIVE_SUDAMERICANA_2026' ||
      settings.collectionStrategy === 'LIVE_LIBERTADORES_2026'
    ) {
      const provider = new RefreshingConmebolProvider({
        competition: settings.competition,
        source: providerConfig.source,
        collectSnapshot:
          settings.collectionStrategy === 'LIVE_LIBERTADORES_2026'
            ? collectLibertadores2026Snapshot
            : collectSudamericana2026Snapshot,
      });
      return {
        provider,
        evidence: () => provider.snapshotEvidence(),
      };
    }
    const provider = new ConmebolProvider({
      fixtureName: settings.fixtureName,
      competition: settings.competition,
    });
    return {
      provider,
      evidence: () => provider.snapshotEvidence(),
    };
  })
  .register('cbf-copa-do-brasil-official', (providerConfig) => {
    const settings = snapshotSettingsSchema.parse(providerConfig.settings);
    const provider =
      settings.collectionStrategy === 'LIVE_CBF_COPA_DO_BRASIL_2026'
        ? new CbfCopaDoBrasilProvider()
        : new CbfCopaDoBrasilProvider({ fixtureName: settings.fixtureName });
    return {
      provider,
      evidence: () => provider.snapshotEvidence(),
    };
  });
