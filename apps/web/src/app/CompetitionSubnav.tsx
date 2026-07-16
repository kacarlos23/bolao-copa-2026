import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SeasonDto } from '@bolao/shared';
import {
  leagueScreens,
  pathForScreen,
  worldCupScreens,
  type AppScreen,
} from '../navigation/routes';
import { RouteLink } from '../navigation/RouteLink';
import { theme } from '../theme/tokens';

type NavItem = {
  screen: AppScreen;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const leagueItems: NavItem[] = [
  { screen: 'brasileirao', label: 'Visão geral', icon: 'grid-outline' },
  { screen: 'brasileirao-predictions', label: 'Palpites', icon: 'create-outline' },
  { screen: 'brasileirao-standings', label: 'Classificação', icon: 'list-outline' },
  { screen: 'brasileirao-ranking', label: 'Ranking', icon: 'podium-outline' },
  { screen: 'brasileirao-teams', label: 'Times', icon: 'shield-outline' },
];

const worldCupItems: NavItem[] = [
  { screen: 'cup', label: 'Visão geral', icon: 'football-outline' },
  { screen: 'days', label: 'Jogos', icon: 'calendar-outline' },
  { screen: 'predictions', label: 'Palpites', icon: 'create-outline' },
  { screen: 'knockout', label: 'Eliminatórias', icon: 'git-network-outline' },
  { screen: 'ranking', label: 'Ranking', icon: 'podium-outline' },
  { screen: 'teams', label: 'Seleções', icon: 'people-outline' },
];

export function CompetitionSubnav({
  screen,
  competitionName,
  seasons = [],
  selectedSeasonId,
  onNavigate,
  onSelectSeason,
}: {
  screen: AppScreen;
  competitionName?: string | null;
  seasons?: SeasonDto[];
  selectedSeasonId?: string | null;
  onNavigate: (screen: AppScreen) => void;
  onSelectSeason?: (seasonId: string) => void;
}) {
  const isLeague = leagueScreens.has(screen);
  const isWorldCup = worldCupScreens.has(screen);
  if (!isLeague && !isWorldCup) return null;
  const items = isLeague ? leagueItems : worldCupItems;
  const title = competitionName ?? (isLeague ? 'Brasileirão Série A 2026' : 'Copa do Mundo 2026');

  return (
    <View style={styles.shell}>
      <View style={styles.contextRow}>
        <View style={styles.contextText}>
          <View style={styles.eyebrowRow}>
            <Text style={styles.eyebrow}>COMPETIÇÃO</Text>
            {!isLeague ? <Text style={styles.legacyBadge}>LEGADO</Text> : null}
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <RouteLink
          href={pathForScreen('competitions')}
          accessibilityLabel="Trocar competição"
          onActivate={() => onNavigate('competitions')}
          style={styles.allButton}
        >
          <Ionicons name="swap-horizontal-outline" size={17} color={theme.color.textMuted} />
          <Text style={styles.allButtonText}>Trocar</Text>
        </RouteLink>
      </View>
      {seasons.length > 1 ? (
        <View style={styles.seasonRow} accessibilityLabel="Temporadas disponíveis">
          <Text style={styles.seasonLabel}>TEMPORADA</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.seasonRail}
          >
            {seasons.map((season) => {
              const selected = season.id === selectedSeasonId;
              return (
                <Pressable
                  key={season.id}
                  {...({ 'aria-pressed': selected } as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`${season.name}${selected ? ', atual' : ''}`}
                  onPress={() => onSelectSeason?.(season.id)}
                  style={[styles.seasonButton, selected && styles.seasonButtonActive]}
                >
                  <Text style={[styles.seasonText, selected && styles.seasonTextActive]}>
                    {season.year ?? season.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
        role="navigation"
        accessibilityLabel={`Seções de ${title}`}
      >
        {items.map((item) => {
          const selected =
            item.screen === screen ||
            (item.screen === 'brasileirao-teams' && screen.startsWith('brasileirao-team-'));
          return (
            <RouteLink
              key={item.screen}
              {...({ 'aria-current': selected ? 'page' : undefined } as never)}
              href={pathForScreen(item.screen)}
              accessibilityLabel={item.label}
              accessibilityState={{ selected }}
              onActivate={() => onNavigate(item.screen)}
              style={[styles.item, selected && styles.itemActive]}
            >
              <Ionicons
                name={item.icon}
                size={16}
                color={selected ? theme.color.accentInk : theme.color.textMuted}
              />
              <Text style={[styles.itemText, selected && styles.itemTextActive]}>{item.label}</Text>
            </RouteLink>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    gap: theme.space.md,
    marginHorizontal: 'auto',
    maxWidth: 1280,
    paddingHorizontal: theme.space.xl,
    paddingVertical: theme.space.md,
    width: '100%',
  },
  contextRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  contextText: { flex: 1, minWidth: 0 },
  eyebrowRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  eyebrow: { color: theme.color.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.25 },
  legacyBadge: {
    backgroundColor: 'rgba(244, 214, 92, 0.14)',
    borderRadius: theme.radius.pill,
    color: theme.color.gold,
    fontSize: 8,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  title: { color: theme.color.text, fontSize: 16, fontWeight: '900', marginTop: 3 },
  seasonRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  seasonLabel: {
    color: theme.color.textMuted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  seasonRail: { gap: 6 },
  seasonButton: {
    alignItems: 'center',
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: 12,
  },
  seasonButtonActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  seasonText: { color: theme.color.textMuted, fontSize: 10, fontWeight: '900' },
  seasonTextActive: { color: theme.color.accentInk },
  allButton: {
    alignItems: 'center',
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: theme.touchTarget,
    paddingHorizontal: 12,
  },
  allButtonText: { color: theme.color.textMuted, fontSize: 11, fontWeight: '800' },
  rail: { gap: 5 },
  item: {
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    flexDirection: 'row',
    gap: 6,
    minHeight: theme.touchTarget,
    paddingHorizontal: 12,
  },
  itemActive: { backgroundColor: theme.color.accent },
  itemText: { color: theme.color.textMuted, fontSize: 11, fontWeight: '800' },
  itemTextActive: { color: theme.color.accentInk },
});
