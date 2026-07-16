export const brasileirao2026ClubCrestKeys = [
  'athletico-paranaense',
  'atletico-mineiro',
  'bahia',
  'botafogo',
  'chapecoense',
  'corinthians',
  'coritiba',
  'cruzeiro',
  'flamengo',
  'fluminense',
  'gremio',
  'internacional',
  'mirassol',
  'palmeiras',
  'red-bull-bragantino',
  'remo',
  'santos',
  'sao-paulo',
  'vasco-da-gama',
  'vitoria',
] as const;

export type Brasileirao2026ClubCrestKey = (typeof brasileirao2026ClubCrestKeys)[number];

function normalizeClubName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:fc|saf)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const aliases: Record<string, Brasileirao2026ClubCrestKey> = {
  'athletico paranaense': 'athletico-paranaense',
  'athletico pr': 'athletico-paranaense',
  'atletico paranaense': 'athletico-paranaense',
  'atletico mineiro': 'atletico-mineiro',
  'atletico mg': 'atletico-mineiro',
  bahia: 'bahia',
  botafogo: 'botafogo',
  chapecoense: 'chapecoense',
  corinthians: 'corinthians',
  coritiba: 'coritiba',
  cruzeiro: 'cruzeiro',
  flamengo: 'flamengo',
  fluminense: 'fluminense',
  gremio: 'gremio',
  internacional: 'internacional',
  mirassol: 'mirassol',
  palmeiras: 'palmeiras',
  'red bull bragantino': 'red-bull-bragantino',
  bragantino: 'red-bull-bragantino',
  remo: 'remo',
  santos: 'santos',
  'sao paulo': 'sao-paulo',
  'vasco da gama': 'vasco-da-gama',
  vitoria: 'vitoria',
};

export function brasileirao2026ClubCrestKey(name?: string | null) {
  if (!name) return null;
  return aliases[normalizeClubName(name)] ?? null;
}
