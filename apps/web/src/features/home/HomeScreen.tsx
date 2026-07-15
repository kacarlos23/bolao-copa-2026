import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { User } from '../../api';
import { useCompetition } from '../../app/CompetitionContext';
import { AsyncState } from '../../components/AsyncState';
import { pathForScreen, type AppScreen } from '../../navigation/routes';
import { RouteLink } from '../../navigation/RouteLink';
import { theme } from '../../theme/tokens';

export function HomeScreen({
  user,
  onNavigate,
}: {
  user: User;
  onNavigate: (screen: AppScreen) => void;
}) {
  const context = useCompetition();
  const { width } = useWindowDimensions();
  const compact = width < 768;
  const league = context.capabilities.has('LEAGUE');
  const predictionScreen: AppScreen = league ? 'brasileirao-predictions' : 'predictions';
  const rankingScreen: AppScreen = league ? 'brasileirao-ranking' : 'ranking';
  const competitionScreen: AppScreen = league ? 'brasileirao' : 'cup';

  const actions: Array<{
    screen: AppScreen;
    label: string;
    description: string;
    icon: keyof typeof Ionicons.glyphMap;
  }> = [
    {
      screen: predictionScreen,
      label: 'Fazer palpites',
      description: 'Preencha os jogos abertos e acompanhe o salvamento de cada placar.',
      icon: 'create-outline',
    },
    {
      screen: rankingScreen,
      label: 'Ver minha disputa',
      description: 'Confira posição, rival mais próximo, movimento e desempates.',
      icon: 'podium-outline',
    },
    {
      screen: 'competitions',
      label: 'Trocar competição',
      description: 'Escolha outro campeonato e mantenha cada disputa em seu próprio contexto.',
      icon: 'trophy-outline',
    },
  ];

  return (
    <View style={styles.page}>
      <View style={[styles.intro, compact && styles.introCompact]}>
        <View style={styles.introCopy}>
          <Text style={styles.eyebrow}>OLÁ, {user.nickname.toUpperCase()}</Text>
          <Text
            role="heading"
            aria-level={1}
            style={[styles.title, compact && styles.titleCompact]}
          >
            Seu bolão, sem perder o jogo.
          </Text>
          <Text style={styles.subtitle}>
            Um ponto de partida para palpitar, acompanhar a rodada e evoluir no ranking.
          </Text>
        </View>

        <AsyncState
          status={
            context.error
              ? 'error'
              : context.loading
                ? 'loading'
                : context.season
                  ? 'success'
                  : 'empty'
          }
          error={context.error}
          emptyTitle="Escolha uma competição"
          emptyMessage="Abra a central para começar."
          onRetry={context.retry}
          skeletonLines={2}
        >
          <View style={styles.continueArea}>
            <Text style={styles.continueEyebrow}>CONTINUAR EM</Text>
            <Text style={styles.continueTitle}>{context.season?.name}</Text>
            <Text style={styles.continueMeta}>
              {[...context.capabilities].join(' · ') || 'Temporada ativa'}
            </Text>
            <RouteLink
              href={pathForScreen(predictionScreen)}
              onActivate={() => onNavigate(predictionScreen)}
              style={styles.primaryAction}
            >
              <Text style={styles.primaryActionText}>Abrir palpites</Text>
              <Ionicons name="arrow-forward" size={18} color={theme.color.accentInk} />
            </RouteLink>
            <RouteLink
              href={pathForScreen(competitionScreen)}
              onActivate={() => onNavigate(competitionScreen)}
              style={styles.secondaryAction}
            >
              <Text style={styles.secondaryActionText}>Ver competição</Text>
            </RouteLink>
          </View>
        </AsyncState>
      </View>

      <View style={styles.loop} accessibilityLabel="Como funciona a disputa">
        {[
          ['01', 'Palpite', 'Escolha os placares'],
          ['02', 'Acompanhe', 'Veja resultados e pontos'],
          ['03', 'Avance', 'Suba no ranking'],
        ].map(([number, label, description], index) => (
          <View
            key={number}
            style={[
              styles.loopItem,
              index > 0 && (compact ? styles.loopDividerCompact : styles.loopDivider),
            ]}
          >
            <Text style={styles.loopNumber}>{number}</Text>
            <View>
              <Text style={styles.loopLabel}>{label}</Text>
              <Text style={styles.loopDescription}>{description}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.paths}>
        <Text style={styles.sectionEyebrow}>ATALHOS</Text>
        <Text role="heading" aria-level={2} style={styles.sectionTitle}>
          O que você quer fazer?
        </Text>
        <View style={styles.actionList}>
          {actions.map((item) => (
            <RouteLink
              key={item.screen}
              href={pathForScreen(item.screen)}
              onActivate={() => onNavigate(item.screen)}
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
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 42, marginHorizontal: 'auto', maxWidth: 1120, paddingBottom: 64, width: '100%' },
  intro: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: 64,
    justifyContent: 'space-between',
    paddingTop: 28,
  },
  introCompact: { flexDirection: 'column', gap: theme.space.xl, paddingTop: 8 },
  introCopy: { flex: 1, justifyContent: 'center', maxWidth: 620 },
  eyebrow: { color: theme.color.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.35 },
  title: {
    color: theme.color.text,
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: -1.15,
    lineHeight: 49,
    marginTop: 8,
  },
  titleCompact: { fontSize: 32, lineHeight: 38 },
  subtitle: {
    color: theme.color.textMuted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
    maxWidth: 560,
  },
  continueArea: {
    backgroundColor: theme.color.surface,
    borderLeftColor: theme.color.accent,
    borderLeftWidth: 4,
    justifyContent: 'center',
    minHeight: 230,
    padding: theme.space.xl,
    width: 330,
    maxWidth: '100%',
  },
  continueEyebrow: {
    color: theme.color.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  continueTitle: {
    color: theme.color.text,
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 25,
    marginTop: 6,
  },
  continueMeta: { color: theme.color.textMuted, fontSize: 10, fontWeight: '800', marginTop: 6 },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.sm,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: theme.space.lg,
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  primaryActionText: { color: theme.color.accentInk, fontSize: 12, fontWeight: '900' },
  secondaryAction: { alignItems: 'center', justifyContent: 'center', minHeight: theme.touchTarget },
  secondaryActionText: { color: theme.color.textMuted, fontSize: 11, fontWeight: '800' },
  loop: {
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    borderTopColor: theme.color.borderMuted,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  loopItem: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minWidth: 220,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.xl,
  },
  loopDivider: { borderLeftColor: theme.color.borderMuted, borderLeftWidth: 1 },
  loopDividerCompact: { borderTopColor: theme.color.borderMuted, borderTopWidth: 1 },
  loopNumber: { color: theme.color.gold, fontSize: 21, fontWeight: '900' },
  loopLabel: { color: theme.color.text, fontSize: 13, fontWeight: '900' },
  loopDescription: { color: theme.color.textMuted, fontSize: 11, marginTop: 2 },
  paths: { maxWidth: 820 },
  sectionEyebrow: {
    color: theme.color.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  sectionTitle: { color: theme.color.text, fontSize: 24, fontWeight: '900', marginTop: 4 },
  actionList: {
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
    minHeight: 82,
    paddingVertical: theme.space.md,
  },
  actionRowPressed: { backgroundColor: 'rgba(114, 183, 242, 0.07)' },
  actionIcon: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  actionCopy: { flex: 1 },
  actionLabel: { color: theme.color.text, fontSize: 14, fontWeight: '900' },
  actionDescription: { color: theme.color.textMuted, fontSize: 12, lineHeight: 18, marginTop: 3 },
});
