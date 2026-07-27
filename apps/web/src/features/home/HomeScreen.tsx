import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { User } from '../../api';
import { useCompetition } from '../../app/CompetitionContext';
import { AsyncState } from '../../components/AsyncState';
import {
  Card,
  ResponsiveContainer,
  SectionHeader,
  StatusChip,
} from '../../components/DesignSystem';
import {
  pathForCompetition,
  pathForScreen,
  type AppScreen,
  type CompetitionSection,
} from '../../navigation/routes';
import { RouteLink } from '../../navigation/RouteLink';
import { theme } from '../../theme/tokens';

const seasonStatus: Record<
  'DRAFT' | 'ACTIVE' | 'FINISHED' | 'ARCHIVED',
  { label: string; tone: 'accent' | 'neutral' | 'warning' }
> = {
  DRAFT: { label: 'Rascunho', tone: 'warning' },
  ACTIVE: { label: 'Em andamento', tone: 'accent' },
  FINISHED: { label: 'Encerrada', tone: 'neutral' },
  ARCHIVED: { label: 'Arquivada', tone: 'neutral' },
};

function competitionFormat(capabilities: ReadonlySet<string>) {
  if (capabilities.has('LEAGUE')) return 'Pontos corridos';
  if (capabilities.has('GROUPS') && capabilities.has('KNOCKOUT')) {
    return 'Grupos e mata-mata';
  }
  if (capabilities.has('TWO_LEGS')) return 'Confrontos de ida e volta';
  if (capabilities.has('GROUPS')) return 'Fase de grupos';
  if (capabilities.has('KNOCKOUT')) return 'Mata-mata';
  return 'Temporada';
}

export function HomeScreen({
  user,
  onNavigate,
  onNavigateCompetition,
}: {
  user: User;
  onNavigate: (screen: AppScreen) => void;
  onNavigateCompetition: (competitionSlug: string, section: CompetitionSection) => void;
}) {
  const context = useCompetition();
  const { width } = useWindowDimensions();
  const compact = width < theme.breakpoint.compact;
  const competitionSlug = context.competition?.slug;
  const selectedSeason = context.season;
  const selectedStatus = selectedSeason ? seasonStatus[selectedSeason.status] : null;
  const format = competitionFormat(context.capabilities);

  const actions: Array<{
    screen?: AppScreen;
    section?: CompetitionSection;
    label: string;
    description: string;
    icon: keyof typeof Ionicons.glyphMap;
  }> = [
    {
      section: 'games',
      label: 'Ver jogos',
      description: 'Consulte o calendário e os resultados da competição selecionada.',
      icon: 'calendar-outline',
    },
    {
      section: 'ranking',
      label: 'Abrir ranking',
      description: 'Confira a classificação do bolão e os critérios de desempate.',
      icon: 'podium-outline',
    },
    {
      screen: 'competitions',
      label: 'Trocar campeonato',
      description: 'Escolha outro campeonato e mantenha cada disputa em seu próprio contexto.',
      icon: 'trophy-outline',
    },
  ];
  const availableActions = selectedSeason ? actions : actions.filter((item) => !item.section);

  return (
    <ResponsiveContainer style={styles.page}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>OLÁ, {user.nickname.toLocaleUpperCase('pt-BR')}</Text>
        <Text role="heading" aria-level={1} style={[styles.title, compact && styles.titleCompact]}>
          Visão geral
        </Text>
        <Text style={styles.subtitle}>
          Continue na temporada selecionada ou acesse outro campeonato.
        </Text>
      </View>

      <AsyncState
        status={
          context.error
            ? 'error'
            : context.loading
              ? 'loading'
              : selectedSeason
                ? 'success'
                : 'empty'
        }
        error={context.error}
        emptyTitle="Escolha uma competição"
        emptyMessage="Abra a central de competições para selecionar uma temporada."
        onRetry={context.retry}
        skeletonLines={3}
      >
        {selectedSeason ? (
          <Card
            accessibilityLabel={`Competição atual: ${selectedSeason.name}`}
            style={styles.seasonPanel}
          >
            <View style={[styles.seasonLayout, compact && styles.seasonLayoutCompact]}>
              <View style={[styles.seasonBody, compact && styles.seasonBodyCompact]}>
                <View style={[styles.seasonIcon, compact && styles.seasonIconCompact]}>
                  <Ionicons
                    name="trophy-outline"
                    size={compact ? 26 : 32}
                    color={theme.color.accentInk}
                  />
                </View>
                <View style={styles.seasonCopy}>
                  <View style={styles.seasonTopline}>
                    <Text style={styles.seasonEyebrow}>COMPETIÇÃO ATUAL</Text>
                    {selectedStatus ? (
                      <StatusChip label={selectedStatus.label} tone={selectedStatus.tone} />
                    ) : null}
                  </View>
                  <Text
                    role="heading"
                    aria-level={2}
                    style={[styles.seasonTitle, compact && styles.seasonTitleCompact]}
                  >
                    {selectedSeason.name}
                  </Text>
                  {context.competition?.name &&
                  context.competition.name !== selectedSeason.name ? (
                    <Text style={styles.competitionName}>{context.competition.name}</Text>
                  ) : null}
                  <View style={styles.seasonMeta}>
                    {selectedSeason.year ? (
                      <View style={styles.metaItem}>
                        <Ionicons
                          name="calendar-outline"
                          size={15}
                          color={theme.color.textSubtle}
                        />
                        <Text style={styles.metaText}>Temporada {selectedSeason.year}</Text>
                      </View>
                    ) : null}
                    <View style={styles.metaItem}>
                      <Ionicons
                        name="football-outline"
                        size={15}
                        color={theme.color.textSubtle}
                      />
                      <Text style={styles.metaText}>{format}</Text>
                    </View>
                  </View>
                </View>
              </View>
              <View style={[styles.seasonActions, compact && styles.seasonActionsCompact]}>
                <Text style={styles.actionHint}>PRÓXIMA AÇÃO</Text>
                <RouteLink
                  href={
                    competitionSlug
                      ? pathForCompetition(competitionSlug, 'predictions')
                      : pathForScreen('competitions')
                  }
                  accessibilityLabel={`Abrir palpites de ${selectedSeason.name}`}
                  onActivate={() => {
                    if (competitionSlug) onNavigateCompetition(competitionSlug, 'predictions');
                    else onNavigate('competitions');
                  }}
                  style={({ pressed }) => [
                    styles.primaryAction,
                    pressed && styles.primaryActionPressed,
                  ]}
                >
                  <Ionicons name="create-outline" size={18} color={theme.color.accentInk} />
                  <Text style={styles.primaryActionText}>Abrir palpites</Text>
                  <Ionicons name="arrow-forward" size={17} color={theme.color.accentInk} />
                </RouteLink>
                <RouteLink
                  href={
                    competitionSlug
                      ? pathForCompetition(competitionSlug)
                      : pathForScreen('competitions')
                  }
                  onActivate={() => {
                    if (competitionSlug) onNavigateCompetition(competitionSlug, 'overview');
                    else onNavigate('competitions');
                  }}
                  style={({ pressed }) => [
                    styles.secondaryAction,
                    pressed && styles.secondaryActionPressed,
                  ]}
                >
                  <Text style={styles.secondaryActionText}>Ver competição</Text>
                </RouteLink>
              </View>
            </View>
          </Card>
        ) : null}
      </AsyncState>

      <View style={styles.paths}>
        <SectionHeader
          eyebrow={selectedSeason ? 'ACESSOS DA TEMPORADA' : 'COMPETIÇÕES'}
          title={selectedSeason ? 'Navegue pelo bolão' : 'Selecione seu campeonato'}
          description={
            selectedSeason
              ? 'Atalhos para as áreas já disponíveis na competição selecionada.'
              : 'A central reúne somente as competições publicadas para o seu bolão.'
          }
        />
        <View style={styles.actionList}>
          {availableActions.map((item) => (
            <RouteLink
              key={item.section ?? item.screen}
              accessibilityLabel={item.label}
              href={
                item.section && competitionSlug
                  ? pathForCompetition(competitionSlug, item.section)
                  : pathForScreen(item.screen ?? 'competitions')
              }
              onActivate={() => {
                if (item.section && competitionSlug) {
                  onNavigateCompetition(competitionSlug, item.section);
                } else {
                  onNavigate(item.screen ?? 'competitions');
                }
              }}
              style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
            >
              <View style={styles.actionIcon} accessibilityElementsHidden>
                <Ionicons name={item.icon} size={20} color={theme.color.accent} />
              </View>
              <View style={styles.actionCopy}>
                <Text style={styles.actionLabel}>{item.label}</Text>
                <Text style={styles.actionDescription}>{item.description}</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={theme.color.textMuted} />
            </RouteLink>
          ))}
        </View>
      </View>
    </ResponsiveContainer>
  );
}

const styles = StyleSheet.create({
  page: { gap: theme.space.xxxl, maxWidth: 1120, paddingBottom: 64 },
  heading: { maxWidth: 680, paddingTop: theme.space.sm },
  eyebrow: { color: theme.color.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.35 },
  title: {
    color: theme.color.text,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -0.85,
    lineHeight: 43,
    marginTop: theme.space.xs,
  },
  titleCompact: { fontSize: 30, lineHeight: 36 },
  subtitle: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.md,
    lineHeight: 21,
    marginTop: theme.space.sm,
    maxWidth: 620,
  },
  seasonPanel: {
    borderColor: theme.color.borderStrong,
    borderLeftColor: theme.color.accent,
    borderLeftWidth: 3,
    overflow: 'hidden',
    padding: 0,
  },
  seasonLayout: { alignItems: 'stretch', flexDirection: 'row' },
  seasonLayoutCompact: { flexDirection: 'column' },
  seasonBody: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: theme.space.xl,
    minWidth: 0,
    padding: theme.space.xl,
  },
  seasonBodyCompact: {
    alignItems: 'flex-start',
    gap: theme.space.lg,
    padding: theme.space.lg,
  },
  seasonIcon: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.lg,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  seasonIconCompact: { borderRadius: theme.radius.md, height: 54, width: 54 },
  seasonCopy: { flex: 1, minWidth: 0 },
  seasonTopline: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.sm,
  },
  seasonEyebrow: {
    color: theme.color.accent,
    fontSize: theme.font.size.xs,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  seasonTitle: {
    color: theme.color.text,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.55,
    lineHeight: 34,
    marginTop: theme.space.sm,
  },
  seasonTitleCompact: { fontSize: 22, lineHeight: 28 },
  competitionName: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.md,
    marginTop: theme.space.xs,
  },
  seasonMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.lg,
    marginTop: theme.space.lg,
  },
  metaItem: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  metaText: { color: theme.color.textSubtle, fontSize: theme.font.size.sm, fontWeight: '600' },
  seasonActions: {
    borderLeftColor: theme.color.border,
    borderLeftWidth: 1,
    justifyContent: 'center',
    padding: theme.space.xl,
    width: 260,
  },
  seasonActionsCompact: {
    borderLeftWidth: 0,
    borderTopColor: theme.color.border,
    borderTopWidth: 1,
    padding: theme.space.lg,
    width: '100%',
  },
  actionHint: {
    color: theme.color.textSubtle,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.1,
    marginBottom: theme.space.sm,
  },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.sm,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  primaryActionPressed: {
    backgroundColor: theme.color.accentStrong,
    transform: [{ scale: 0.985 }],
  },
  primaryActionText: { color: theme.color.accentInk, flex: 1, fontSize: 12, fontWeight: '900' },
  secondaryAction: {
    alignItems: 'center',
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: theme.space.sm,
    minHeight: theme.touchTarget,
  },
  secondaryActionPressed: { backgroundColor: theme.color.surfaceHover },
  secondaryActionText: { color: theme.color.text, fontSize: 11, fontWeight: '800' },
  paths: { maxWidth: 860 },
  actionList: {
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    borderTopColor: theme.color.borderMuted,
    borderTopWidth: 1,
    marginTop: theme.space.lg,
  },
  actionRow: {
    alignItems: 'center',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: theme.space.md,
    minHeight: 76,
    paddingHorizontal: theme.space.xs,
    paddingVertical: theme.space.sm,
  },
  actionRowPressed: { backgroundColor: theme.color.surfaceHover },
  actionIcon: {
    alignItems: 'center',
    backgroundColor: theme.color.accentMuted,
    borderRadius: theme.radius.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  actionCopy: { flex: 1 },
  actionLabel: { color: theme.color.text, fontSize: theme.font.size.md, fontWeight: '900' },
  actionDescription: { color: theme.color.textMuted, fontSize: 12, lineHeight: 18, marginTop: 3 },
});
