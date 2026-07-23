import type { CompetitionCapabilities } from '@bolao/shared';
import type { Capability } from '../app/CompetitionContext';
import type { CompetitionSection } from './routes';

export const baseCompetitionSections: readonly CompetitionSection[] = [
  'overview',
  'games',
  'predictions',
];

export function competitionSectionsForCapabilities(
  capabilities: ReadonlySet<Capability>,
  config: CompetitionCapabilities,
) {
  const sections: CompetitionSection[] = [...baseCompetitionSections];
  if (config.standings === true) sections.push('standings');
  if (capabilities.has('KNOCKOUT')) sections.push('bracket');
  sections.push('ranking', 'teams');
  return sections;
}

export function competitionSectionEnabled(
  section: CompetitionSection,
  capabilities: ReadonlySet<Capability>,
  config: CompetitionCapabilities,
) {
  const parent = section.startsWith('team-') ? 'teams' : section;
  return competitionSectionsForCapabilities(capabilities, config).includes(
    parent as CompetitionSection,
  );
}

export function enabledRankingScopes(config: CompetitionCapabilities) {
  const declared = config.rankingScopes ?? ['OVERALL'];
  return new Set(declared);
}
