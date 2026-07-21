import {
  preferredCompetitionRouteSlug,
  resolveCompetitionRouteSlug,
} from './legacy-route-aliases';

export type GlobalScreen = 'home' | 'competitions' | 'admin' | 'not-found';

export type CompetitionSection =
  | 'overview'
  | 'games'
  | 'predictions'
  | 'standings'
  | 'bracket'
  | 'ranking'
  | 'teams'
  | 'team-athletes'
  | 'team-matches'
  | 'team-statistics';

export type CompetitionScreen =
  | 'competition-overview'
  | 'competition-games'
  | 'competition-predictions'
  | 'competition-standings'
  | 'competition-bracket'
  | 'competition-ranking'
  | 'competition-teams'
  | 'competition-team-athletes'
  | 'competition-team-matches'
  | 'competition-team-statistics';

/** Screens retained only for the non-routed legacy shell. */
export type LegacyScreen =
  | 'days'
  | 'predictions'
  | 'knockout'
  | 'ranking'
  | 'cup'
  | 'brasileirao'
  | 'teams';

export type AppScreen = GlobalScreen | CompetitionScreen | LegacyScreen;
export type PrimaryDestination = 'home' | 'competitions' | 'predictions' | 'ranking';
export type LeagueTeamSection = 'athletes' | 'matches' | 'statistics';

export interface ParsedAppRoute {
  screen: AppScreen;
  competitionSlug: string | null;
  section: CompetitionSection | null;
  teamId: string | null;
}

const sectionBySegment: Record<string, CompetitionSection> = {
  jogos: 'games',
  palpites: 'predictions',
  classificacao: 'standings',
  chave: 'bracket',
  eliminatorias: 'bracket',
  ranking: 'ranking',
  times: 'teams',
};

const segmentBySection: Record<CompetitionSection, string> = {
  overview: '',
  games: 'jogos',
  predictions: 'palpites',
  standings: 'classificacao',
  bracket: 'chave',
  ranking: 'ranking',
  teams: 'times',
  'team-athletes': 'atletas',
  'team-matches': 'partidas',
  'team-statistics': 'estatisticas',
};

const screenBySection: Record<CompetitionSection, CompetitionScreen> = {
  overview: 'competition-overview',
  games: 'competition-games',
  predictions: 'competition-predictions',
  standings: 'competition-standings',
  bracket: 'competition-bracket',
  ranking: 'competition-ranking',
  teams: 'competition-teams',
  'team-athletes': 'competition-team-athletes',
  'team-matches': 'competition-team-matches',
  'team-statistics': 'competition-team-statistics',
};

const sectionByScreen = new Map<CompetitionScreen, CompetitionSection>(
  Object.entries(screenBySection).map(([section, screen]) => [
    screen,
    section as CompetitionSection,
  ]),
);

const globalRouteByScreen: Record<Exclude<GlobalScreen, 'not-found'>, string> = {
  home: '/',
  competitions: '/competicoes',
  admin: '/admin',
};

const legacyTargetByScreen: Record<LegacyScreen, { slug: string; section: CompetitionSection }> = {
  days: { slug: 'world-cup', section: 'games' },
  predictions: { slug: 'world-cup', section: 'predictions' },
  knockout: { slug: 'world-cup', section: 'bracket' },
  ranking: { slug: 'world-cup', section: 'ranking' },
  cup: { slug: 'world-cup', section: 'overview' },
  teams: { slug: 'world-cup', section: 'teams' },
  brasileirao: { slug: 'brasileirao-serie-a', section: 'overview' },
};

function normalizePath(pathname: string) {
  const clean = pathname.split('?')[0]?.split('#')[0] || '/';
  if (clean === '/') return clean;
  return clean.replace(/\/+$/, '') || '/';
}

function safeDecode(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length >= 1 && decoded.length <= 128 ? decoded : null;
  } catch {
    return null;
  }
}

export function screenForCompetitionSection(section: CompetitionSection) {
  return screenBySection[section];
}

export function competitionSectionForScreen(screen: AppScreen) {
  return sectionByScreen.get(screen as CompetitionScreen) ?? null;
}

export function isCompetitionScreen(screen: AppScreen): screen is CompetitionScreen {
  return sectionByScreen.has(screen as CompetitionScreen);
}

export function routeFromPath(pathname: string): ParsedAppRoute {
  const normalized = normalizePath(pathname);
  const global = Object.entries(globalRouteByScreen).find(([, path]) => path === normalized);
  if (global) {
    return {
      screen: global[0] as AppScreen,
      competitionSlug: null,
      section: null,
      teamId: null,
    };
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts[0] !== 'competicoes' || !parts[1] || parts.length > 5) {
    return { screen: 'not-found', competitionSlug: null, section: null, teamId: null };
  }
  const routeSlug = parts[1];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(routeSlug)) {
    return { screen: 'not-found', competitionSlug: null, section: null, teamId: null };
  }
  const competitionSlug = resolveCompetitionRouteSlug(routeSlug);
  if (parts.length === 2) {
    return {
      screen: screenBySection.overview,
      competitionSlug,
      section: 'overview',
      teamId: null,
    };
  }

  const section = sectionBySegment[parts[2] ?? ''];
  if (!section) {
    return { screen: 'not-found', competitionSlug: null, section: null, teamId: null };
  }
  if (section !== 'teams') {
    if (parts.length !== 3) {
      return { screen: 'not-found', competitionSlug: null, section: null, teamId: null };
    }
    return { screen: screenBySection[section], competitionSlug, section, teamId: null };
  }
  if (parts.length === 3) {
    return { screen: screenBySection.teams, competitionSlug, section: 'teams', teamId: null };
  }

  const teamId = safeDecode(parts[3] ?? '');
  const teamSection =
    parts[4] === 'partidas'
      ? 'team-matches'
      : parts[4] === 'estatisticas'
        ? 'team-statistics'
        : parts[4] == null || parts[4] === 'atletas'
          ? 'team-athletes'
          : null;
  if (!teamId || !teamSection) {
    return { screen: 'not-found', competitionSlug: null, section: null, teamId: null };
  }
  return { screen: screenBySection[teamSection], competitionSlug, section: teamSection, teamId };
}

export function screenFromPath(pathname: string) {
  return routeFromPath(pathname).screen;
}

export function competitionSlugFromPath(pathname: string) {
  return routeFromPath(pathname).competitionSlug;
}

export function teamIdFromPath(pathname: string) {
  return routeFromPath(pathname).teamId;
}

export function pathForCompetition(
  competitionSlug: string,
  section: CompetitionSection = 'overview',
) {
  const base = `/competicoes/${encodeURIComponent(preferredCompetitionRouteSlug(competitionSlug))}`;
  const segment = segmentBySection[section];
  return segment ? `${base}/${segment}` : base;
}

export function pathForLeagueTeam(
  competitionSlug: string,
  teamId: string,
  section: LeagueTeamSection = 'athletes',
) {
  const teamSection =
    section === 'matches'
      ? 'team-matches'
      : section === 'statistics'
        ? 'team-statistics'
        : 'team-athletes';
  return `${pathForCompetition(competitionSlug, 'teams')}/${encodeURIComponent(teamId)}/${segmentBySection[teamSection]}`;
}

export function pathForScreen(
  screen: AppScreen,
  target?: { competitionSlug?: string | null; teamId?: string | null },
) {
  if (screen === 'not-found') return '/nao-encontrado';
  if (screen in globalRouteByScreen) {
    return globalRouteByScreen[screen as Exclude<GlobalScreen, 'not-found'>];
  }
  const legacyTarget = legacyTargetByScreen[screen as LegacyScreen];
  if (legacyTarget) return pathForCompetition(legacyTarget.slug, legacyTarget.section);
  const section = competitionSectionForScreen(screen);
  const competitionSlug = target?.competitionSlug;
  if (!section || !competitionSlug) return '/competicoes';
  if (section.startsWith('team-') && target?.teamId) {
    const teamSection: LeagueTeamSection =
      section === 'team-matches'
        ? 'matches'
        : section === 'team-statistics'
          ? 'statistics'
          : 'athletes';
    return pathForLeagueTeam(competitionSlug, target.teamId, teamSection);
  }
  return pathForCompetition(competitionSlug, section);
}

export function pageTitle(screen: AppScreen, competitionName?: string | null) {
  const staticLabels: Partial<Record<AppScreen, string>> = {
    home: 'Início',
    competitions: 'Competições',
    admin: 'Administração',
    'not-found': 'Página não encontrada',
  };
  const section = competitionSectionForScreen(screen);
  const sectionLabels: Record<CompetitionSection, string> = {
    overview: competitionName ?? 'Competição',
    games: `Jogos${competitionName ? ` de ${competitionName}` : ''}`,
    predictions: `Palpites${competitionName ? ` de ${competitionName}` : ''}`,
    standings: `Classificação${competitionName ? ` de ${competitionName}` : ''}`,
    bracket: `Chave${competitionName ? ` de ${competitionName}` : ''}`,
    ranking: `Ranking${competitionName ? ` de ${competitionName}` : ''}`,
    teams: `Times${competitionName ? ` de ${competitionName}` : ''}`,
    'team-athletes': 'Atletas do time',
    'team-matches': 'Partidas do time',
    'team-statistics': 'Estatísticas do time',
  };
  const label = staticLabels[screen] ?? (section ? sectionLabels[section] : 'Bolão Sirel');
  return `${label} · Bolão Sirel`;
}

export function screenForPrimaryDestination(destination: PrimaryDestination): AppScreen {
  if (destination === 'predictions') return screenBySection.predictions;
  if (destination === 'ranking') return screenBySection.ranking;
  return destination;
}

export function activePrimaryDestination(screen: AppScreen): PrimaryDestination | null {
  if (screen === 'home') return 'home';
  if (screen === 'competitions') return 'competitions';
  const section = competitionSectionForScreen(screen);
  if (section === 'predictions') return 'predictions';
  if (section === 'ranking') return 'ranking';
  if (section) return 'competitions';
  if (screen === 'predictions') return 'predictions';
  if (screen === 'ranking') return 'ranking';
  if (legacyTargetByScreen[screen as LegacyScreen]) return 'competitions';
  return null;
}
