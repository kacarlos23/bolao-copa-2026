import type { ImageSourcePropType } from 'react-native';
import {
  brasileirao2026ClubCrestKey,
  type Brasileirao2026ClubCrestKey,
} from './clubCrestCatalog';

declare const require: (path: string) => ImageSourcePropType;

const crestSources: Record<Brasileirao2026ClubCrestKey, ImageSourcePropType> = {
  'athletico-paranaense': require('../assets/team-crests/athletico-paranaense.jpg'),
  'atletico-mineiro': require('../assets/team-crests/atletico-mineiro.jpg'),
  bahia: require('../assets/team-crests/bahia.jpg'),
  botafogo: require('../assets/team-crests/botafogo.jpg'),
  chapecoense: require('../assets/team-crests/chapecoense.jpg'),
  corinthians: require('../assets/team-crests/corinthians.jpg'),
  coritiba: require('../assets/team-crests/coritiba.jpg'),
  cruzeiro: require('../assets/team-crests/cruzeiro.jpg'),
  flamengo: require('../assets/team-crests/flamengo.jpg'),
  fluminense: require('../assets/team-crests/fluminense.jpg'),
  gremio: require('../assets/team-crests/gremio.jpg'),
  internacional: require('../assets/team-crests/internacional.jpg'),
  mirassol: require('../assets/team-crests/mirassol.jpg'),
  palmeiras: require('../assets/team-crests/palmeiras.jpg'),
  'red-bull-bragantino': require('../assets/team-crests/red-bull-bragantino.jpg'),
  remo: require('../assets/team-crests/remo.jpg'),
  santos: require('../assets/team-crests/santos.jpg'),
  'sao-paulo': require('../assets/team-crests/sao-paulo.jpg'),
  'vasco-da-gama': require('../assets/team-crests/vasco-da-gama.jpg'),
  vitoria: require('../assets/team-crests/vitoria.jpg'),
};

export function localClubCrestSource(teamName?: string | null) {
  const key = brasileirao2026ClubCrestKey(teamName);
  return key ? crestSources[key] : undefined;
}
