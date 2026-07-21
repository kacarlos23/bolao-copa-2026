import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SeasonDto } from '@bolao/shared';
import { competitionSectionsForCapabilities } from '../navigation/competition-navigation';
import { pathForCompetition, pathForScreen, type CompetitionSection } from '../navigation/routes';
import { RouteLink } from '../navigation/RouteLink';
import { theme } from '../theme/tokens';
import { useCompetition } from './CompetitionContext';

type NavItem = {
  section: CompetitionSection;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const itemBySection: Record<
  Exclude<CompetitionSection, 'team-athletes' | 'team-matches' | 'team-statistics'>,
  NavItem
> = {
  overview: { section: 'overview', label: 'Visão geral', icon: 'grid-outline' },
  games: { section: 'games', label: 'Jogos', icon: 'calendar-outline' },
  predictions: { section: 'predictions', label: 'Palpites', icon: 'create-outline' },
  standings: { section: 'standings', label: 'Classificação', icon: 'list-outline' },
  bracket: { section: 'bracket', label: 'Chave', icon: 'git-network-outline' },
  ranking: { section: 'ranking', label: 'Ranking', icon: 'podium-outline' },
  teams: { section: 'teams', label: 'Times', icon: 'shield-outline' },
};

export function CompetitionSubnav({
  section,
  competitionSlug,
  competitionName,
  seasons = [],
  selectedSeasonId,
  onNavigate,
  onChangeCompetition,
  onSelectSeason,
}: {
  section?: CompetitionSection | null;
  competitionSlug?: string | null;
  competitionName?: string | null;
  seasons?: SeasonDto[];
  selectedSeasonId?: string | null;
  onNavigate: (section: CompetitionSection) => void;
  onChangeCompetition: () => void;
  onSelectSeason?: (seasonId: string) => void;
}) {
  const context = useCompetition();
  if (!section || !competitionSlug) return null;
  const items = competitionSectionsForCapabilities(
    context.capabilities,
    context.capabilityConfig,
  ).map((enabledSection) => itemBySection[enabledSection as keyof typeof itemBySection]);
  const title = competitionName ?? 'Competição';
  const legacy = context.capabilityConfig.workspace === 'WORLD_CUP_LEGACY';

  return (
    <View style={styles.shell}>
      <View style={styles.contextRow}>
        <View style={styles.contextText}>
          <View style={styles.eyebrowRow}>
            <Text style={styles.eyebrow}>COMPETIÇÃO</Text>
            {legacy ? <Text style={styles.legacyBadge}>LEGADO</Text> : null}
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <RouteLink
          href={pathForScreen('competitions')}
          accessibilityLabel="Trocar competição"
          onActivate={onChangeCompetition}
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
            item.section === section ||
            (item.section === 'teams' && section.startsWith('team-'));
          return (
            <RouteLink
              key={item.section}
              {...({ 'aria-current': selected ? 'page' : undefined } as never)}
              href={pathForCompetition(competitionSlug, item.section)}
              accessibilityLabel={item.label}
              accessibilityState={{ selected }}
              onActivate={() => onNavigate(item.section)}
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
