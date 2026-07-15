import { WORLD_CUP_CONTEXT } from '../../domain/world-cup-context.js';
import { resolvePoolSeasonContext } from './pool-context.js';

export function resolveWorldCupPoolContext(userId: string) {
  return resolvePoolSeasonContext({
    poolSlug: WORLD_CUP_CONTEXT.poolSlug,
    seasonId: WORLD_CUP_CONTEXT.seasonId,
    userId,
  });
}
