import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SeasonDto } from '@bolao/shared';
import { ResponsiveContainer } from '../components/DesignSystem';
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
  const { width } = useWindowDimensions();
  const compact = width < theme.breakpoint.compact;
  if (!section || !competitionSlug) return null;

  const items = competitionSectionsForCapabilities(
    context.capabilities,
    context.capabilityConfig,
  ).flatMap((enabledSection) => {
    const item = itemBySection[enabledSection as keyof typeof itemBySection];
    return item ? [item] : [];
  });
  const title = competitionName ?? 'Competição';
  const legacy = context.capabilityConfig.workspace === 'WORLD_CUP_LEGACY';
  const currentSection = section.startsWith('team-')
    ? 'Time'
    : (itemBySection[section as keyof typeof itemBySection]?.label ?? 'Visão geral');

  return (
    <View style={styles.shell}>
      <ResponsiveContainer style={[styles.inner, compact && styles.innerCompact]}>
        {!compact ? (
          <View
            {...({ role: 'navigation' } as object)}
            accessibilityLabel="Caminho de navegação"
            style={styles.breadcrumbs}
          >
            <RouteLink
              href={pathForScreen('competitions')}
              accessibilityLabel="Voltar à lista"
              onActivate={onChangeCompetition}
              style={({ pressed }) => pressed && styles.linkPressed}
            >
              <Text style={styles.breadcrumbLink}>Competições</Text>
            </RouteLink>
            <Ionicons name="chevron-forward" size={12} color={theme.color.textSubtle} />
            <RouteLink
              href={pathForCompetition(competitionSlug)}
              accessibilityLabel={`Abrir ${title}`}
              onActivate={() => onNavigate('overview')}
              style={({ pressed }) => pressed && styles.linkPressed}
            >
              <Text style={styles.breadcrumbLink} numberOfLines={1}>
                {title}
              </Text>
            </RouteLink>
            {section !== 'overview' ? (
              <>
                <Ionicons name="chevron-forward" size={12} color={theme.color.textSubtle} />
                <Text aria-current="page" numberOfLines={1} style={styles.breadcrumbCurrent}>
                  {currentSection}
                </Text>
              </>
            ) : null}
          </View>
        ) : null}

        <View style={styles.contextRow}>
          <View style={styles.contextText}>
            <View style={styles.eyebrowRow}>
              <Text style={styles.eyebrow}>COMPETIÇÃO ATIVA</Text>
              {legacy ? <Text style={styles.legacyBadge}>LEGADO</Text> : null}
            </View>
            <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={1}>
              {title}
            </Text>
          </View>
          <RouteLink
            href={pathForScreen('competitions')}
            accessibilityLabel="Trocar competição"
            onActivate={onChangeCompetition}
            style={({ pressed }) => [styles.changeButton, pressed && styles.changeButtonPressed]}
          >
            <Ionicons name="swap-horizontal-outline" size={17} color={theme.color.textMuted} />
            {!compact ? <Text style={styles.changeButtonText}>Trocar</Text> : null}
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
                    {...({ 'aria-pressed': selected } as object)}
                    accessibilityRole="button"
                    accessibilityLabel={`${season.name}${selected ? ', atual' : ''}`}
                    onPress={() => onSelectSeason?.(season.id)}
                    style={({ pressed }) => [
                      styles.seasonButton,
                      selected && styles.seasonButtonActive,
                      pressed && styles.seasonButtonPressed,
                    ]}
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
          style={styles.railScroll}
        >
          {items.map((item) => {
            const selected =
              item.section === section || (item.section === 'teams' && section.startsWith('team-'));
            return (
              <RouteLink
                key={item.section}
                {...({ 'aria-current': selected ? 'page' : undefined } as object)}
                href={pathForCompetition(competitionSlug, item.section)}
                accessibilityLabel={item.label}
                accessibilityState={{ selected }}
                onActivate={() => onNavigate(item.section)}
                style={({ pressed }) => [
                  styles.item,
                  selected && styles.itemActive,
                  pressed && styles.itemPressed,
                ]}
              >
                <Ionicons
                  name={item.icon}
                  size={16}
                  color={selected ? theme.color.accent : theme.color.textMuted}
                />
                <Text style={[styles.itemText, selected && styles.itemTextActive]}>
                  {item.label}
                </Text>
              </RouteLink>
            );
          })}
        </ScrollView>
      </ResponsiveContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: theme.color.surface,
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    width: '100%',
  },
  inner: {
    gap: theme.space.sm,
    paddingHorizontal: theme.space.xl,
    paddingVertical: theme.space.sm,
  },
  innerCompact: {
    gap: 6,
    paddingHorizontal: theme.space.md,
    paddingVertical: 7,
  },
  breadcrumbs: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.space.xs,
    minHeight: 20,
  },
  breadcrumbLink: {
    color: theme.color.textSubtle,
    fontSize: theme.font.size.xs,
    fontWeight: '800',
  },
  breadcrumbCurrent: {
    color: theme.color.textMuted,
    flexShrink: 1,
    fontSize: theme.font.size.xs,
    fontWeight: '800',
  },
  linkPressed: { opacity: 0.72 },
  contextRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.space.md,
    justifyContent: 'space-between',
  },
  contextText: { flex: 1, minWidth: 0 },
  eyebrowRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  eyebrow: {
    color: theme.color.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.15,
  },
  legacyBadge: {
    backgroundColor: theme.color.warningMuted,
    borderRadius: theme.radius.pill,
    color: theme.color.warning,
    fontSize: 8,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  title: {
    color: theme.color.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.15,
    marginTop: 2,
  },
  titleCompact: { fontSize: 14 },
  seasonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.space.sm,
  },
  seasonLabel: {
    color: theme.color.textSubtle,
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
    paddingHorizontal: theme.space.md,
  },
  seasonButtonActive: {
    backgroundColor: theme.color.accentMuted,
    borderColor: theme.color.accent,
  },
  seasonButtonPressed: { backgroundColor: theme.color.surfacePressed },
  seasonText: { color: theme.color.textMuted, fontSize: theme.font.size.xs, fontWeight: '900' },
  seasonTextActive: { color: theme.color.accent },
  changeButton: {
    alignItems: 'center',
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    paddingHorizontal: theme.space.md,
  },
  changeButtonPressed: { backgroundColor: theme.color.surfacePressed },
  changeButtonText: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.xs,
    fontWeight: '800',
  },
  railScroll: {
    borderTopColor: theme.color.borderMuted,
    borderTopWidth: 1,
  },
  rail: { gap: theme.space.xs },
  item: {
    alignItems: 'center',
    borderBottomColor: 'transparent',
    borderBottomWidth: 2,
    flexDirection: 'row',
    gap: 6,
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
  },
  itemActive: {
    backgroundColor: theme.color.accentMuted,
    borderBottomColor: theme.color.accent,
  },
  itemPressed: { backgroundColor: theme.color.surfacePressed },
  itemText: { color: theme.color.textMuted, fontSize: theme.font.size.xs, fontWeight: '800' },
  itemTextActive: { color: theme.color.accent },
});
