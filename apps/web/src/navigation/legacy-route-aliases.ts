/**
 * Compatibility-only URL aliases. They translate old public deep links to the
 * canonical Competition.slug and never select a screen, provider or feature.
 */
export const LEGACY_COMPETITION_ROUTE_ALIASES = {
  'copa-do-mundo-2026': 'world-cup',
  'brasileirao-serie-a-2026': 'brasileirao-serie-a',
} as const;

const preferredLegacySlug = new Map(
  Object.entries(LEGACY_COMPETITION_ROUTE_ALIASES).map(([routeSlug, competitionSlug]) => [
    competitionSlug,
    routeSlug,
  ]),
);

export function resolveCompetitionRouteSlug(routeSlug: string) {
  return (
    LEGACY_COMPETITION_ROUTE_ALIASES[
      routeSlug as keyof typeof LEGACY_COMPETITION_ROUTE_ALIASES
    ] ?? routeSlug
  );
}

export function preferredCompetitionRouteSlug(competitionSlug: string) {
  return preferredLegacySlug.get(competitionSlug) ?? competitionSlug;
}
