import { stageDtoSchema } from '@bolao/shared';
import { AppError } from '../../http/errors.js';
import { getSeason } from '../seasons/season.use-cases.js';
import { findStageInSeason, listSeasonStageRecords } from './stage.repository.js';

export async function assertStageInSeason(stageId: string, seasonId: string) {
  const stage = await findStageInSeason(stageId, seasonId);
  if (!stage) {
    throw new AppError(400, 'Etapa não pertence à temporada.', 'STAGE_SEASON_MISMATCH');
  }
}

export async function listSeasonStages(seasonId: string) {
  await getSeason(seasonId);
  const stages = await listSeasonStageRecords(seasonId);
  return stages.map((stage) => stageDtoSchema.parse(stage));
}
