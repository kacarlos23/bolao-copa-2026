export type AppScreen =
  | 'home'
  | 'competitions'
  | 'days'
  | 'predictions'
  | 'knockout'
  | 'ranking'
  | 'cup'
  | 'brasileirao'
  | 'brasileirao-predictions'
  | 'brasileirao-standings'
  | 'brasileirao-ranking'
  | 'teams'
  | 'admin'
  | 'not-found';

export type PrimaryDestination = 'home' | 'competitions' | 'predictions' | 'ranking';

export const routeByScreen: Record<Exclude<AppScreen, 'not-found'>, string> = {
  home: '/',
  competitions: '/competicoes',
  days: '/competicoes/copa-do-mundo-2026/jogos',
  predictions: '/competicoes/copa-do-mundo-2026/palpites',
  knockout: '/competicoes/copa-do-mundo-2026/eliminatorias',
  ranking: '/competicoes/copa-do-mundo-2026/ranking',
  cup: '/competicoes/copa-do-mundo-2026',
  teams: '/competicoes/copa-do-mundo-2026/times',
  brasileirao: '/competicoes/brasileirao-serie-a-2026',
  'brasileirao-predictions': '/competicoes/brasileirao-serie-a-2026/palpites',
  'brasileirao-standings': '/competicoes/brasileirao-serie-a-2026/classificacao',
  'brasileirao-ranking': '/competicoes/brasileirao-serie-a-2026/ranking',
  admin: '/admin',
};

const screenByRoute = new Map(
  Object.entries(routeByScreen).map(([screen, route]) => [route, screen as AppScreen]),
);

function normalizePath(pathname: string) {
  const clean = pathname.split('?')[0]?.split('#')[0] || '/';
  if (clean === '/') return clean;
  return clean.replace(/\/+$/, '') || '/';
}

export function screenFromPath(pathname: string): AppScreen {
  return screenByRoute.get(normalizePath(pathname)) ?? 'not-found';
}

export function pathForScreen(screen: AppScreen) {
  if (screen === 'not-found') return '/nao-encontrado';
  return routeByScreen[screen];
}

export function pageTitle(screen: AppScreen) {
  const labels: Record<AppScreen, string> = {
    home: 'Início',
    competitions: 'Competições',
    days: 'Jogos da Copa 2026',
    predictions: 'Palpites da Copa 2026',
    knockout: 'Eliminatórias da Copa 2026',
    ranking: 'Ranking da Copa 2026',
    cup: 'Copa do Mundo 2026',
    teams: 'Seleções da Copa 2026',
    brasileirao: 'Brasileirão Série A 2026',
    'brasileirao-predictions': 'Palpites do Brasileirão',
    'brasileirao-standings': 'Classificação do Brasileirão',
    'brasileirao-ranking': 'Ranking do Brasileirão',
    admin: 'Administração',
    'not-found': 'Página não encontrada',
  };
  return `${labels[screen]} · Bolão Sirel`;
}

export const worldCupScreens = new Set<AppScreen>([
  'days',
  'predictions',
  'knockout',
  'ranking',
  'cup',
  'teams',
]);

export const leagueScreens = new Set<AppScreen>([
  'brasileirao',
  'brasileirao-predictions',
  'brasileirao-standings',
  'brasileirao-ranking',
]);

export function competitionSlugForScreen(screen: AppScreen) {
  if (leagueScreens.has(screen)) return 'brasileirao-serie-a';
  if (worldCupScreens.has(screen)) return 'world-cup';
  return null;
}

export function competitionForScreen<T extends { slug: string }>(
  competitions: readonly T[],
  screen: AppScreen,
) {
  const slug = competitionSlugForScreen(screen);
  return slug ? (competitions.find((competition) => competition.slug === slug) ?? null) : null;
}

export function screenForCompetitionSlug(slug: string): AppScreen | null {
  if (slug === 'brasileirao-serie-a') return 'brasileirao';
  if (slug === 'world-cup') return 'cup';
  return null;
}

export function screenForPrimaryDestination(
  destination: PrimaryDestination,
  capabilities: ReadonlySet<string>,
): AppScreen {
  if (destination === 'home' || destination === 'competitions') return destination;
  if (capabilities.has('LEAGUE')) {
    return destination === 'predictions' ? 'brasileirao-predictions' : 'brasileirao-ranking';
  }
  return destination;
}

export function activePrimaryDestination(screen: AppScreen): PrimaryDestination | null {
  if (screen === 'home') return 'home';
  if (screen === 'competitions') return 'competitions';
  if (screen === 'predictions' || screen === 'brasileirao-predictions') return 'predictions';
  if (screen === 'ranking' || screen === 'brasileirao-ranking') return 'ranking';
  if (worldCupScreens.has(screen) || leagueScreens.has(screen)) return 'competitions';
  return null;
}
