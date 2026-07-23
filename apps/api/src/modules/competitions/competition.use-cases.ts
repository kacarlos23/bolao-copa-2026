import { competitionDtoSchema, type PaginationQuery } from '@bolao/shared';
import { z } from 'zod';
import { AppError } from '../../http/errors.js';
import { paginationArgs, paginationMeta } from '../shared/pagination.js';
import { listSeasons } from '../seasons/season.use-cases.js';
import { publicCompetitionCapabilities } from './competition-capabilities.js';
import { findCompetitionBySlug, listCompetitionRecords } from './competition.repository.js';

function toCompetitionDto(
  competition: NonNullable<Awaited<ReturnType<typeof findCompetitionBySlug>>>,
) {
  const metadata = z
    .object({
      presentation: z
        .object({
          label: z.string().trim().min(1).max(80).optional(),
          theme: z
            .object({
              accent: z.string().trim().min(3).max(32).optional(),
              accentInk: z.string().trim().min(3).max(32).optional(),
              surface: z.string().trim().min(3).max(32).optional(),
              glow: z.string().trim().min(3).max(48).optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
    })
    .passthrough()
    .safeParse(competition.metadata);
  return competitionDtoSchema.parse({
    id: competition.id,
    slug: competition.slug,
    name: competition.name,
    capabilities: publicCompetitionCapabilities(competition.capabilities, competition.metadata),
    presentation: metadata.success ? (metadata.data.presentation ?? null) : null,
  });
}

export async function listCompetitions(query: PaginationQuery) {
  const [competitions, total] = await listCompetitionRecords(paginationArgs(query));
  return {
    competitions: competitions.map(toCompetitionDto),
    pagination: paginationMeta(query, total),
  };
}

export async function listSeasonsByCompetitionSlug(slug: string, query: PaginationQuery) {
  const competition = await findCompetitionBySlug(slug);
  if (!competition) {
    throw new AppError(404, 'Competição não encontrada.', 'COMPETITION_NOT_FOUND');
  }
  return {
    competition: toCompetitionDto(competition),
    ...(await listSeasons(competition.id, query)),
  };
}
