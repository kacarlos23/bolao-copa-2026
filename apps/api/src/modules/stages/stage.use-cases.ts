import { stageDtoSchema } from '@bolao/shared';
import { getSeason } from '../seasons/season.use-cases.js';
import { listSeasonStageRecords } from './stage.repository.js';

export async function listSeasonStages(seasonId: string) {
  await getSeason(seasonId);
  const stages = await listSeasonStageRecords(seasonId);
  return stages.map((stage) => stageDtoSchema.parse(stage));
}
