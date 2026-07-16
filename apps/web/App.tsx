import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  API_URL,
  api,
  createRankingEvents,
  CupMatchResult,
  CupOverview,
  CupStandingRow,
  MatchDay,
  RankingAward,
  RankingPeriod,
  RankingRow,
  Team,
  User,
} from './src/api';
import { flagSources } from './src/flagSources';
import type { TeamCatalogEntry } from './src/teamCatalog';
import { DrawerReveal, SoftReveal, usePrefersReducedMotion } from './src/motion';
import { CompetitionProvider, normalizeCapabilities } from './src/app/CompetitionContext';
import { CompetitionSelector } from './src/features/competitions/CompetitionSelector';
import { CompetitionHub } from './src/features/competitions/CompetitionHub';
import { HomeScreen } from './src/features/home/HomeScreen';
import { ToastProvider } from './src/components/Toast';
import { RouteState } from './src/components/RouteState';
import { hasStoredDirtyDraft } from './src/services/drafts';
import { AppShell } from './src/app/AppShell';
import { RoutedWorkspace } from './src/app/RoutedWorkspace';
import {
  leagueScreens,
  pageTitle,
  pathForLeagueTeam,
  pathForScreen,
  screenForCompetitionSlug,
  screenFromPath,
  teamIdFromPath,
  type AppScreen,
  type LeagueTeamSection,
} from './src/navigation/routes';

type Screen = AppScreen;
type RankingStatusFilter = 'all' | 'live' | 'final';

const competitionUiV2 = process.env.EXPO_PUBLIC_COMPETITION_UI_V2 === '1';
const appIaV2 = process.env.EXPO_PUBLIC_APP_IA_V2 !== '0';
const legacyAdminMutations = process.env.EXPO_PUBLIC_LEGACY_ADMIN_MUTATIONS === '1';
const legacyPredictionsUi =
  process.env.EXPO_PUBLIC_LEGACY_PREDICTIONS === '1' ||
  (typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('predictions') === 'v1');
const brasileiraoUi = process.env.EXPO_PUBLIC_BRASILEIRAO_UI === '1';
const PredictionBoardScreen = lazy(() =>
  import('./src/predictionBoard').then((module) => ({ default: module.PredictionBoardScreen })),
);
const CupOverviewV2 = lazy(() =>
  import('./src/competitionV2').then((module) => ({ default: module.CupOverviewV2 })),
);
const DailyPredictionsV2 = lazy(() =>
  import('./src/competitionV2').then((module) => ({ default: module.DailyPredictionsV2 })),
);
const Brasileirao2026Screen = lazy(() =>
  import('./src/brasileirao2026').then((module) => ({ default: module.Brasileirao2026Screen })),
);
const TeamDirectoryScreen = lazy(() =>
  import('./src/features/teams/LeagueTeamsScreen').then((module) => ({
    default: module.TeamDirectoryScreen,
  })),
);
const TeamProfileScreen = lazy(() =>
  import('./src/features/teams/LeagueTeamsScreen').then((module) => ({
    default: module.TeamProfileScreen,
  })),
);
const BrasileiraoCanaryAdmin = lazy(() =>
  import('./src/brasileiraoAdmin').then((module) => ({ default: module.BrasileiraoCanaryAdmin })),
);
const AdminOperationsPanel = lazy(() =>
  import('./src/adminOperations').then((module) => ({ default: module.AdminOperationsPanel })),
);
const knockoutDeadline = new Date('2026-06-18T23:59:59-03:00').getTime();

function initialAppScreen(): Screen {
  if (!appIaV2 || Platform.OS !== 'web' || typeof window === 'undefined') return 'days';
  return screenFromPath(window.location.pathname);
}

function initialLeagueTeamId() {
  if (!appIaV2 || Platform.OS !== 'web' || typeof window === 'undefined') return null;
  return teamIdFromPath(window.location.pathname);
}

function leagueTeamSectionForScreen(screen: Screen): LeagueTeamSection {
  if (screen === 'brasileirao-team-matches') return 'matches';
  if (screen === 'brasileirao-team-statistics') return 'statistics';
  return 'athletes';
}

function screenForLeagueTeamSection(section: LeagueTeamSection): Screen {
  if (section === 'matches') return 'brasileirao-team-matches';
  if (section === 'statistics') return 'brasileirao-team-statistics';
  return 'brasileirao-team-athletes';
}

const colors = {
  bg: '#00143a',
  bg2: 'rgba(1, 30, 76, 0.78)',
  panel: 'rgba(2, 30, 76, 0.74)',
  panel2: 'rgba(2, 44, 96, 0.82)',
  panel3: 'rgba(4, 42, 92, 0.62)',
  border: 'rgba(98, 144, 210, 0.42)',
  text: '#f8fbff',
  muted: '#b8c6dd',
  soft: '#dce8f7',
  green: '#21d66f',
  greenDark: '#008a4f',
  gold: '#ffd315',
  goldBorder: '#ffd315',
  blue: '#28a7ff',
  amber: '#ffc233',
  red: '#ff6b59',
  input: 'rgba(2, 18, 52, 0.84)',
};

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function countdownText(targetTime: number, nowTime: number) {
  const remaining = Math.max(0, targetTime - nowTime);
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts = days > 0 ? [days, hours, minutes] : [hours, minutes, seconds];
  return parts.map((part) => String(part).padStart(2, '0')).join(':');
}

function dateOnly(value: string | Date) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    typeof value === 'string' ? new Date(value) : value,
  );
}

function monthTitle(value: Date) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(value);
}

function addMonths(value: Date, months: number) {
  return new Date(value.getFullYear(), value.getMonth() + months, 1);
}

function gameCountLabel(count: number) {
  return count === 1 ? '1 jogo' : `${count} jogos`;
}

function saoPauloMonth(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Number(values.year), Number(values.month) - 1, 1);
}

function matchMeta(match: MatchDay['matches'][number]) {
  const raw = match.rawPayload as { group?: string; round?: string } | null | undefined;
  return [raw?.round, raw?.group ? `Grupo ${raw.group}` : null].filter(Boolean).join(' - ');
}

type ScoreMatch = {
  status: string;
  homeScore?: number | null;
  awayScore?: number | null;
  finalHomeScore?: number | null;
  finalAwayScore?: number | null;
};

function matchScore(match: ScoreMatch) {
  const homeScore =
    match.status === 'FINISHED' ? (match.finalHomeScore ?? match.homeScore) : match.homeScore;
  const awayScore =
    match.status === 'FINISHED' ? (match.finalAwayScore ?? match.awayScore) : match.awayScore;

  if (homeScore == null || awayScore == null) return null;
  return {
    homeScore,
    awayScore,
    label:
      match.status === 'FINISHED'
        ? 'Resultado final'
        : match.status === 'LIVE'
          ? 'Placar atual'
          : 'Placar',
  };
}

function fallbackPredictionCloseAt(startsAt: string) {
  return new Date(new Date(startsAt).getTime() - 5 * 60 * 1000).toISOString();
}

function matchPredictionCloseAt(match: MatchDay['matches'][number]) {
  return match.predictionsCloseAt ?? fallbackPredictionCloseAt(match.startsAt);
}

function isMatchOpenForPredictions(match: MatchDay['matches'][number]) {
  if (typeof match.isOpenForPredictions === 'boolean') return match.isOpenForPredictions;
  return new Date(matchPredictionCloseAt(match)) > new Date();
}

function absoluteAvatarUrl(avatarUrl?: string | null) {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith('http')) return avatarUrl;
  return `${API_URL}${avatarUrl}`;
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const base = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0] ?? '?'];
  return base
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function UserAvatar({
  nickname,
  avatarUrl,
  size = 42,
}: {
  nickname: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  const uri = absoluteAvatarUrl(avatarUrl);
  const avatarStyle = { width: size, height: size, borderRadius: size / 2 };
  const textStyle = { fontSize: Math.max(12, Math.round(size * 0.34)) };

  if (uri) {
    return (
      <Image source={{ uri }} style={[styles.userAvatarImage, avatarStyle]} resizeMode="cover" />
    );
  }

  return (
    <View style={[styles.userAvatarFallback, avatarStyle]}>
      <Text style={[styles.userAvatarText, textStyle]}>{initials(nickname)}</Text>
    </View>
  );
}

function RankingHighlight({
  label,
  row,
  icon,
  tone,
  movement,
}: {
  label: string;
  row?: RankingRow;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'leader' | 'last';
  movement?: number | null;
}) {
  if (!row) return null;

  return (
    <View
      style={[styles.rankingHighlightCard, tone === 'leader' ? styles.leaderCard : styles.lastCard]}
    >
      <View style={styles.rankingHighlightAvatar}>
        <UserAvatar nickname={row.nickname} avatarUrl={row.avatarUrl} size={70} />
        <View
          style={[
            styles.rankingMarker,
            tone === 'leader' ? styles.leaderMarker : styles.lastMarker,
          ]}
        >
          <Ionicons name={icon} size={16} color={colors.bg} />
        </View>
      </View>
      <View style={styles.rankingHighlightInfo}>
        <Text style={styles.rankingHighlightLabel}>{label}</Text>
        <Text style={styles.rankingHighlightName}>{row.nickname}</Text>
        <Text style={styles.muted}>{row.points} pts</Text>
        <RankingMovementBadge delta={movement ?? null} />
      </View>
    </View>
  );
}

function RankingMovementBadge({
  delta,
  compact = false,
}: {
  delta: number | null;
  compact?: boolean;
}) {
  if (delta == null) return null;

  const positive = delta > 0;
  const negative = delta < 0;
  const neutral = delta === 0;
  const icon = neutral ? 'remove-outline' : positive ? 'arrow-up-outline' : 'arrow-down-outline';
  const label = neutral ? '0' : `${positive ? '+' : ''}${delta}`;

  return (
    <View
      style={[
        styles.rankingMovementBadge,
        compact && styles.rankingMovementBadgeCompact,
        positive && styles.rankingMovementBadgeUp,
        negative && styles.rankingMovementBadgeDown,
        neutral && styles.rankingMovementBadgeNeutral,
      ]}
    >
      <Ionicons
        name={icon}
        size={compact ? 11 : 12}
        color={positive ? '#8ff5be' : negative ? '#ffb0a4' : '#d4e4dc'}
      />
      <Text
        style={[
          styles.rankingMovementText,
          compact && styles.rankingMovementTextCompact,
          positive && styles.rankingMovementTextUp,
          negative && styles.rankingMovementTextDown,
          neutral && styles.rankingMovementTextNeutral,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function LastFive({
  values,
  matches,
}: {
  values: number[];
  matches?: Array<{ score: number; match?: any }>;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const padded = [...values.slice(-5)];
  while (padded.length < 5) padded.unshift(-1);

  const paddedMatches = matches ? [...matches.slice(-5)] : [];
  while (paddedMatches.length < 5) paddedMatches.unshift(undefined as any);

  return (
    <View style={[styles.lastFiveList, { position: 'relative' }]}>
      {padded.map((value, index) => {
        const match = paddedMatches[index];
        const isHovered = hoveredIndex === index;

        return (
          <View key={`${index}-${value}`} style={{ position: 'relative' }}>
            <Pressable
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={[
                styles.lastFiveBadge,
                value === 15 && styles.lastFiveExact,
                value === 3 && styles.lastFiveResult,
                (value === 1 || value === 7) && styles.lastFiveGoal,
                value === 0 && styles.lastFiveMiss,
                value < 0 && styles.lastFiveEmpty,
              ]}
            >
              <Text style={styles.lastFiveText}>{value >= 0 ? value : '-'}</Text>
            </Pressable>

            {isHovered && match && match.match && (
              <View style={styles.lastFiveTooltip}>
                <View style={styles.lastFiveTooltipContent}>
                  {match.match.homeTeam && match.match.awayTeam && (
                    <View style={styles.lastFiveTooltipTeams}>
                      <TeamFlag team={match.match.homeTeam} size={14} />
                      <Text style={styles.lastFiveTooltipVs}>vs</Text>
                      <TeamFlag team={match.match.awayTeam} size={14} />
                    </View>
                  )}
                  <View style={styles.lastFiveTooltipScore}>
                    <Text style={styles.lastFiveTooltipScoreText}>
                      {match.match.finalHomeScore ?? match.match.homeScore ?? '-'}-
                      {match.match.finalAwayScore ?? match.match.awayScore ?? '-'}
                    </Text>
                  </View>
                  <View style={styles.lastFiveTooltipPoints}>
                    <Text style={styles.lastFiveTooltipPointsText}>{match.score} pts</Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function flagForTeam(team: Team) {
  return team.metadata?.iso2 ?? '';
}

function TeamFlag({ team, size = 18 }: { team: Team; size?: number }) {
  const isoCode = flagForTeam(team).toLowerCase();
  const source = flagSources[isoCode];

  if (!source) {
    return (
      <View style={[styles.flagFallback, { width: size * 1.6, height: size }]}>
        <Text style={styles.flagFallbackText}>{team.code?.slice(0, 2) ?? '--'}</Text>
      </View>
    );
  }

  return (
    <Image
      resizeMode="cover"
      source={source}
      style={[styles.countryFlag, { width: size * 1.6, height: size }]}
    />
  );
}

function TeamNameButton({
  team,
  onOpenTeam,
  singleLine = false,
}: {
  team: Team;
  onOpenTeam?: (team: Team) => void;
  singleLine?: boolean;
}) {
  const isPlaceholder = team.id.startsWith('placeholder-');
  if (!onOpenTeam || isPlaceholder) {
    return (
      <Text numberOfLines={singleLine ? 1 : undefined} style={styles.matchTitle}>
        {team.name}
      </Text>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onOpenTeam(team)}
      hitSlop={6}
      style={singleLine ? styles.teamNameButtonSingleLine : undefined}
    >
      <Text
        numberOfLines={singleLine ? 1 : undefined}
        style={[styles.matchTitle, styles.teamNameLink, singleLine && styles.teamNameSingleLine]}
      >
        {team.name}
      </Text>
    </Pressable>
  );
}

function PrimaryButton({
  label,
  accessibilityLabel,
  onPress,
  disabled,
  tone = 'primary',
  icon,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const contentColor = tone === 'primary' ? '#062017' : colors.text;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        tone === 'secondary' && styles.buttonSecondary,
        tone === 'danger' && styles.buttonDanger,
        disabled && styles.buttonDisabled,
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={contentColor} /> : null}
      <Text style={[styles.buttonText, { color: contentColor }]}>{label}</Text>
    </Pressable>
  );
}

function HeaderNav({
  screen,
  setScreen,
  isAdmin,
  showBrasileirao,
  onLogout,
}: {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  isAdmin: boolean;
  showBrasileirao: boolean;
  onLogout: () => void;
}) {
  const items: Array<{
    key: Screen | 'logout';
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    active?: boolean;
  }> = [
    {
      key: 'days',
      label: 'Dias',
      icon: 'calendar-outline',
      onPress: () => setScreen('days'),
      active: screen === 'days',
    },
    {
      key: 'predictions',
      label: 'Palpites',
      icon: 'create-outline',
      onPress: () => setScreen('predictions'),
      active: screen === 'predictions',
    },
    {
      key: 'knockout',
      label: 'Eliminatorias',
      icon: 'git-network-outline',
      onPress: () => setScreen('knockout'),
      active: screen === 'knockout',
    },
    {
      key: 'ranking',
      label: 'Ranking',
      icon: 'podium-outline',
      onPress: () => setScreen('ranking'),
      active: screen === 'ranking',
    },
    {
      key: 'cup',
      label: 'Copa',
      icon: 'football-outline',
      onPress: () => setScreen('cup'),
      active: screen === 'cup',
    },
    {
      key: 'teams',
      label: 'Times',
      icon: 'people-outline',
      onPress: () => setScreen('teams'),
      active: screen === 'teams',
    },
  ];

  if (showBrasileirao) {
    items.splice(4, 0, {
      key: 'brasileirao',
      label: 'Brasileirão',
      icon: 'shield-outline',
      onPress: () => setScreen('brasileirao'),
      active: screen === 'brasileirao',
    });
  }

  if (isAdmin) {
    items.push({
      key: 'admin',
      label: 'Admin',
      icon: 'settings-outline',
      onPress: () => setScreen('admin'),
      active: screen === 'admin',
    });
  }

  return (
    <View style={styles.nav}>
      <View style={styles.navTabs} accessibilityRole="tablist">
        {items.map((item, index) => {
          const active = Boolean(item.active);
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={item.onPress}
              style={[
                styles.navItem,
                active && styles.navItemActive,
                index === 0 && styles.navItemFirst,
              ]}
            >
              <Ionicons name={item.icon} size={18} color={active ? colors.gold : colors.text} />
              <Text style={[styles.navItemText, active && styles.navItemTextActive]}>
                {item.label}
              </Text>
              <View style={styles.navItemDivider} />
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onLogout}
        style={[styles.navItem, styles.navItemLast]}
      >
        <Ionicons name="log-out-outline" size={18} color={colors.text} />
        <Text style={styles.navItemText}>Sair</Text>
      </Pressable>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  secureTextEntry,
  placeholder,
  help,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
  placeholder?: string;
  help?: string;
  keyboardType?: 'default' | 'number-pad';
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={help}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        placeholder={placeholder}
        placeholderTextColor="#6e8379"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
      />
      {help ? <Text style={styles.helpText}>{help}</Text> : null}
    </View>
  );
}

function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'live';
}) {
  return (
    <View
      style={[
        styles.pill,
        tone === 'ok' && styles.pillOk,
        tone === 'warn' && styles.pillWarn,
        tone === 'live' && styles.pillLive,
      ]}
    >
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

function SuccessModal({
  visible,
  title,
  message,
  onClose,
}: {
  visible: boolean;
  title: string;
  message: string;
  onClose: () => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return;
    }

    Animated.spring(progress, {
      toValue: 1,
      duration: reducedMotion ? 0 : undefined,
      friction: 5,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [progress, reducedMotion, visible]);

  return (
    <Modal
      transparent
      animationType={reducedMotion ? 'none' : 'fade'}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.successModal}>
          <Animated.View
            style={[
              styles.successIcon,
              {
                opacity: progress,
                transform: [
                  {
                    scale: progress.interpolate({
                      inputRange: [0, 0.7, 1],
                      outputRange: [0.25, 1.12, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <Ionicons name="checkmark" size={58} color={colors.text} />
          </Animated.View>
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.modalMessage}>{message}</Text>
          <PrimaryButton label="OK" icon="checkmark-circle-outline" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel,
  loading = false,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.confirmModal}>
          <View style={styles.confirmIcon}>
            <Ionicons name="trash-outline" size={34} color={colors.red} />
          </View>
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.modalMessage}>{message}</Text>
          <View style={styles.confirmModalActions}>
            <PrimaryButton
              label="Cancelar"
              icon="close-outline"
              tone="secondary"
              onPress={onCancel}
              disabled={loading}
            />
            <PrimaryButton
              label={loading ? 'Excluindo...' : confirmLabel}
              icon="trash-outline"
              tone="danger"
              onPress={onConfirm}
              disabled={loading}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function KnockoutCalloutModal({
  visible,
  now,
  onClose,
  onOpen,
}: {
  visible: boolean;
  now: number;
  onClose: () => void;
  onOpen: () => void;
}) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.knockoutCalloutModal}>
          <View style={styles.knockoutCalloutIcon}>
            <Ionicons name="git-network-outline" size={34} color={colors.bg} />
          </View>
          <Text style={styles.modalTitle}>Palpite das eliminatorias liberado</Text>
          <Text style={styles.modalMessage}>
            Simule os jogos em aberto da fase de grupos, visualize a chave projetada e salve sua
            previsao sem alterar os palpites regulares.
          </Text>
          <View style={styles.knockoutCalloutCountdown}>
            <Text style={styles.knockoutCalloutCountdownLabel}>Prazo final</Text>
            <Text style={styles.knockoutCalloutCountdownValue}>
              {countdownText(knockoutDeadline, now)}
            </Text>
            <Text style={styles.knockoutCalloutCountdownHint}>18/06/2026 as 23h59</Text>
          </View>
          <View style={styles.knockoutCalloutRules}>
            <View style={styles.knockoutCalloutRule}>
              <Text style={styles.knockoutCalloutRulePoints}>15</Text>
              <Text style={styles.knockoutCalloutRuleText}>pontos por confronto exato</Text>
            </View>
            <View style={styles.knockoutCalloutRule}>
              <Text style={styles.knockoutCalloutRulePoints}>7</Text>
              <Text style={styles.knockoutCalloutRuleText}>pontos por uma selecao correta</Text>
            </View>
          </View>
          <View style={styles.confirmModalActions}>
            <PrimaryButton label="Depois" icon="close-outline" tone="secondary" onPress={onClose} />
            <PrimaryButton label="Abrir chave" icon="git-network-outline" onPress={onOpen} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AuthScreen({ onAuth }: { onAuth: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    const normalizedUsername = username.trim();
    const normalizedNickname = nickname.trim();

    setError('');

    if (!normalizedUsername) {
      setError(mode === 'login' ? 'Informe seu nickname.' : 'Informe seu nome real.');
      return;
    }

    if (mode === 'register' && !normalizedNickname) {
      setError('Informe o nickname público.');
      return;
    }

    if (password.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const result =
        mode === 'login'
          ? await api.login(normalizedUsername, password)
          : await api.register(normalizedUsername, normalizedNickname, password);
      onAuth(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <ScrollView
        nativeID="conteudo-principal"
        role="main"
        contentContainerStyle={styles.authScroll}
      >
        <View style={styles.authHero}>
          <Text style={styles.brand}>Bolão Sirel</Text>
          <Text role="heading" aria-level={1} style={styles.authTitle}>
            Seu bolão em um só lugar
          </Text>
          <Text style={styles.authSubtitle}>
            Entre para palpitar nas competições, acompanhar seus pontos e disputar o ranking.
          </Text>
        </View>

        <View style={styles.authCard}>
          <View style={styles.segment} accessibilityLabel="Acesso à conta">
            <Pressable
              {...({ 'aria-pressed': mode === 'login' } as never)}
              accessibilityLabel="Usar login"
              accessibilityRole="button"
              onPress={() => {
                setMode('login');
                setError('');
              }}
              style={[styles.segmentItem, mode === 'login' && styles.segmentItemActive]}
            >
              <Text style={[styles.segmentText, mode === 'login' && styles.segmentTextActive]}>
                Entrar
              </Text>
            </Pressable>
            <Pressable
              {...({ 'aria-pressed': mode === 'register' } as never)}
              accessibilityLabel="Criar conta"
              accessibilityRole="button"
              onPress={() => {
                setMode('register');
                setError('');
              }}
              style={[styles.segmentItem, mode === 'register' && styles.segmentItemActive]}
            >
              <Text style={[styles.segmentText, mode === 'register' && styles.segmentTextActive]}>
                Criar conta
              </Text>
            </Pressable>
          </View>

          <Field
            label={mode === 'login' ? 'Nickname' : 'Nome real'}
            value={username}
            onChangeText={setUsername}
            placeholder={mode === 'login' ? 'ex: maria.silva' : 'ex: Maria Silva'}
            help={
              mode === 'login'
                ? 'Use o nickname público escolhido no cadastro para entrar.'
                : 'Use seu nome real no cadastro. Espaços, hífen e apóstrofo são permitidos.'
            }
          />

          {mode === 'register' ? (
            <Field
              label="Nickname público"
              value={nickname}
              onChangeText={setNickname}
              placeholder="ex: maria.silva"
              help="Esse nome aparece no ranking e pode ser personalizado como voce quiser."
            />
          ) : null}

          <Field
            label="Senha"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="mínimo 6 caracteres"
            help="Pode usar letras maiusculas, minusculas, numeros e simbolos."
          />

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.red} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton
            label={loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
            accessibilityLabel={mode === 'login' ? 'Entrar no Bolão Sirel' : 'Concluir cadastro'}
            onPress={submit}
            disabled={loading}
            icon={mode === 'login' ? 'log-in-outline' : 'person-add-outline'}
          />
        </View>
      </ScrollView>
    </AppShell>
  );
}

function HeaderLayout({
  user,
  screen,
  setScreen,
  onRefresh,
  onUserChange,
  showBrasileirao,
  onLogout,
}: {
  user: User;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  onRefresh: () => void;
  onUserChange: (user: User) => void;
  showBrasileirao: boolean;
  onLogout: () => void;
}) {
  const { width } = useWindowDimensions();
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [deleteAvatarVisible, setDeleteAvatarVisible] = useState(false);
  const wideHeader = width >= 1100;

  function showAvatarError(message: string) {
    if (typeof window !== 'undefined') window.alert(message);
  }

  function pickAvatar() {
    if (typeof document === 'undefined') {
      showAvatarError('Upload de avatar disponivel apenas no navegador.');
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      setAvatarBusy(true);
      api
        .uploadAvatar(file)
        .then((result) => onUserChange(result.user))
        .catch((error) =>
          showAvatarError(error instanceof Error ? error.message : 'Erro ao enviar avatar.'),
        )
        .finally(() => setAvatarBusy(false));
    };
    input.click();
  }

  function resetAvatar() {
    setAvatarBusy(true);
    api
      .resetAvatar()
      .then((result) => {
        onUserChange(result.user);
        setDeleteAvatarVisible(false);
      })
      .catch((error) =>
        showAvatarError(error instanceof Error ? error.message : 'Erro ao remover avatar.'),
      )
      .finally(() => setAvatarBusy(false));
  }

  return (
    <View style={[styles.header, wideHeader && styles.headerWide]}>
      <View style={[styles.headerIdentity, wideHeader && styles.headerIdentityWide]}>
        <View style={styles.headerAvatarShell}>
          <UserAvatar nickname={user.nickname} avatarUrl={user.avatarUrl} size={50} />
        </View>
        <View style={styles.headerUserText}>
          <Text style={styles.brandSmall}>Bolão Sirel</Text>
          <Text style={styles.headerTitle}>{user.nickname}</Text>
        </View>
        <View style={[styles.avatarActions, wideHeader && styles.avatarActionsWide]}>
          <Pressable
            onPress={onRefresh}
            style={styles.avatarActionButton}
            accessibilityLabel="Atualizar dados"
          >
            <Ionicons name="refresh-outline" size={18} color={colors.soft} />
          </Pressable>
          <Pressable
            disabled={avatarBusy}
            onPress={pickAvatar}
            style={[styles.avatarActionButton, avatarBusy && styles.buttonDisabled]}
          >
            <Ionicons name="camera-outline" size={18} color={colors.soft} />
          </Pressable>
          {user.avatarUrl ? (
            <Pressable
              disabled={avatarBusy}
              onPress={() => setDeleteAvatarVisible(true)}
              style={[styles.avatarActionButton, avatarBusy && styles.buttonDisabled]}
            >
              <Ionicons name="trash-outline" size={18} color={colors.red} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <ConfirmModal
        visible={deleteAvatarVisible}
        title="Excluir foto do perfil?"
        message="Sua foto atual sera removida e o avatar padrao com suas iniciais voltara a ser exibido."
        confirmLabel="Excluir foto"
        loading={avatarBusy}
        onCancel={() => setDeleteAvatarVisible(false)}
        onConfirm={resetAvatar}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.navScroll, wideHeader && styles.navScrollWide]}
        contentContainerStyle={styles.navScrollContent}
      >
        <HeaderNav
          screen={screen}
          setScreen={setScreen}
          isAdmin={user.role === 'ADMIN'}
          showBrasileirao={showBrasileirao}
          onLogout={onLogout}
        />
      </ScrollView>
    </View>
  );
}

function Header({
  user,
  screen,
  setScreen,
  onRefresh,
  onUserChange,
  showBrasileirao,
  onLogout,
}: {
  user: User;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  onRefresh: () => void;
  onUserChange: (user: User) => void;
  showBrasileirao: boolean;
  onLogout: () => void;
}) {
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [deleteAvatarVisible, setDeleteAvatarVisible] = useState(false);

  function showAvatarError(message: string) {
    if (typeof window !== 'undefined') window.alert(message);
  }

  function pickAvatar() {
    if (typeof document === 'undefined') {
      showAvatarError('Upload de avatar disponível apenas no navegador.');
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      setAvatarBusy(true);
      api
        .uploadAvatar(file)
        .then((result) => onUserChange(result.user))
        .catch((error) =>
          showAvatarError(error instanceof Error ? error.message : 'Erro ao enviar avatar.'),
        )
        .finally(() => setAvatarBusy(false));
    };
    input.click();
  }

  function resetAvatar() {
    setAvatarBusy(true);
    api
      .resetAvatar()
      .then((result) => {
        onUserChange(result.user);
        setDeleteAvatarVisible(false);
      })
      .catch((error) =>
        showAvatarError(error instanceof Error ? error.message : 'Erro ao remover avatar.'),
      )
      .finally(() => setAvatarBusy(false));
  }

  return (
    <View style={styles.header}>
      <View style={styles.headerIdentity}>
        <UserAvatar nickname={user.nickname} avatarUrl={user.avatarUrl} size={50} />
        <View style={styles.headerUserText}>
          <Text style={styles.brandSmall}>Bolão Sirel</Text>
          <Text style={styles.headerTitle}>{user.nickname}</Text>
        </View>
        <View style={styles.avatarActions}>
          <Pressable
            onPress={onRefresh}
            style={styles.avatarActionButton}
            accessibilityLabel="Atualizar dados"
          >
            <Ionicons name="refresh-outline" size={18} color={colors.text} />
          </Pressable>
          <Pressable
            disabled={avatarBusy}
            onPress={pickAvatar}
            style={[styles.avatarActionButton, avatarBusy && styles.buttonDisabled]}
          >
            <Ionicons name="camera-outline" size={18} color={colors.text} />
          </Pressable>
          {user.avatarUrl ? (
            <Pressable
              disabled={avatarBusy}
              onPress={() => setDeleteAvatarVisible(true)}
              style={[styles.avatarActionButton, avatarBusy && styles.buttonDisabled]}
            >
              <Ionicons name="trash-outline" size={18} color={colors.red} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <ConfirmModal
        visible={deleteAvatarVisible}
        title="Excluir foto do perfil?"
        message="Sua foto atual será removida e o avatar padrão com suas iniciais voltará a ser exibido."
        confirmLabel="Excluir foto"
        loading={avatarBusy}
        onCancel={() => setDeleteAvatarVisible(false)}
        onConfirm={resetAvatar}
      />
      <View style={styles.navInline}>
        <HeaderNav
          screen={screen}
          setScreen={setScreen}
          isAdmin={user.role === 'ADMIN'}
          showBrasileirao={showBrasileirao}
          onLogout={onLogout}
        />
      </View>
    </View>
  );
}

function DaysScreen({
  refreshVersion,
  onOpenTeam,
}: {
  refreshVersion: number;
  onOpenTeam: (team: Team) => void;
}) {
  const { width } = useWindowDimensions();
  const compactCalendar = width < 560;
  const [predictionCloseMinutes, setPredictionCloseMinutes] = useState(5);
  const [days, setDays] = useState<MatchDay[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => saoPauloMonth());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const result = await api.matchDays();
      setDays(result.matchDays);
      setPredictionCloseMinutes(result.predictionCloseMinutes);
      const today = dateOnly(new Date());
      const currentDay = result.matchDays.find(
        (day) =>
          dateOnly(day.date) === today ||
          dateOnly(day.firstMatchStartsAt) === today ||
          day.matches.some((match) => dateOnly(match.startsAt) === today),
      );
      setCurrentMonth(saoPauloMonth());
      setSelectedId((current) => {
        if (current && result.matchDays.some((day) => day.id === current)) return current;
        return currentDay?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar jogos.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      void load(false);
    }, 60_000);
    return () => clearInterval(interval);
  }, [refreshVersion]);

  if (loading) return <ActivityIndicator color={colors.green} style={styles.loader} />;

  const daysByDate = new Map(days.map((day) => [dateOnly(day.date), day]));
  const selectedDay = days.find((day) => day.id === selectedId) ?? null;
  const today = dateOnly(new Date());
  const firstOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const lastOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
  const calendarCells: Array<{ key: string; date?: Date; day?: MatchDay }> = [];

  for (let index = 0; index < firstOfMonth.getDay(); index += 1) {
    calendarCells.push({ key: `blank-start-${index}` });
  }

  for (let dayNumber = 1; dayNumber <= lastOfMonth.getDate(); dayNumber += 1) {
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), dayNumber);
    calendarCells.push({ key: dateOnly(date), date, day: daysByDate.get(dateOnly(date)) });
  }

  return (
    <View style={styles.contentGrid}>
      <View style={styles.panel}>
        <View style={styles.calendarHeader}>
          <View>
            <Text role="heading" aria-level={1} style={styles.sectionTitle}>
              Dias de jogos
            </Text>
            <Text style={styles.muted}>Calendário mensal dos jogos cadastrados.</Text>
          </View>
          <View style={styles.monthNav}>
            <PrimaryButton
              label=""
              icon="chevron-back-outline"
              tone="secondary"
              onPress={() => setCurrentMonth((current) => addMonths(current, -1))}
            />
            <Text style={styles.monthTitle}>{monthTitle(currentMonth)}</Text>
            <PrimaryButton
              label=""
              icon="chevron-forward-outline"
              tone="secondary"
              onPress={() => setCurrentMonth((current) => addMonths(current, 1))}
            />
          </View>
        </View>

        {days.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="cloud-download-outline" size={28} color={colors.gold} />
            <Text style={styles.emptyTitle}>Nenhum jogo cadastrado</Text>
            <Text style={styles.muted}>
              Entre no painel Admin para importar a tabela da Copa ou cadastrar jogos manualmente.
            </Text>
          </View>
        ) : (
          <SoftReveal
            key={`${currentMonth.getFullYear()}-${currentMonth.getMonth()}`}
            style={[styles.calendarGrid, compactCalendar && styles.calendarGridCompact]}
          >
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'].map((label) => (
              <Text
                key={label}
                style={[styles.weekdayLabel, compactCalendar && styles.weekdayLabelCompact]}
              >
                {label}
              </Text>
            ))}
            {calendarCells.map((cell) => {
              const selected = cell.day?.id === selectedId;
              const isToday = cell.date ? dateOnly(cell.date) === today : false;
              return (
                <Pressable
                  key={cell.key}
                  disabled={!cell.day}
                  onPress={() => cell.day && setSelectedId(cell.day.id)}
                  style={[
                    styles.calendarDay,
                    compactCalendar && styles.calendarDayCompact,
                    !cell.date && styles.calendarDayBlank,
                    cell.date && !cell.day && styles.calendarDayInactive,
                    cell.day && styles.calendarDayHasGames,
                    isToday && styles.calendarDayToday,
                    selected && styles.calendarDaySelected,
                  ]}
                >
                  {cell.date ? (
                    <>
                      <Text
                        style={[
                          styles.calendarDayNumber,
                          isToday && styles.calendarDayNumberToday,
                          selected && styles.calendarDayNumberSelected,
                        ]}
                      >
                        {cell.date.getDate()}
                      </Text>
                      {cell.day ? (
                        <Text
                          style={[
                            styles.calendarDayMeta,
                            compactCalendar && styles.calendarDayMetaCompact,
                          ]}
                        >
                          {gameCountLabel(cell.day.matches.length)}
                        </Text>
                      ) : null}
                    </>
                  ) : null}
                </Pressable>
              );
            })}
          </SoftReveal>
        )}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      {selectedDay ? (
        <SoftReveal key={selectedDay.id} style={styles.panel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.sectionTitle}>{dateTime(selectedDay.firstMatchStartsAt)}</Text>
              <Text style={styles.muted}>
                Cada partida fecha {predictionCloseMinutes} minutos antes do início.
              </Text>
            </View>
            <Pill
              label={selectedDay.isOpenForPredictions ? 'Palpites abertos' : 'Palpites fechados'}
              tone={selectedDay.isOpenForPredictions ? 'ok' : 'warn'}
            />
          </View>
          {selectedDay.matches.map((match) => {
            const score = matchScore(match);
            return (
              <View key={match.id} style={styles.calendarMatchRow}>
                <Text style={styles.matchTime}>
                  {new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(
                    new Date(match.startsAt),
                  )}
                </Text>
                <View style={styles.calendarMatchInfo}>
                  <View style={styles.matchTeamsLine}>
                    <TeamFlag team={match.homeTeam} />
                    <TeamNameButton team={match.homeTeam} onOpenTeam={onOpenTeam} />
                    {score ? (
                      <Text style={styles.inlineScore}>
                        {score.homeScore} x {score.awayScore}
                      </Text>
                    ) : (
                      <Text style={styles.matchTitle}>x</Text>
                    )}
                    <TeamFlag team={match.awayTeam} />
                    <TeamNameButton team={match.awayTeam} onOpenTeam={onOpenTeam} />
                  </View>
                  {score ? <Text style={styles.scoreStatusText}>{score.label}</Text> : null}
                  {matchMeta(match) ? <Text style={styles.muted}>{matchMeta(match)}</Text> : null}
                  <Text style={styles.muted}>
                    {isMatchOpenForPredictions(match)
                      ? `Palpites até ${dateTime(matchPredictionCloseAt(match))}`
                      : 'Palpites fechados'}
                  </Text>
                </View>
                <Pill label={match.status} tone={match.status === 'LIVE' ? 'live' : 'neutral'} />
              </View>
            );
          })}
        </SoftReveal>
      ) : null}
    </View>
  );
}

function PredictionsScreen({
  currentUserId,
  refreshVersion,
  onOpenTeam,
  onAdjustScroll,
}: {
  currentUserId: string;
  refreshVersion: number;
  onOpenTeam: (team: Team) => void;
  onAdjustScroll: (delta: number) => void;
}) {
  if (!legacyPredictionsUi) {
    return (
      <View style={styles.predictionsDailyPage}>
        <View style={styles.predictionsDailyHeader}>
          <View style={styles.predictionsDailyCopy}>
            <Text style={styles.predictionsDailyTitle}>Palpites</Text>
            <Text style={styles.predictionsDailySubtitle}>
              Agenda compacta para preencher os placares de cada dia.
            </Text>
          </View>
        </View>
        <DailyPredictionsV2 currentUserId={currentUserId} refreshVersion={refreshVersion} />
      </View>
    );
  }

  const [days, setDays] = useState<MatchDay[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [predictionCloseMinutes, setPredictionCloseMinutes] = useState(5);
  const dayMeasurements = useRef<
    Record<
      string,
      | ((callback: (x: number, y: number, width: number, height: number) => void) => void)
      | undefined
    >
  >({});
  const positionTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  async function load() {
    setLoading(true);
    try {
      const result = await api.matchDays();
      setDays(result.matchDays);
      setPredictionCloseMinutes(result.predictionCloseMinutes);
      setSelectedId((current) => {
        if (current) return current;

        const today = dateOnly(new Date());
        const currentDay = result.matchDays.find(
          (day) => dateOnly(day.date) === today || dateOnly(day.firstMatchStartsAt) === today,
        );
        const nextOpenDay = result.matchDays.find((day) =>
          day.matches.some((match) => isMatchOpenForPredictions(match)),
        );
        return currentDay?.id ?? nextOpenDay?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar campos de palpite.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();

    return () => {
      positionTimers.current.forEach(clearTimeout);
    };
  }, [refreshVersion]);

  function selectDay(dayId: string) {
    const nextId = selectedId === dayId ? null : dayId;
    const measure = dayMeasurements.current[dayId];
    positionTimers.current.forEach(clearTimeout);
    positionTimers.current = [];

    if (!measure) {
      setSelectedId(nextId);
      return;
    }

    measure((_x, beforeY) => {
      setSelectedId(nextId);

      const preservePosition = () => {
        dayMeasurements.current[dayId]?.((_nextX, afterY) => {
          const delta = afterY - beforeY;
          if (Math.abs(delta) > 1) onAdjustScroll(delta);
        });
      };

      positionTimers.current = [
        setTimeout(preservePosition, 230),
        setTimeout(preservePosition, 420),
      ];
    });
  }

  if (loading) return <ActivityIndicator color={colors.green} style={styles.loader} />;

  return (
    <View style={styles.sideList}>
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.sectionTitle}>Regras de pontuação</Text>
          <Text style={styles.muted}>
            A pontuação é calculada automaticamente ao atualizar os placares.
          </Text>
        </View>
        <View style={styles.predictionNotice}>
          <Ionicons name="time-outline" size={20} color={colors.gold} />
          <Text style={styles.predictionNoticeText}>
            Cada partida fecha {predictionCloseMinutes} minutos antes do início.
          </Text>
        </View>
        <View style={styles.rulesList}>
          <View style={styles.ruleRow}>
            <Text style={styles.rulePoints}>15 pts</Text>
            <Text style={styles.ruleText}>Acertou o placar exato.</Text>
          </View>
          <View style={styles.ruleRow}>
            <Text style={styles.rulePoints}>3 pts</Text>
            <Text style={styles.ruleText}>Acertou o vencedor ou empate, mas errou o placar.</Text>
          </View>
          <View style={styles.ruleRow}>
            <Text style={styles.rulePoints}>1 pt</Text>
            <Text style={styles.ruleText}>
              Acertou os gols de uma das equipes, mas errou o resultado.
            </Text>
          </View>
          <View style={styles.ruleRow}>
            <Text style={styles.rulePoints}>0 pt</Text>
            <Text style={styles.ruleText}>Errou tudo.</Text>
          </View>
        </View>
      </View>
      <Text style={styles.sectionTitle}>Rodadas para palpite</Text>
      {days.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="cloud-download-outline" size={28} color={colors.gold} />
          <Text style={styles.emptyTitle}>Carregando jogos da próxima rodada</Text>
          <Text style={styles.muted}>
            Entre no painel Admin para importar a tabela da Copa ou cadastrar jogos manualmente.
          </Text>
        </View>
      ) : null}
      {days.map((day) => {
        const open = Boolean(day.isOpenForPredictions);
        const selected = selectedId === day.id;
        const nextCloseAt = day.matches
          .filter((match) => isMatchOpenForPredictions(match))
          .map((match) => matchPredictionCloseAt(match))
          .sort()[0];
        return (
          <View key={day.id} style={styles.predictionDayBlock}>
            <View
              ref={(node) => {
                dayMeasurements.current[day.id] = node
                  ? node.measureInWindow.bind(node)
                  : undefined;
              }}
              collapsable={false}
            >
              <Pressable
                onPress={() => selectDay(day.id)}
                style={[styles.dayCard, selected && styles.dayCardActive]}
              >
                <View style={styles.rowBetween}>
                  <Text style={styles.dayTitle}>{dateTime(day.firstMatchStartsAt)}</Text>
                  <View style={styles.dayStatusGroup}>
                    <Pill label={open ? 'Aberto' : 'Fechado'} tone={open ? 'ok' : 'warn'} />
                    <Ionicons
                      name={selected ? 'chevron-up-outline' : 'chevron-down-outline'}
                      size={20}
                      color={selected ? colors.gold : colors.muted}
                    />
                  </View>
                </View>
                <Text style={styles.muted}>
                  {nextCloseAt
                    ? `Próximo fechamento: ${dateTime(nextCloseAt)}`
                    : 'Todos os jogos fechados'}
                </Text>
                <Text style={styles.muted}>{day.matches.length} jogo(s)</Text>
              </Pressable>
            </View>
            <AnimatedMatchDayDetail
              id={day.id}
              open={selected}
              currentUserId={currentUserId}
              onOpenTeam={onOpenTeam}
            />
          </View>
        );
      })}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function AnimatedMatchDayDetail({
  id,
  open,
  currentUserId,
  onOpenTeam,
}: {
  id: string;
  open: boolean;
  currentUserId: string;
  onOpenTeam: (team: Team) => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [rendered, setRendered] = useState(open);

  useEffect(() => {
    if (open) setRendered(true);

    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: reducedMotion ? 0 : open ? 210 : 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) setRendered(false);
    });
  }, [open, progress, reducedMotion]);

  if (!rendered) return null;

  return (
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      style={[
        styles.animatedDetailShell,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [-8, 0],
              }),
            },
            {
              scaleY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.98, 1],
              }),
            },
          ],
        },
      ]}
    >
      <MatchDayDetail id={id} currentUserId={currentUserId} onOpenTeam={onOpenTeam} />
    </Animated.View>
  );
}

function MatchDayDetail({
  id,
  currentUserId,
  onOpenTeam,
}: {
  id: string;
  currentUserId: string;
  onOpenTeam: (team: Team) => void;
}) {
  const [day, setDay] = useState<MatchDay | null>(null);
  const [values, setValues] = useState<Record<string, { home: string; away: string }>>({});
  const [successVisible, setSuccessVisible] = useState(false);
  const [error, setError] = useState('');
  const [predictionCloseMinutes, setPredictionCloseMinutes] = useState(5);

  useEffect(() => {
    setDay(null);
    setSuccessVisible(false);
    setError('');
    api.matchDay(id).then(({ matchDay, predictionCloseMinutes: closeMinutes }) => {
      setDay(matchDay);
      setPredictionCloseMinutes(closeMinutes);
      const next: Record<string, { home: string; away: string }> = {};
      for (const match of matchDay.matches) {
        const mine = match.predictions.find((prediction) => prediction.userId === currentUserId);
        next[match.id] = {
          home: mine ? String(mine.predictedHomeScore) : '',
          away: mine ? String(mine.predictedAwayScore) : '',
        };
      }
      setValues(next);
    });
  }, [currentUserId, id]);

  async function saveMatch(matchId: string) {
    if (!day) return;
    setError('');
    setSuccessVisible(false);

    const predictionValues = values[matchId] ?? { home: '0', away: '0' };

    try {
      await api.savePredictions(day.id, [
        {
          matchId,
          predictedHomeScore: Number(predictionValues.home || 0),
          predictedAwayScore: Number(predictionValues.away || 0),
        },
      ]);
      setSuccessVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    }
  }

  if (!day) return <ActivityIndicator color={colors.green} style={styles.loader} />;

  const hasOpenMatches = day.matches.some((match) => isMatchOpenForPredictions(match));

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <View>
          <Text style={styles.sectionTitle}>Campo de palpites</Text>
          <Text style={styles.muted}>
            Cada partida fecha {predictionCloseMinutes} minutos antes do início.
          </Text>
        </View>
        <Pill
          label={hasOpenMatches ? 'Com jogos abertos' : 'Público'}
          tone={hasOpenMatches ? 'ok' : 'warn'}
        />
      </View>
      {hasOpenMatches ? (
        <Text style={styles.muted}>
          Edite o placar de cada partida e salve o palpite individualmente.
        </Text>
      ) : null}

      {day.matches.map((match) => {
        const score = matchScore(match);
        const closed = !isMatchOpenForPredictions(match);
        const publicPredictions = [...match.predictions].sort((predictionA, predictionB) => {
          if (predictionA.userId === currentUserId) return -1;
          if (predictionB.userId === currentUserId) return 1;
          return (predictionA.user?.nickname ?? '').localeCompare(
            predictionB.user?.nickname ?? '',
            'pt-BR',
          );
        });
        return (
          <View key={match.id} style={styles.matchCard}>
            <View style={styles.matchInfo}>
              <View style={styles.matchTeamsLine}>
                <TeamFlag team={match.homeTeam} />
                <TeamNameButton team={match.homeTeam} onOpenTeam={onOpenTeam} />
                <Text style={styles.matchTitle}>x</Text>
                <TeamFlag team={match.awayTeam} />
                <TeamNameButton team={match.awayTeam} onOpenTeam={onOpenTeam} />
              </View>
              <Text style={styles.muted}>{dateTime(match.startsAt)}</Text>
              <Text style={styles.muted}>
                {closed
                  ? 'Palpites fechados para este jogo'
                  : `Palpites até ${dateTime(matchPredictionCloseAt(match))}`}
              </Text>
              {score ? (
                <View style={styles.matchScoreBoard}>
                  <Text style={styles.matchScoreLabel}>{score.label}</Text>
                  <Text style={styles.matchScoreValue}>
                    {score.homeScore} x {score.awayScore}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.predictionInputs}>
              <TextInput
                accessibilityLabel={`Placar de ${match.homeTeam.name}, mandante`}
                editable={!closed}
                style={[styles.scoreInput, closed && styles.scoreInputDisabled]}
                keyboardType="number-pad"
                value={values[match.id]?.home ?? ''}
                onChangeText={(home) =>
                  setValues((prev) => ({ ...prev, [match.id]: { ...prev[match.id], home } }))
                }
              />
              <Text style={styles.vs}>x</Text>
              <TextInput
                accessibilityLabel={`Placar de ${match.awayTeam.name}, visitante`}
                editable={!closed}
                style={[styles.scoreInput, closed && styles.scoreInputDisabled]}
                keyboardType="number-pad"
                value={values[match.id]?.away ?? ''}
                onChangeText={(away) =>
                  setValues((prev) => ({ ...prev, [match.id]: { ...prev[match.id], away } }))
                }
              />
            </View>
            {!closed ? (
              <PrimaryButton
                label="Salvar palpite"
                icon="save-outline"
                onPress={() => saveMatch(match.id)}
              />
            ) : null}

            {closed ? (
              <View style={styles.publicPredictions}>
                <View style={styles.publicPredictionsHeader}>
                  <View style={styles.publicPredictionsTitleGroup}>
                    <Ionicons name="people-outline" size={18} color={colors.gold} />
                    <Text style={styles.publicPredictionsTitle}>Palpites dos participantes</Text>
                  </View>
                  <Text style={styles.publicPredictionsCount}>
                    {publicPredictions.length}{' '}
                    {publicPredictions.length === 1 ? 'palpite' : 'palpites'}
                  </Text>
                </View>

                {publicPredictions.length > 0 ? (
                  <View style={styles.publicPredictionsList}>
                    {publicPredictions.map((prediction) => {
                      const isMine = prediction.userId === currentUserId;
                      const nickname = prediction.user?.nickname ?? 'Participante';
                      return (
                        <View
                          key={prediction.id}
                          style={[styles.predictionRow, isMine && styles.predictionRowMine]}
                        >
                          <View style={styles.predictionParticipant}>
                            <UserAvatar
                              nickname={nickname}
                              avatarUrl={prediction.user?.avatarUrl}
                              size={34}
                            />
                            <View style={styles.predictionParticipantText}>
                              <Text style={styles.predictionNickname} numberOfLines={1}>
                                {nickname}
                              </Text>
                              {isMine ? (
                                <Text style={styles.predictionMineLabel}>Seu palpite</Text>
                              ) : null}
                            </View>
                          </View>
                          <View style={styles.predictionScore}>
                            <Text style={styles.predictionScoreNumber}>
                              {prediction.predictedHomeScore}
                            </Text>
                            <Text style={styles.predictionScoreSeparator}>x</Text>
                            <Text style={styles.predictionScoreNumber}>
                              {prediction.predictedAwayScore}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <View style={styles.publicPredictionsEmpty}>
                    <Ionicons name="chatbox-ellipses-outline" size={22} color={colors.muted} />
                    <Text style={styles.muted}>
                      Nenhum participante enviou palpite para este jogo.
                    </Text>
                  </View>
                )}
              </View>
            ) : null}
          </View>
        );
      })}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <SuccessModal
        visible={successVisible}
        title="Palpite salvo"
        message="Seu palpite foi salvo com sucesso."
        onClose={() => setSuccessVisible(false)}
      />
    </View>
  );
}

function AdminScreen({
  currentUserId,
  refreshVersion,
}: {
  currentUserId: string;
  refreshVersion: number;
}) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [homeTeamCode, setHomeTeamCode] = useState('');
  const [awayTeamCode, setAwayTeamCode] = useState('');
  const [startsAt, setStartsAt] = useState('2026-06-11T16:00');
  const [message, setMessage] = useState('');
  const [userMessage, setUserMessage] = useState('');
  const [error, setError] = useState('');
  const [userError, setUserError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userSaving, setUserSaving] = useState<string | null>(null);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [predictionCloseMinutes, setPredictionCloseMinutes] = useState('5');
  const [settingSaving, setSettingSaving] = useState(false);
  const [settingMessage, setSettingMessage] = useState('');
  const [settingError, setSettingError] = useState('');
  const [scoreSyncEnabled, setScoreSyncEnabled] = useState(true);
  const [scoreSyncUpdatedAt, setScoreSyncUpdatedAt] = useState<string | null>(null);
  const [scoreSyncSaving, setScoreSyncSaving] = useState(false);
  const [scoreSyncMessage, setScoreSyncMessage] = useState('');
  const [scoreSyncError, setScoreSyncError] = useState('');

  async function loadAdminData() {
    setLoading(true);
    try {
      const [teamsResult, usersResult, predictionSettings, scoreSyncSettings] = await Promise.all([
        api.adminTeams(),
        api.adminUsers(),
        api.adminPredictionSettings(),
        api.adminScoreSyncSettings(),
      ]);
      setTeams(teamsResult.teams);
      setUsers(usersResult.users);
      setHomeTeamCode((current) => current || teamsResult.teams[0]?.code || '');
      setAwayTeamCode((current) => current || teamsResult.teams[1]?.code || '');
      setPredictionCloseMinutes(String(predictionSettings.predictionCloseMinutes));
      setScoreSyncEnabled(scoreSyncSettings.enabled);
      setScoreSyncUpdatedAt(scoreSyncSettings.updatedAt ?? null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Não foi possível carregar dados administrativos.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAdminData();
  }, [refreshVersion]);

  async function seedOfficialData() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.seedWorldCup2026();
      setMessage(`Tabela importada: ${result.teams} seleções e ${result.matches} jogos salvos.`);
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível importar a tabela.');
    } finally {
      setSaving(false);
    }
  }

  async function createMatch() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.createAdminMatch({
        homeTeamCode,
        awayTeamCode,
        startsAt: `${startsAt}:00-03:00`,
      });
      setMessage('Jogo cadastrado com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível cadastrar o jogo.');
    } finally {
      setSaving(false);
    }
  }

  async function savePredictionDeadline(minutesValue = predictionCloseMinutes) {
    const minutes = Number(minutesValue);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
      setSettingError('Informe um numero inteiro entre 1 e 120 minutos.');
      return;
    }
    setSettingSaving(true);
    setSettingError('');
    setSettingMessage('');
    try {
      const result = await api.updateAdminPredictionSettings(minutes);
      setPredictionCloseMinutes(String(result.predictionCloseMinutes));
      setSettingMessage(
        `Prazo atualizado. ${result.reopenedMatches ?? 0} jogo(s) reaberto(s) e ${result.closedMatches ?? 0} fechado(s).`,
      );
    } catch (err) {
      setSettingError(err instanceof Error ? err.message : 'Não foi possível atualizar o prazo.');
    } finally {
      setSettingSaving(false);
    }
  }

  async function toggleScoreSync(enabled: boolean) {
    setScoreSyncSaving(true);
    setScoreSyncError('');
    setScoreSyncMessage('');
    try {
      const result = await api.updateAdminScoreSyncSettings(enabled);
      setScoreSyncEnabled(result.enabled);
      setScoreSyncUpdatedAt(result.updatedAt ?? null);
      setScoreSyncMessage(
        result.enabled
          ? 'Atualização automática ativada. O coletor voltará a consultar o GE no próximo ciclo.'
          : 'Atualização automática desativada. O coletor continuará aberto, mas não fará novas raspagens.',
      );
    } catch (err) {
      setScoreSyncError(
        err instanceof Error ? err.message : 'Não foi possível alterar a atualização automática.',
      );
    } finally {
      setScoreSyncSaving(false);
    }
  }

  async function toggleUserStatus(targetUser: User) {
    setUserSaving(targetUser.id);
    setUserError('');
    setUserMessage('');
    try {
      const blocked = targetUser.status !== 'BLOCKED';
      const result = await api.setAdminUserStatus(targetUser.id, blocked);
      setUsers((current) =>
        current.map((user) => (user.id === targetUser.id ? result.user : user)),
      );
      setUserMessage(blocked ? 'Usuário bloqueado.' : 'Usuário desbloqueado.');
    } catch (err) {
      setUserError(err instanceof Error ? err.message : 'Não foi possível alterar o usuário.');
    } finally {
      setUserSaving(null);
    }
  }

  async function resetPassword(targetUser: User) {
    const password = passwords[targetUser.id] ?? '';
    if (password.length < 6) {
      setUserError('A nova senha precisa ter pelo menos 6 caracteres.');
      return;
    }

    setUserSaving(targetUser.id);
    setUserError('');
    setUserMessage('');
    try {
      await api.resetAdminUserPassword(targetUser.id, password);
      setPasswords((current) => ({ ...current, [targetUser.id]: '' }));
      setUserMessage(`Senha de ${targetUser.nickname} alterada com sucesso.`);
    } catch (err) {
      setUserError(err instanceof Error ? err.message : 'Não foi possível alterar a senha.');
    } finally {
      setUserSaving(null);
    }
  }

  if (loading) return <ActivityIndicator color={colors.green} style={styles.loader} />;

  return (
    <View style={styles.contentGrid}>
      <Suspense fallback={<ActivityIndicator color={colors.green} style={styles.loader} />}>
        <AdminOperationsPanel />
      </Suspense>
      {legacyAdminMutations ? (
        <>
          <BrasileiraoCanaryAdmin />
          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.sectionTitle}>Admin</Text>
              <Text style={styles.muted}>
                A tabela fica salva no banco. A API externa foi removida do fluxo ativo.
              </Text>
            </View>
            <PrimaryButton
              label={saving ? 'Aguarde...' : 'Importar Copa 2026'}
              icon="download-outline"
              onPress={seedOfficialData}
              disabled={saving}
            />
            <Text style={styles.muted}>
              Fonte usada para a carga local: calendário publicado pelo GE e conferência na página
              de jogos da FIFA.
            </Text>
          </View>

          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.sectionTitle}>Prazo dos palpites</Text>
              <Text style={styles.muted}>
                Aplica o fechamento antes de cada partida e ao primeiro jogo da chave oficial.
              </Text>
            </View>
            <View style={styles.deadlinePresetRow}>
              {[5, 10, 15, 30].map((minutes) => {
                const selected = predictionCloseMinutes === String(minutes);
                return (
                  <Pressable
                    key={minutes}
                    onPress={() => {
                      setPredictionCloseMinutes(String(minutes));
                      void savePredictionDeadline(String(minutes));
                    }}
                    disabled={settingSaving}
                    style={[styles.deadlinePreset, selected && styles.deadlinePresetActive]}
                  >
                    <Text
                      style={[
                        styles.deadlinePresetText,
                        selected && styles.deadlinePresetTextActive,
                      ]}
                    >
                      {minutes} min
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Field
              label="Prazo personalizado"
              value={predictionCloseMinutes}
              onChangeText={setPredictionCloseMinutes}
              placeholder="5"
              keyboardType="number-pad"
              help="Aceita valores inteiros de 1 a 120 minutos. A alteração entra em vigor imediatamente."
            />
            <PrimaryButton
              label={settingSaving ? 'Atualizando...' : 'Aplicar prazo'}
              icon="time-outline"
              onPress={() => savePredictionDeadline()}
              disabled={settingSaving}
            />
            {settingMessage ? <Text style={styles.successText}>{settingMessage}</Text> : null}
            {settingError ? <Text style={styles.errorText}>{settingError}</Text> : null}
          </View>

          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.sectionTitle}>Atualização dos dados</Text>
              <Text style={styles.muted}>
                Controla a raspagem automática dos placares e da artilharia no GE. Quando estiver
                desativada, o script pode continuar rodando, mas ficará em pausa.
              </Text>
            </View>
            <View style={styles.rowBetween}>
              <View style={styles.statusSummary}>
                <Pill
                  label={scoreSyncEnabled ? 'Atualização ativa' : 'Atualização pausada'}
                  tone={scoreSyncEnabled ? 'ok' : 'warn'}
                />
                <Text style={styles.muted}>
                  {scoreSyncUpdatedAt
                    ? `Última alteração: ${dateTime(scoreSyncUpdatedAt)}`
                    : 'Sem alteração registrada.'}
                </Text>
              </View>
              <PrimaryButton
                label={
                  scoreSyncSaving
                    ? 'Atualizando...'
                    : scoreSyncEnabled
                      ? 'Desativar atualização'
                      : 'Ativar atualização'
                }
                icon={scoreSyncEnabled ? 'pause-circle-outline' : 'play-circle-outline'}
                tone={scoreSyncEnabled ? 'danger' : 'primary'}
                onPress={() => toggleScoreSync(!scoreSyncEnabled)}
                disabled={scoreSyncSaving}
              />
            </View>
            <PrimaryButton
              label="Rodar uma vez pelo terminal"
              icon="terminal-outline"
              tone="secondary"
              onPress={() =>
                setScoreSyncMessage(
                  'Use o arquivo scripts\\\\rodar-atualizacao-ge-uma-vez.bat ou o comando npm run scrape:ge-scores:once.',
                )
              }
            />
            {scoreSyncMessage ? <Text style={styles.successText}>{scoreSyncMessage}</Text> : null}
            {scoreSyncError ? <Text style={styles.errorText}>{scoreSyncError}</Text> : null}
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Cadastrar jogo</Text>
            <Field
              label="Data e hora de Brasília"
              value={startsAt}
              onChangeText={setStartsAt}
              placeholder="2026-06-11T16:00"
              help="Formato: AAAA-MM-DDTHH:mm. Exemplo: 2026-06-13T19:00."
            />
            <TeamSelector
              label="Mandante"
              teams={teams}
              selectedCode={homeTeamCode}
              onSelect={setHomeTeamCode}
            />
            <TeamSelector
              label="Visitante"
              teams={teams}
              selectedCode={awayTeamCode}
              onSelect={setAwayTeamCode}
            />
            <PrimaryButton
              label={saving ? 'Salvando...' : 'Cadastrar jogo'}
              icon="add-circle-outline"
              onPress={createMatch}
              disabled={saving || !homeTeamCode || !awayTeamCode}
            />
            {message ? <Text style={styles.successText}>{message}</Text> : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>

          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.sectionTitle}>Usuarios</Text>
              <Text style={styles.muted}>
                Administradores visualizam e gerenciam contas, mas não entram no ranking nem
                participam dos palpites.
              </Text>
            </View>
            <View style={styles.userList}>
              {users.map((managedUser) => {
                const isSelf = managedUser.id === currentUserId;
                const isBlocked = managedUser.status === 'BLOCKED';
                const busy = userSaving === managedUser.id;
                return (
                  <View key={managedUser.id} style={styles.userAdminRow}>
                    <View style={styles.userAdminInfo}>
                      <View style={styles.rowBetween}>
                        <Text style={styles.matchTitle}>{managedUser.nickname}</Text>
                        <Pill
                          label={
                            managedUser.role === 'ADMIN'
                              ? 'Admin'
                              : isBlocked
                                ? 'Bloqueado'
                                : 'Usuário'
                          }
                          tone={managedUser.role === 'ADMIN' ? 'warn' : isBlocked ? 'live' : 'ok'}
                        />
                      </View>
                      <Text style={styles.muted}>{managedUser.username}</Text>
                    </View>
                    <View style={styles.userAdminActions}>
                      <Field
                        label="Nova senha"
                        value={passwords[managedUser.id] ?? ''}
                        onChangeText={(value) =>
                          setPasswords((current) => ({ ...current, [managedUser.id]: value }))
                        }
                        secureTextEntry
                        placeholder="mínimo 6 caracteres"
                      />
                      <View style={styles.userActionButtons}>
                        <PrimaryButton
                          label={busy ? 'Salvando...' : 'Alterar senha'}
                          icon="key-outline"
                          onPress={() => resetPassword(managedUser)}
                          disabled={busy}
                        />
                        <PrimaryButton
                          label={isBlocked ? 'Desbloquear' : 'Bloquear'}
                          icon={isBlocked ? 'lock-open-outline' : 'lock-closed-outline'}
                          onPress={() => toggleUserStatus(managedUser)}
                          disabled={busy || isSelf}
                        />
                      </View>
                      {isSelf ? (
                        <Text style={styles.muted}>Sua própria conta não pode ser bloqueada.</Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
            {userMessage ? <Text style={styles.successText}>{userMessage}</Text> : null}
            {userError ? <Text style={styles.errorText}>{userError}</Text> : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

function TeamSelector({
  label,
  teams,
  selectedCode,
  onSelect,
}: {
  label: string;
  teams: Team[];
  selectedCode: string;
  onSelect: (code: string) => void;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView style={styles.teamGrid} nestedScrollEnabled>
        {teams.map((team) => {
          const selected = team.code === selectedCode;
          return (
            <Pressable
              key={team.id}
              onPress={() => onSelect(team.code ?? '')}
              style={[styles.teamOption, selected && styles.teamOptionActive]}
            >
              <View style={styles.teamFlag}>
                <TeamFlag team={team} size={17} />
              </View>
              <Text style={styles.teamOptionText}>{team.name}</Text>
              <Text style={styles.teamCode}>{team.code}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const rankingStatusOptions: Array<{ key: RankingStatusFilter; label: string }> = [
  { key: 'all', label: 'Todos' },
  { key: 'live', label: 'Ao vivo' },
  { key: 'final', label: 'Definitivos' },
];

const rankingPeriodOptions: Array<{ key: RankingPeriod; label: string }> = [
  { key: 'all', label: 'Geral' },
  { key: 'week', label: 'Semanal' },
  { key: 'day', label: 'Dia' },
];

function RankingStatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <View {...rankingGsapTarget('stat')} style={styles.rankingStatCard}>
      <Text style={styles.rankingStatLabel}>{label}</Text>
      <Text style={styles.rankingStatValue}>{value}</Text>
      <Text style={styles.rankingStatDetail}>{detail}</Text>
    </View>
  );
}

function RankingPodiumCard({
  row,
  place,
  movement,
}: {
  row: RankingRow;
  place: 1 | 2 | 3;
  movement?: number | null;
}) {
  const labels = {
    1: '1º lugar',
    2: '2º lugar',
    3: '3º lugar',
  } as const;

  return (
    <View
      style={[
        styles.rankingPodiumCard,
        place === 1 && styles.rankingPodiumCardFirst,
        place === 2 && styles.rankingPodiumCardSecond,
        place === 3 && styles.rankingPodiumCardThird,
      ]}
    >
      <Text style={styles.rankingPodiumGhostRank}>{place}</Text>
      <Text style={styles.rankingPodiumLabel}>{labels[place]}</Text>
      <View style={styles.rankingPodiumIdentity}>
        <UserAvatar nickname={row.nickname} avatarUrl={row.avatarUrl} size={48} />
        <View style={styles.rankingPodiumInfo}>
          <Text style={styles.rankingPodiumName} numberOfLines={1}>
            {row.nickname}
          </Text>
          <Text style={styles.rankingPodiumMeta}>
            {row.hasLiveData ? 'Provisorio' : 'Definitivo'} · {row.exactScores} exato(s)
          </Text>
        </View>
      </View>
      <RankingMovementBadge delta={movement ?? null} />
      <Text style={styles.rankingPodiumPoints}>{row.points} pts</Text>
      <LastFive values={row.lastFive} matches={row.lastFiveMatches} />
    </View>
  );
}

const trophyStatusLabels: Record<RankingAward['status'], string> = {
  locked: 'Conquistado',
  live: 'Em disputa',
  pending: 'Aguardando',
  empty: 'Bloqueado',
};

function trophyFallbackText(status: RankingAward['status']) {
  if (status === 'live') return 'apuracao em andamento';
  if (status === 'empty') return 'sem jogos finalizados';
  return 'sem pontuacao definida';
}

function trophyIconName(icon: string): keyof typeof Ionicons.glyphMap {
  return icon in Ionicons.glyphMap ? (icon as keyof typeof Ionicons.glyphMap) : 'trophy-outline';
}

function rankingGsapTarget(name: string) {
  return Platform.OS === 'web' ? ({ dataSet: { rankingGsap: name } } as never) : {};
}

function useRankingGsap(animationKey: string) {
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    let context: { revert: () => void } | undefined;
    let cancelled = false;

    void import('gsap').then((module) => {
      if (cancelled) return;
      const gsap = module.gsap;
      const root = document.querySelector('[data-ranking-gsap="page"]');
      if (!root) return;

      context = gsap.context(() => {
        const entranceTargets = [
          '[data-ranking-gsap="head"]',
          '[data-ranking-gsap="stat"]',
          '[data-ranking-gsap="podium"]',
          '[data-ranking-gsap="table"]',
          '[data-ranking-gsap="side"]',
        ];

        gsap.from(entranceTargets, {
          opacity: 0,
          y: 12,
          duration: 0.38,
          stagger: 0.045,
          ease: 'power2.out',
          clearProps: 'opacity,transform',
        });

        gsap.from('[data-ranking-gsap="award"]', {
          opacity: 0,
          y: 10,
          duration: 0.32,
          stagger: 0.035,
          delay: 0.08,
          ease: 'power2.out',
          clearProps: 'opacity,transform',
        });

        gsap.from('[data-ranking-gsap="row"]', {
          opacity: 0,
          y: 6,
          duration: 0.26,
          stagger: 0.018,
          delay: 0.05,
          ease: 'power2.out',
          clearProps: 'opacity,transform',
        });

        gsap.to('[data-ranking-award-state="live"]', {
          boxShadow: '0 0 0 1px rgba(47,191,122,0.55), 0 0 20px rgba(47,191,122,0.18)',
          duration: 0.42,
          yoyo: true,
          repeat: 1,
          ease: 'power2.out',
          clearProps: 'boxShadow',
        });
      }, root);
    });

    return () => {
      cancelled = true;
      context?.revert();
    };
  }, [animationKey]);
}

function TrophyAwardCard({ award, featured = false }: { award: RankingAward; featured?: boolean }) {
  const winner = award.winner;
  const major = award.tier === 'major';
  const iconSize = featured ? 34 : major ? 25 : 22;
  const iconColor = award.status === 'empty' || award.status === 'pending' ? '#bbd0c6' : '#071311';

  return (
    <View
      {...(Platform.OS === 'web'
        ? ({ dataSet: { rankingGsap: 'award', rankingAwardState: award.status } } as never)
        : {})}
      style={[
        styles.trophyAwardCard,
        !featured && styles.trophyAwardGridItem,
        featured && styles.trophyAwardCardFeatured,
        major && !featured && styles.trophyAwardCardMajor,
        award.status === 'locked' && styles.trophyAwardLocked,
        award.status === 'live' && styles.trophyAwardLive,
        award.status === 'pending' && styles.trophyAwardPending,
        award.status === 'empty' && styles.trophyAwardEmpty,
      ]}
    >
      <View style={styles.trophyAwardTop}>
        <View
          style={[
            styles.trophyIcon,
            featured && styles.trophyIconFeatured,
            (award.status === 'pending' || award.status === 'empty') && styles.trophyIconMuted,
          ]}
        >
          <Ionicons name={trophyIconName(award.icon)} size={iconSize} color={iconColor} />
        </View>
        <View style={styles.trophyAwardCopy}>
          <Text style={styles.trophyAwardLabel} numberOfLines={featured ? 1 : 2}>
            {featured ? 'Trofeu maximo' : award.subtitle}
          </Text>
          <Text
            style={[styles.trophyAwardTitle, featured && styles.trophyAwardTitleFeatured]}
            numberOfLines={2}
          >
            {award.title}
          </Text>
          {featured ? (
            <Text style={styles.trophyAwardSubtitle} numberOfLines={1}>
              {award.subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.trophyWinnerRow}>
        {winner ? (
          <>
            <UserAvatar
              nickname={winner.nickname}
              avatarUrl={winner.avatarUrl}
              size={featured ? 42 : 30}
            />
            <View style={styles.trophyWinnerCopy}>
              <Text style={styles.trophyWinnerName} numberOfLines={1}>
                {winner.nickname}
              </Text>
              <Text style={styles.trophyWinnerMeta} numberOfLines={featured ? 2 : 1}>
                {winner.points} pts - {winner.exactScores} EX - {winner.resultHits} RES
              </Text>
            </View>
          </>
        ) : (
          <>
            <View style={[styles.userAvatarFallback, styles.trophyPlaceholderAvatar]}>
              <Text style={styles.userAvatarText}>?</Text>
            </View>
            <View style={styles.trophyWinnerCopy}>
              <Text style={styles.trophyWinnerName}>Aguardando</Text>
              <Text style={styles.trophyWinnerMeta} numberOfLines={1}>
                {trophyFallbackText(award.status)}
              </Text>
            </View>
          </>
        )}
      </View>

      <View
        style={[
          styles.trophyStatusBadge,
          award.status === 'locked' && styles.trophyStatusBadgeLocked,
          award.status === 'live' && styles.trophyStatusBadgeLive,
          (award.status === 'pending' || award.status === 'empty') && styles.trophyStatusBadgeMuted,
        ]}
      >
        <Text
          style={[
            styles.trophyStatusText,
            award.status === 'locked' && styles.trophyStatusTextLocked,
            award.status === 'live' && styles.trophyStatusTextLive,
          ]}
        >
          {trophyStatusLabels[award.status]}
        </Text>
      </View>
    </View>
  );
}

function TrophyShelf({
  awards,
  loading,
  wide = false,
}: {
  awards: RankingAward[];
  loading: boolean;
  wide?: boolean;
}) {
  const featuredAward = awards.find((award) => award.tier === 'legendary') ?? awards[0];
  const otherAwards = awards.filter((award) => award.key !== featuredAward?.key);
  const lockedCount = awards.filter((award) => award.status === 'locked').length;
  const totalCount = awards.length || 11;

  return (
    <View
      style={[
        styles.rankingSidePanel,
        styles.trophyShelfPanel,
        wide && styles.trophyShelfPanelWide,
      ]}
    >
      <View style={styles.trophyShelfHeader}>
        <View style={styles.trophyShelfTitleBlock}>
          <Text style={styles.rankingSideTitle}>Estante de Trofeus</Text>
          <Text style={styles.rankingSideText}>
            Conquistas por rodada, eliminatorias e classificacao geral.
          </Text>
        </View>
        <View style={styles.trophyShelfCounter}>
          <Text style={styles.trophyShelfCounterText}>
            {lockedCount}/{totalCount}
          </Text>
        </View>
      </View>

      {loading ? <ActivityIndicator color={colors.gold} style={styles.loaderInline} /> : null}

      {featuredAward ? <TrophyAwardCard award={featuredAward} featured /> : null}

      <View style={styles.trophyAwardGrid}>
        {otherAwards.map((award) => (
          <TrophyAwardCard key={award.key} award={award} />
        ))}
      </View>
    </View>
  );
}

function RankingScreenLayout({
  refreshVersion,
  currentUserId,
}: {
  refreshVersion: number;
  currentUserId: string;
}) {
  const { width } = useWindowDimensions();
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [overallRanking, setOverallRanking] = useState<RankingRow[]>([]);
  const [awards, setAwards] = useState<RankingAward[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RankingStatusFilter>('all');
  const [periodFilter, setPeriodFilter] = useState<RankingPeriod>('all');
  const reducedMotion = usePrefersReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;

  const isCompact = width < 760;
  const stackTools = width < 980;
  const sidebarBelow = width < 1180;

  const loadRanking = useCallback(
    async (mode: 'blocking' | 'quiet' | 'refresh' = 'blocking') => {
      if (mode === 'blocking') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      if (mode !== 'quiet') setError('');

      try {
        const [result, overallResult, awardsResult] = await Promise.all([
          mode === 'refresh' ? api.refreshRanking(periodFilter) : api.ranking(periodFilter),
          periodFilter === 'all' ? Promise.resolve(null) : api.ranking('all'),
          api.rankingAwards(),
        ]);
        setRanking(result.ranking);
        setOverallRanking(overallResult?.ranking ?? result.ranking);
        setAwards(awardsResult.awards);
        if (mode === 'quiet') setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Nao foi possivel carregar o ranking.');
      } finally {
        if (mode === 'blocking') setLoading(false);
        if (mode === 'refresh') setRefreshing(false);
      }
    },
    [periodFilter],
  );

  useEffect(() => {
    void loadRanking();
  }, [loadRanking, refreshVersion]);

  useEffect(() => {
    const source = createRankingEvents(() => {
      void loadRanking('quiet');
    });
    return () => source.close();
  }, [loadRanking]);

  useEffect(() => {
    if (reducedMotion) {
      pulse.setValue(1);
      return undefined;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.05,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reducedMotion]);

  const leader = ranking[0];
  const last = ranking[ranking.length - 1];
  const currentUserRow = ranking.find((row) => row.userId === currentUserId);
  const liveCount = ranking.filter((row) => row.hasLiveData).length;
  const scopedRanking = useMemo(() => {
    return ranking.filter((row) => {
      if (statusFilter === 'live' && !row.hasLiveData) return false;
      if (statusFilter === 'final' && row.hasLiveData) return false;
      return true;
    });
  }, [ranking, statusFilter]);
  const filteredRanking = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scopedRanking.filter((row) => {
      if (query && !row.nickname.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [scopedRanking, search]);
  const periodRankMap = useMemo(
    () => new Map(ranking.map((row, index) => [row.userId, index + 1])),
    [ranking],
  );
  const overallRankMap = useMemo(
    () => new Map(overallRanking.map((row, index) => [row.userId, index + 1])),
    [overallRanking],
  );
  const scopedRankMap = useMemo(
    () => new Map(scopedRanking.map((row, index) => [row.userId, index + 1])),
    [scopedRanking],
  );
  const showMovement = periodFilter !== 'all' || statusFilter === 'live';
  const movementBaseMap =
    statusFilter !== 'all' ? periodRankMap : periodFilter !== 'all' ? overallRankMap : null;
  const currentMovementRankMap = statusFilter !== 'all' ? scopedRankMap : periodRankMap;
  const movementByUserId = useMemo(() => {
    const next = new Map<string, number | null>();
    for (const row of ranking) {
      if (!showMovement || !movementBaseMap) {
        next.set(row.userId, null);
        continue;
      }
      const currentRank = currentMovementRankMap.get(row.userId);
      const baseRank = movementBaseMap.get(row.userId);
      next.set(row.userId, currentRank && baseRank ? baseRank - currentRank : null);
    }
    return next;
  }, [ranking, showMovement, movementBaseMap, currentMovementRankMap]);
  const podiumSeed = filteredRanking.length >= 3 ? filteredRanking : scopedRanking;
  const podiumRows = podiumSeed.slice(0, 3);
  const podiumLayout =
    podiumRows.length === 3 && !isCompact
      ? [
          { row: podiumRows[1], place: 2 as const },
          { row: podiumRows[0], place: 1 as const },
          { row: podiumRows[2], place: 3 as const },
        ]
      : podiumRows.map((row, index) => ({ row, place: (index + 1) as 1 | 2 | 3 }));
  const exactLeader = ranking.reduce<RankingRow | undefined>(
    (best, row) => (!best || row.exactScores > best.exactScores ? row : best),
    undefined,
  );
  const averagePoints = ranking.length
    ? new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      }).format(ranking.reduce((sum, row) => sum + row.points, 0) / ranking.length)
    : '--';
  const scopeTitle =
    periodFilter === 'week'
      ? 'Ranking semanal'
      : periodFilter === 'day'
        ? 'Ranking do dia'
        : 'Ranking ao vivo';
  const scopeDescription =
    periodFilter === 'week'
      ? 'Veja quem mais pontuou na semana atual e acompanhe variacoes provisórias da rodada.'
      : periodFilter === 'day'
        ? 'Compare quem mais pontuou hoje e acompanhe ajustes em tempo real das partidas do dia.'
        : 'Acompanhe lideranca, provisoes em tempo real e o desempenho recente de cada participante.';
  const scopeRefreshText = 'Atualizacao manual';
  const scopeFooterText =
    periodFilter === 'week'
      ? 'Sem partidas ao vivo neste recorte. O ranking abaixo reflete apenas resultados consolidados da semana atual.'
      : periodFilter === 'day'
        ? 'Sem partidas ao vivo neste recorte. O ranking abaixo reflete apenas resultados consolidados do dia.'
        : 'Sem partidas ao vivo neste momento. O ranking abaixo reflete apenas resultados consolidados.';
  const noResultsMessage =
    ranking.length === 0
      ? 'Ranking vazio por enquanto.'
      : 'Nenhum participante encontrado para o filtro aplicado.';
  const rankingAnimationKey = [
    periodFilter,
    statusFilter,
    search,
    awards.length,
    filteredRanking.map((row) => `${row.userId}:${row.rank}:${row.points}`).join('|'),
  ].join('/');

  useRankingGsap(rankingAnimationKey);

  return (
    <View {...rankingGsapTarget('page')} style={styles.rankingPage}>
      <View
        {...rankingGsapTarget('head')}
        style={[styles.rankingHead, stackTools && styles.rankingHeadCompact]}
      >
        <View style={styles.rankingHeadCopy}>
          <Text role="heading" aria-level={1} style={styles.sectionTitle}>
            {scopeTitle}
          </Text>
          <Text style={styles.rankingHeadText}>{scopeDescription}</Text>
          <View style={styles.rankingBadgeRow}>
            <Animated.View style={[styles.rankingLiveBadge, { transform: [{ scale: pulse }] }]}>
              <Text style={styles.rankingLiveBadgeText}>{scopeRefreshText}</Text>
            </Animated.View>
            <View
              style={[
                styles.rankingContextBadge,
                liveCount > 0
                  ? styles.rankingContextBadgePositive
                  : styles.rankingContextBadgeNeutral,
              ]}
            >
              <Text style={styles.rankingContextBadgeText}>
                {liveCount > 0 ? `${liveCount} com jogos em andamento` : 'Sem jogos ao vivo'}
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.rankingTools, stackTools && styles.rankingToolsCompact]}>
          <View style={styles.rankingSegmentedControl}>
            {rankingStatusOptions.map((option) => {
              const active = statusFilter === option.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setStatusFilter(option.key)}
                  style={[
                    styles.rankingSegmentedButton,
                    active && styles.rankingSegmentedButtonActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.rankingSegmentedText,
                      active && styles.rankingSegmentedTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.rankingSegmentedControl}>
            {rankingPeriodOptions.map((option) => {
              const active = periodFilter === option.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setPeriodFilter(option.key)}
                  style={[
                    styles.rankingSegmentedButton,
                    active && styles.rankingSegmentedButtonActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.rankingSegmentedText,
                      active && styles.rankingSegmentedTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.rankingSearchField}>
            <Ionicons name="search-outline" size={16} color={colors.muted} />
            <TextInput
              style={styles.rankingSearchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar jogador"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <PrimaryButton
            label={refreshing ? 'Sincronizando' : loading ? 'Carregando' : 'Atualizar'}
            onPress={() => void loadRanking('refresh')}
            tone="secondary"
            icon="refresh-outline"
            disabled={loading || refreshing}
          />
        </View>
      </View>

      <View style={styles.rankingStatsGrid}>
        <RankingStatCard
          label="Participantes"
          value={`${ranking.length}`}
          detail={`${filteredRanking.length} visiveis no recorte atual`}
        />
        <RankingStatCard
          label="Sua posicao"
          value={currentUserRow ? `#${currentUserRow.rank}` : '--'}
          detail={
            currentUserRow ? `${currentUserRow.points} pts no recorte` : 'Sem pontuacao no recorte'
          }
        />
        <RankingStatCard
          label="Pontos do lider"
          value={leader ? `${leader.points}` : '--'}
          detail={leader ? leader.nickname : 'Aguardando pontuacoes'}
        />
        <RankingStatCard
          label="Media geral"
          value={`${averagePoints}`}
          detail={
            liveCount > 0
              ? `${liveCount} posicoes provisoria(s)`
              : periodFilter === 'all'
                ? 'Tudo definitivo no momento'
                : 'Recorte consolidado no momento'
          }
        />
        <RankingStatCard
          label="Mais exatos"
          value={exactLeader ? `${exactLeader.exactScores}` : '--'}
          detail={exactLeader ? exactLeader.nickname : 'Sem dados ainda'}
        />
      </View>

      <View style={[styles.rankingMainGrid, sidebarBelow && styles.rankingMainGridCompact]}>
        <View style={styles.rankingPrimaryColumn}>
          {podiumRows.length > 0 ? (
            <View
              {...rankingGsapTarget('podium')}
              style={[styles.rankingPodiumGrid, isCompact && styles.rankingPodiumGridCompact]}
            >
              {podiumLayout.map(({ row, place }) => (
                <RankingPodiumCard
                  key={row.userId}
                  row={row}
                  place={place}
                  movement={movementByUserId.get(row.userId) ?? null}
                />
              ))}
            </View>
          ) : null}

          <View {...rankingGsapTarget('table')} style={styles.rankingTablePanel}>
            <View style={styles.rankingTableHeaderRow}>
              <View>
                <Text style={styles.rankingTableTitle}>Classificacao completa</Text>
                <Text style={styles.rankingTableSubtitle}>
                  {filteredRanking.length} participante(s) exibido(s) na tabela.
                </Text>
              </View>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>

            {loading ? (
              <ActivityIndicator color={colors.green} style={styles.loaderInline} />
            ) : null}

            {filteredRanking.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.rankingTableScroller}
                contentContainerStyle={styles.rankingTableScrollerContent}
              >
                <View style={styles.rankingTable}>
                  <View style={[styles.rankingTableRow, styles.rankingTableHeader]}>
                    <Text style={[styles.rankingCell, styles.rankColumn]}>#</Text>
                    <Text style={[styles.rankingCell, styles.playerColumn]}>Jogador</Text>
                    <Text style={[styles.rankingCell, styles.numericColumn]}>P</Text>
                    <Text style={[styles.rankingCell, styles.numericColumn]}>EX</Text>
                    <Text style={[styles.rankingCell, styles.numericColumn]}>RES</Text>
                    <Text style={[styles.rankingCell, styles.numericColumn]}>GOL</Text>
                    <Text style={[styles.rankingCell, styles.numericColumn]}>ER</Text>
                    <Text style={[styles.rankingCell, styles.formColumn]}>Ultimos 5</Text>
                    <Text style={[styles.rankingCell, styles.pointsColumn]}>PTS</Text>
                  </View>
                  {filteredRanking.map((row, index) => (
                    <View
                      {...rankingGsapTarget('row')}
                      key={row.userId}
                      style={[
                        styles.rankingTableRow,
                        index % 2 === 1 && styles.rankingTableRowAlt,
                        row.userId === currentUserId && styles.rankingTableRowCurrentUser,
                      ]}
                    >
                      <Text style={[styles.rankingCell, styles.rankColumn, styles.rankingRankText]}>
                        {row.rank}
                      </Text>
                      <View
                        style={[
                          styles.rankingCellBox,
                          styles.playerColumn,
                          styles.rankingPlayerCell,
                        ]}
                      >
                        <View style={styles.rankingPlayerAvatarGroup}>
                          <UserAvatar nickname={row.nickname} avatarUrl={row.avatarUrl} size={31} />
                          <RankingMovementBadge
                            delta={movementByUserId.get(row.userId) ?? null}
                            compact
                          />
                        </View>
                        <View style={styles.rankingPlayerInfo}>
                          <Text style={styles.rankingPlayerName} numberOfLines={1}>
                            {row.nickname}
                          </Text>
                          <Text style={styles.rankingPlayerStatus}>
                            {row.hasLiveData ? 'Provisorio' : 'Definitivo'}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.rankingCell, styles.numericColumn]}>{row.played}</Text>
                      <Text style={[styles.rankingCell, styles.numericColumn]}>
                        {row.exactScores}
                      </Text>
                      <Text style={[styles.rankingCell, styles.numericColumn]}>
                        {row.resultHits}
                      </Text>
                      <Text style={[styles.rankingCell, styles.numericColumn]}>
                        {row.oneGoalHits}
                      </Text>
                      <Text style={[styles.rankingCell, styles.numericColumn]}>{row.misses}</Text>
                      <View style={[styles.rankingCellBox, styles.formColumn]}>
                        <LastFive values={row.lastFive} matches={row.lastFiveMatches} />
                      </View>
                      <Text
                        style={[styles.rankingCell, styles.pointsColumn, styles.rankingPointsText]}
                      >
                        {row.points}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            ) : (
              <Text style={styles.muted}>{noResultsMessage}</Text>
            )}
          </View>

          <Text style={styles.rankingFooterNote}>
            {liveCount > 0
              ? 'Pontuacoes com jogos em andamento podem oscilar ate a confirmacao final dos resultados.'
              : scopeFooterText}
          </Text>
        </View>

        <View
          {...rankingGsapTarget('side')}
          style={[styles.rankingSidebar, sidebarBelow && styles.rankingSidebarBelow]}
        >
          <View style={[styles.rankingSidePanel, sidebarBelow && styles.rankingSidePanelBelow]}>
            <Text style={styles.rankingSideTitle}>Radar do ranking</Text>
            <Text style={styles.rankingSideText}>
              Veja quem abre a rodada em vantagem e quem ainda busca reagir.
            </Text>
            <View style={styles.rankingHighlightStack}>
              <RankingHighlight
                label="Lider"
                row={leader}
                icon="trophy-outline"
                tone="leader"
                movement={leader ? (movementByUserId.get(leader.userId) ?? null) : null}
              />
              {last && last.userId !== leader?.userId ? (
                <RankingHighlight
                  label="Lanterna"
                  row={last}
                  icon="flashlight-outline"
                  tone="last"
                  movement={movementByUserId.get(last.userId) ?? null}
                />
              ) : null}
            </View>
          </View>

          <TrophyShelf
            awards={awards}
            loading={loading && awards.length === 0}
            wide={sidebarBelow}
          />
          <View style={[styles.rankingSidePanel, sidebarBelow && styles.rankingSidePanelBelow]}>
            <Text style={styles.rankingSideTitle}>Criterios da tabela</Text>
            <View style={styles.rankingCriteriaList}>
              <View style={styles.rankingCriteriaRow}>
                <Text style={styles.rankingCriteriaKey}>EX</Text>
                <Text style={styles.rankingCriteriaText}>placares exatos acertados</Text>
              </View>
              <View style={styles.rankingCriteriaRow}>
                <Text style={styles.rankingCriteriaKey}>RES</Text>
                <Text style={styles.rankingCriteriaText}>resultado correto da partida</Text>
              </View>
              <View style={styles.rankingCriteriaRow}>
                <Text style={styles.rankingCriteriaKey}>GOL</Text>
                <Text style={styles.rankingCriteriaText}>gols de uma equipe acertados</Text>
              </View>
              <View style={styles.rankingCriteriaRow}>
                <Text style={styles.rankingCriteriaKey}>ER</Text>
                <Text style={styles.rankingCriteriaText}>palpites sem pontuacao</Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function RankingScreen({ refreshVersion }: { refreshVersion: number }) {
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const leader = ranking[0];
  const last = ranking[ranking.length - 1];

  useEffect(() => {
    api.ranking().then((result) => setRanking(result.ranking));
    const source = createRankingEvents(setRanking);
    return () => source.close();
  }, [refreshVersion]);

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text role="heading" aria-level={1} style={styles.sectionTitle}>
          Ranking ao vivo
        </Text>
        <Pill label="Atualização ativa" tone="live" />
      </View>

      {ranking.length > 0 ? (
        <View style={styles.rankingHighlights}>
          <RankingHighlight label="Líder" row={leader} icon="trophy-outline" tone="leader" />
          <RankingHighlight label="Lanterna" row={last} icon="flashlight-outline" tone="last" />
        </View>
      ) : null}

      {ranking.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.rankingTableScroller}
          contentContainerStyle={styles.rankingTableScrollerContent}
        >
          <View style={styles.rankingTable}>
            <View style={[styles.rankingTableRow, styles.rankingTableHeader]}>
              <Text style={[styles.rankingCell, styles.rankColumn]}>#</Text>
              <Text style={[styles.rankingCell, styles.playerColumn]}>Jogador</Text>
              <Text style={[styles.rankingCell, styles.numericColumn]}>P</Text>
              <Text style={[styles.rankingCell, styles.numericColumn]}>EX</Text>
              <Text style={[styles.rankingCell, styles.numericColumn]}>RES</Text>
              <Text style={[styles.rankingCell, styles.numericColumn]}>GOL</Text>
              <Text style={[styles.rankingCell, styles.numericColumn]}>ER</Text>
              <Text style={[styles.rankingCell, styles.formColumn]}>Últimos 5</Text>
              <Text style={[styles.rankingCell, styles.pointsColumn]}>PTS</Text>
            </View>
            {ranking.map((row) => (
              <View key={row.userId} style={styles.rankingTableRow}>
                <Text style={[styles.rankingCell, styles.rankColumn, styles.rankingRankText]}>
                  {row.rank}
                </Text>
                <View
                  style={[styles.rankingCellBox, styles.playerColumn, styles.rankingPlayerCell]}
                >
                  <View style={styles.rankingPlayerAvatarGroup}>
                    <UserAvatar nickname={row.nickname} avatarUrl={row.avatarUrl} size={34} />
                    <RankingMovementBadge
                      delta={movementByUserId.get(row.userId) ?? null}
                      compact
                    />
                  </View>
                  <View style={styles.rankingPlayerInfo}>
                    <Text style={styles.rankingPlayerName} numberOfLines={1}>
                      {row.nickname}
                    </Text>
                    <Text style={styles.rankingPlayerStatus}>
                      {row.hasLiveData ? 'Provisório' : 'Definitivo'}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.rankingCell, styles.numericColumn]}>{row.played}</Text>
                <Text style={[styles.rankingCell, styles.numericColumn]}>{row.exactScores}</Text>
                <Text style={[styles.rankingCell, styles.numericColumn]}>{row.resultHits}</Text>
                <Text style={[styles.rankingCell, styles.numericColumn]}>{row.oneGoalHits}</Text>
                <Text style={[styles.rankingCell, styles.numericColumn]}>{row.misses}</Text>
                <View style={[styles.rankingCellBox, styles.formColumn]}>
                  <LastFive values={row.lastFive} matches={row.lastFiveMatches} />
                </View>
                <Text style={[styles.rankingCell, styles.pointsColumn, styles.rankingPointsText]}>
                  {row.points}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}
      {ranking.length === 0 ? <Text style={styles.muted}>Ranking vazio por enquanto.</Text> : null}
    </View>
  );
}

void Header;
void RankingScreen;

function CupFormBadges({ values }: { values: Array<'W' | 'D' | 'L'> }) {
  const padded: Array<'W' | 'D' | 'L' | '-'> = [...values.slice(-5)];
  while (padded.length < 5) padded.unshift('-');

  return (
    <View style={styles.lastFiveList}>
      {padded.map((value, index) => {
        const label = value === 'W' ? 'V' : value === 'D' ? 'E' : value === 'L' ? 'D' : '-';
        return (
          <View
            key={`${index}-${value}`}
            style={[
              styles.cupFormBadge,
              value === 'W' && styles.cupFormWin,
              value === 'D' && styles.cupFormDraw,
              value === 'L' && styles.cupFormLoss,
              value === '-' && styles.lastFiveEmpty,
            ]}
          >
            <Text style={styles.lastFiveText}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function CupStandingTable({
  title,
  rows,
  onOpenTeam,
  fullWidth = false,
  highlightTopEight = false,
  showGroup = false,
  wideTable = false,
}: {
  title: string;
  rows: CupStandingRow[];
  onOpenTeam: (team: Team) => void;
  fullWidth?: boolean;
  highlightTopEight?: boolean;
  showGroup?: boolean;
  wideTable?: boolean;
}) {
  return (
    <View style={[styles.cupGroupBlock, fullWidth && styles.cupGroupBlockFull]}>
      <Text style={styles.cupGroupTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.cupTable, wideTable && styles.cupTableWide]}>
          <View style={[styles.cupTableRow, styles.cupTableHeader]}>
            <Text style={[styles.cupCell, styles.cupRankColumn]}>#</Text>
            <Text
              style={[styles.cupCell, styles.cupTeamColumn, fullWidth && styles.cupTeamColumnFull]}
            >
              Time
            </Text>
            <Text style={[styles.cupCell, styles.cupStatColumn]}>P</Text>
            <Text style={[styles.cupCell, styles.cupStatColumn]}>V</Text>
            <Text style={[styles.cupCell, styles.cupStatColumn]}>E</Text>
            <Text style={[styles.cupCell, styles.cupStatColumn]}>D</Text>
            <Text style={[styles.cupCell, styles.cupStatColumn]}>SG</Text>
            <Text style={[styles.cupCell, styles.cupStatColumn]}>GP</Text>
            <Text style={[styles.cupCell, styles.cupFormColumn]}>Últimos 5</Text>
            <Text style={[styles.cupCell, styles.cupPointsColumn]}>PTS</Text>
          </View>
          {rows.map((row, index) => (
            <View
              key={`${row.group}-${row.team.id}`}
              style={[
                styles.cupTableRow,
                highlightTopEight && index < 8 && styles.cupThirdQualifiedRow,
              ]}
            >
              <Text
                numberOfLines={1}
                style={[styles.cupCell, styles.cupRankColumn, styles.cupRankText]}
              >
                {row.rank}
              </Text>
              <View
                style={[
                  styles.cupCellBox,
                  styles.cupTeamColumn,
                  styles.cupTeamCell,
                  fullWidth && styles.cupTeamColumnFull,
                ]}
              >
                <TeamFlag team={row.team} />
                <View style={styles.cupThirdTeamCopy}>
                  <TeamNameButton team={row.team} onOpenTeam={onOpenTeam} singleLine />
                  {showGroup ? <Text style={styles.cupThirdGroup}>Grupo {row.group}</Text> : null}
                </View>
              </View>
              <Text style={[styles.cupCell, styles.cupStatColumn]}>{row.played}</Text>
              <Text style={[styles.cupCell, styles.cupStatColumn]}>{row.wins}</Text>
              <Text style={[styles.cupCell, styles.cupStatColumn]}>{row.draws}</Text>
              <Text style={[styles.cupCell, styles.cupStatColumn]}>{row.losses}</Text>
              <Text style={[styles.cupCell, styles.cupStatColumn]}>{row.goalDifference}</Text>
              <Text style={[styles.cupCell, styles.cupStatColumn]}>{row.goalsFor}</Text>
              <View style={[styles.cupCellBox, styles.cupFormColumn]}>
                <CupFormBadges values={row.lastFive} />
              </View>
              <Text style={[styles.cupCell, styles.cupPointsColumn, styles.cupPointsText]}>
                {row.points}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function CupMatchRow({
  match,
  onOpenTeam,
}: {
  match: CupMatchResult;
  onOpenTeam: (team: Team) => void;
}) {
  const score = matchScore(match);
  const meta = [match.round, match.group ? `Grupo ${match.group}` : null]
    .filter(Boolean)
    .join(' - ');

  return (
    <View style={styles.cupMatchRow}>
      <View style={styles.cupMatchDate}>
        <Text style={styles.matchTime}>
          {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(
            new Date(match.startsAt),
          )}
        </Text>
        <Text style={styles.muted}>
          {new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(
            new Date(match.startsAt),
          )}
        </Text>
      </View>
      <View style={styles.cupMatchMain}>
        <View style={styles.matchTeamsLine}>
          <TeamFlag team={match.homeTeam} />
          <TeamNameButton team={match.homeTeam} onOpenTeam={onOpenTeam} />
          <Text style={score ? styles.inlineScore : styles.matchTitle}>
            {score ? `${score.homeScore} x ${score.awayScore}` : 'x'}
          </Text>
          <TeamFlag team={match.awayTeam} />
          <TeamNameButton team={match.awayTeam} onOpenTeam={onOpenTeam} />
        </View>
        {meta ? <Text style={styles.muted}>{meta}</Text> : null}
        {score ? <Text style={styles.scoreStatusText}>{score.label}</Text> : null}
      </View>
      <Pill label={match.status} tone={match.status === 'LIVE' ? 'live' : 'neutral'} />
    </View>
  );
}

function CupOverviewScreen({
  refreshVersion,
  onOpenTeam,
}: {
  refreshVersion: number;
  onOpenTeam: (team: Team) => void;
}) {
  const { width } = useWindowDimensions();
  const [overview, setOverview] = useState<CupOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setOverview(await api.cupOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar a Copa.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [refreshVersion]);

  if (loading) return <ActivityIndicator color={colors.green} style={styles.loader} />;

  const scoredMatches =
    overview?.matches.filter((match) => match.homeScore != null && match.awayScore != null) ?? [];
  const upcomingMatches =
    overview?.matches
      .filter((match) => match.homeScore == null || match.awayScore == null)
      .slice(0, 24) ?? [];
  const thirdPlaced =
    overview?.standingsByGroup
      .map((group) => group.rows[2])
      .filter((row): row is CupStandingRow => Boolean(row))
      .sort(
        (rowA, rowB) =>
          rowB.points - rowA.points ||
          rowB.goalDifference - rowA.goalDifference ||
          rowB.goalsFor - rowA.goalsFor ||
          rowA.team.name.localeCompare(rowB.team.name, 'pt-BR'),
      )
      .map((row, index) => ({ ...row, rank: index + 1 })) ?? [];

  return (
    <View style={styles.contentGrid}>
      <View style={[styles.panel, styles.cupPanel]}>
        <View style={styles.panelHeader}>
          <Text role="heading" aria-level={1} style={styles.sectionTitle}>
            Copa do Mundo 2026
          </Text>
          <Text style={styles.muted}>Classificação por grupos, resultados e artilharia.</Text>
        </View>
        {overview ? (
          <View style={styles.cupSummaryRow}>
            <View style={styles.cupSummaryItem}>
              <Text style={styles.nextMatchLabel}>Grupos</Text>
              <Text style={styles.nextMatchTitle}>{overview.standingsByGroup.length}</Text>
            </View>
            <View style={styles.cupSummaryItem}>
              <Text style={styles.nextMatchLabel}>Jogos com placar</Text>
              <Text style={styles.nextMatchTitle}>{scoredMatches.length}</Text>
            </View>
            <View style={styles.cupSummaryItem}>
              <Text style={styles.nextMatchLabel}>Atualizado</Text>
              <Text style={styles.nextMatchTitle}>{dateTime(overview.checkedAt)}</Text>
            </View>
          </View>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      <View style={[styles.panel, styles.cupPanel]}>
        <View style={styles.panelHeader}>
          <Text style={styles.sectionTitle}>Classificação</Text>
          <Text style={styles.muted}>A tabela considera apenas partidas encerradas.</Text>
        </View>
        {overview?.standingsByGroup.length ? (
          <View style={[styles.cupGroupsList, width < 900 && styles.cupGroupsListSingle]}>
            {overview.standingsByGroup.map((group) => (
              <CupStandingTable
                key={group.group}
                title={group.group === 'Sem grupo' ? group.group : `Grupo ${group.group}`}
                rows={group.rows}
                onOpenTeam={onOpenTeam}
                fullWidth={width < 900}
              />
            ))}
          </View>
        ) : (
          <Text style={styles.muted}>Nenhum grupo cadastrado ainda.</Text>
        )}
        {thirdPlaced.length ? (
          <View style={styles.cupThirdPlacedWrapper}>
            <View style={styles.cupThirdPlacedHeading}>
              <Ionicons name="trophy-outline" size={22} color={colors.gold} />
              <View style={styles.cupThirdPlacedHeadingCopy}>
                <Text style={styles.sectionTitle}>Equipes terceiras colocadas</Text>
                <Text style={styles.muted}>As oito melhores avançam para a fase eliminatória.</Text>
              </View>
            </View>
            <CupStandingTable
              title="Classificação geral"
              rows={thirdPlaced}
              onOpenTeam={onOpenTeam}
              fullWidth
              highlightTopEight
              showGroup
              wideTable={width >= 900}
            />
          </View>
        ) : null}
      </View>

      <View style={[styles.panel, styles.cupPanel]}>
        <View style={styles.panelHeader}>
          <Text style={styles.sectionTitle}>Resultados</Text>
          <Text style={styles.muted}>
            Jogos com placar aparecem primeiro. A agenda futura fica logo abaixo.
          </Text>
        </View>
        <View style={styles.cupMatchesList}>
          {scoredMatches.map((match) => (
            <CupMatchRow key={match.id} match={match} onOpenTeam={onOpenTeam} />
          ))}
          {upcomingMatches.map((match) => (
            <CupMatchRow key={match.id} match={match} onOpenTeam={onOpenTeam} />
          ))}
        </View>
        {overview && scoredMatches.length === 0 && upcomingMatches.length === 0 ? (
          <Text style={styles.muted}>Nenhum jogo cadastrado ainda.</Text>
        ) : null}
      </View>

      <View style={[styles.panel, styles.cupPanel]}>
        <View style={styles.panelHeader}>
          <Text style={styles.sectionTitle}>Artilharia</Text>
          <Text style={styles.muted}>Lista de goleadores da competição.</Text>
        </View>
        {overview?.topScorers.length ? (
          <View style={styles.cupScorersTable}>
            {overview.topScorers.map((scorer) => (
              <View key={`${scorer.rank}-${scorer.playerName}`} style={styles.cupScorerRow}>
                <Text style={[styles.cupCell, styles.cupRankColumn, styles.cupRankText]}>
                  {scorer.rank}
                </Text>
                {scorer.imageUrl ? (
                  <Image
                    source={{ uri: scorer.imageUrl }}
                    style={styles.cupScorerAvatar}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.cupScorerAvatarFallback}>
                    <Text style={styles.playerAvatarText}>{initials(scorer.playerName)}</Text>
                  </View>
                )}
                <View style={styles.cupScorerInfo}>
                  <Text style={styles.rankingPlayerName}>{scorer.playerName}</Text>
                  <View style={styles.cupScorerTeamLine}>
                    {scorer.teamFlagUrl ? (
                      <Image
                        source={{ uri: scorer.teamFlagUrl }}
                        style={styles.cupScorerFlag}
                        resizeMode="cover"
                      />
                    ) : null}
                    <Text style={styles.muted}>
                      {[scorer.teamName, scorer.position].filter(Boolean).join(' - ')}
                    </Text>
                  </View>
                </View>
                <Text style={styles.cupPointsText}>{scorer.goals}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="football-outline" size={28} color={colors.gold} />
            <Text style={styles.emptyTitle}>Artilharia ainda sem dados</Text>
            <Text style={styles.muted}>
              A coleta usa a página da Copa no GE e será preenchida assim que o scraper encontrar
              goleadores.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function TeamCatalogScreen({
  selectedCode,
  onSelectTeamCode,
}: {
  selectedCode: string | null;
  onSelectTeamCode: (code: string) => void;
}) {
  const [catalog, setCatalog] = useState<Record<string, TeamCatalogEntry> | null>(null);

  useEffect(() => {
    let active = true;
    import('./src/teamCatalog').then((module) => {
      if (active) setCatalog(module.teamCatalogByCode);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!catalog) return <ActivityIndicator color={colors.green} style={styles.loader} />;
  const teams = Object.values(catalog);
  const selected = selectedCode ? catalog[selectedCode] : null;

  return (
    <View style={styles.contentGridSingle}>
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text role="heading" aria-level={1} style={styles.sectionTitle}>
            Times participantes
          </Text>
          <Text style={styles.muted}>
            Selecione um país para abrir ou fechar o elenco cadastrado.
          </Text>
        </View>

        <View style={styles.teamCatalogHero}>
          <View>
            <Text style={styles.teamCatalogEyebrow}>Elenco</Text>
            <Text style={styles.teamCatalogTitle}>{selected?.countryName ?? 'Seleções'}</Text>
          </View>
          <Pill label={`${teams.length} seleções`} tone="ok" />
        </View>

        <View style={styles.catalogAccordion}>
          {teams.map((team) => (
            <View key={team.code} style={styles.catalogTeamPanel}>
              <Pressable
                onPress={() => onSelectTeamCode(selected?.code === team.code ? '' : team.code)}
                style={[
                  styles.catalogTeamButton,
                  selected?.code === team.code && styles.catalogTeamButtonActive,
                ]}
              >
                <View style={styles.catalogTeamIdentity}>
                  {flagSources[team.iso2] ? (
                    <Image
                      source={flagSources[team.iso2]}
                      style={styles.catalogFlag}
                      resizeMode="cover"
                    />
                  ) : null}
                  <View>
                    <Text style={styles.catalogTeamButtonText}>{team.countryName}</Text>
                    <Text style={styles.teamCode}>{team.code}</Text>
                  </View>
                </View>
                <View style={styles.catalogTeamMeta}>
                  <Pill
                    label={`${team.players.length} jogadores`}
                    tone={team.players.length > 0 ? 'ok' : 'warn'}
                  />
                  <Ionicons
                    name={
                      selected?.code === team.code ? 'chevron-up-outline' : 'chevron-down-outline'
                    }
                    size={20}
                    color={colors.gold}
                  />
                </View>
              </Pressable>

              <DrawerReveal open={selected?.code === team.code} maxHeight={3600}>
                <View style={styles.catalogRoster}>
                  <Text style={styles.muted}>{team.sourceLabel}</Text>
                  <View style={styles.playerGrid}>
                    {team.players.map((player) => (
                      <View
                        key={`${team.code}-${player.number}-${player.name}`}
                        style={styles.playerCard}
                      >
                        {player.imageUrl ? (
                          <Image
                            source={{ uri: player.imageUrl }}
                            style={styles.playerAvatarImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={styles.playerAvatar}>
                            <Text style={styles.playerAvatarText}>
                              {player.name
                                .split(' ')
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((part) => part[0])
                                .join('')}
                            </Text>
                          </View>
                        )}
                        <View style={styles.playerInfo}>
                          <Text style={styles.playerName}>{player.name}</Text>
                          <Text style={styles.playerPosition}>{player.position}</Text>
                          <Text style={styles.muted}>
                            #{player.number}
                            {player.age ? ` | ${player.age} anos` : ''}
                            {player.club ? ` | ${player.club}` : ''}
                          </Text>
                        </View>
                      </View>
                    ))}
                    {team.players.length === 0 ? (
                      <Text style={styles.muted}>Elenco ainda não cadastrado.</Text>
                    ) : null}
                  </View>
                </View>
              </DrawerReveal>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [screen, setScreen] = useState<Screen>(initialAppScreen);
  const [leagueTeamId, setLeagueTeamId] = useState<string | null>(initialLeagueTeamId);
  const [selectedTeamCode, setSelectedTeamCode] = useState<string | null>('KOR');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [booting, setBooting] = useState(true);
  const [nowTime, setNowTime] = useState(Date.now());
  const [knockoutCalloutDismissed, setKnockoutCalloutDismissed] = useState(false);
  const [brasileiraoNavEnabled, setBrasileiraoNavEnabled] = useState(false);
  const { width: viewportWidth } = useWindowDimensions();
  const appScrollRef = useRef<ScrollView>(null);
  const appScrollY = useRef(0);
  const inactiveSince = useRef<number | null>(null);
  const screenRef = useRef<Screen>(screen);
  const leagueTeamIdRef = useRef<string | null>(leagueTeamId);
  const routePathRef = useRef(
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.pathname
      : pathForScreen(screen),
  );
  const userRef = useRef<User | null>(user);
  const appScrollStyle = [styles.appScroll, viewportWidth < 760 && styles.appScrollCompact];
  screenRef.current = screen;
  leagueTeamIdRef.current = leagueTeamId;
  userRef.current = user;

  const triggerRefresh = useCallback(() => {
    setRefreshVersion((current) => current + 1);
  }, []);

  function canLeaveCurrentScreen() {
    return !user?.id || !hasStoredDirtyDraft(user.id);
  }

  function confirmContextChange() {
    if (canLeaveCurrentScreen()) return true;
    if (typeof window === 'undefined') return false;
    return window.confirm(
      'Há alterações não salvas. Deseja sair e manter o rascunho neste navegador?',
    );
  }

  function focusMainContent() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    window.requestAnimationFrame(() => {
      document.getElementById('conteudo-principal')?.focus();
    });
  }

  function navigate(nextScreen: Screen) {
    if (nextScreen === screen) return true;
    if (!confirmContextChange()) return false;
    if (appIaV2 && Platform.OS === 'web' && typeof window !== 'undefined') {
      const nextPath = pathForScreen(nextScreen);
      window.history.pushState({ screen: nextScreen }, '', nextPath);
      routePathRef.current = nextPath;
    }
    if (!nextScreen.startsWith('brasileirao-team-')) setLeagueTeamId(null);
    setScreen(nextScreen);
    appScrollY.current = 0;
    appScrollRef.current?.scrollTo({ y: 0, animated: false });
    focusMainContent();
    return true;
  }

  function navigateLeagueTeam(teamId: string, section: LeagueTeamSection = 'athletes') {
    const nextScreen = screenForLeagueTeamSection(section);
    if (!confirmContextChange()) return false;
    const nextPath = pathForLeagueTeam(teamId, section);
    if (appIaV2 && Platform.OS === 'web' && typeof window !== 'undefined') {
      window.history.pushState({ screen: nextScreen, teamId, section }, '', nextPath);
      routePathRef.current = nextPath;
    }
    setLeagueTeamId(teamId);
    setScreen(nextScreen);
    appScrollY.current = 0;
    appScrollRef.current?.scrollTo({ y: 0, animated: false });
    focusMainContent();
    return true;
  }

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.lang = 'pt-BR';
    document.documentElement.translate = false;
    document.documentElement.setAttribute('translate', 'no');
    document.documentElement.classList.add('notranslate');
    document.body.translate = false;
    document.body?.setAttribute('translate', 'no');
    document.body?.classList.add('notranslate');
    let meta = document.querySelector('meta[name="google"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'google';
      document.head.appendChild(meta);
    }
    meta.content = 'notranslate';
  }, []);

  useEffect(() => {
    if (!appIaV2 || Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.title = pageTitle(screen);
  }, [screen]);

  useEffect(() => {
    if (!appIaV2 || Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    if (!window.history.state?.screen) {
      window.history.replaceState({ screen: screenRef.current }, '', window.location.href);
    }
    const handlePopState = () => {
      const nextScreen = screenFromPath(window.location.pathname);
      const nextTeamId = teamIdFromPath(window.location.pathname);
      if (nextScreen === screenRef.current && nextTeamId === leagueTeamIdRef.current) return;
      const currentUser = userRef.current;
      if (
        currentUser?.id &&
        hasStoredDirtyDraft(currentUser.id) &&
        !window.confirm(
          'Há alterações não salvas. Deseja sair e manter o rascunho neste navegador?',
        )
      ) {
        window.history.pushState({ screen: screenRef.current }, '', routePathRef.current);
        return;
      }
      routePathRef.current = window.location.pathname;
      setLeagueTeamId(nextTeamId);
      setScreen(nextScreen);
      appScrollY.current = 0;
      appScrollRef.current?.scrollTo({ y: 0, animated: false });
      window.requestAnimationFrame(() => {
        document.getElementById('conteudo-principal')?.focus();
      });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function adjustAppScroll(delta: number) {
    const nextY = Math.max(0, appScrollY.current + delta);
    appScrollY.current = nextY;
    appScrollRef.current?.scrollTo({ y: nextY, animated: false });
  }

  useEffect(() => {
    api
      .me()
      .then((result) => setUser(result.user))
      .catch(() => undefined)
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const timer = setInterval(() => setNowTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [user]);

  useEffect(() => {
    if (user?.id) setKnockoutCalloutDismissed(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user || !brasileiraoUi) {
      setBrasileiraoNavEnabled(false);
      return;
    }
    let cancelled = false;
    api
      .brasileiraoSeasons()
      .then((result) => result.seasons.find((season) => season.slug === 'brasileirao-serie-a-2026'))
      .then(async (season) => {
        if (!season) return false;
        if (user.role === 'ADMIN') return true;
        return (await api.seasonUiFeature(season.id)).uiEnabled;
      })
      .then((enabled) => {
        if (!cancelled) setBrasileiraoNavEnabled(Boolean(enabled));
      })
      .catch(() => {
        if (!cancelled) setBrasileiraoNavEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;

    const markInactive = () => {
      inactiveSince.current = Date.now();
    };
    const refreshAfterReturn = () => {
      const startedAt = inactiveSince.current;
      inactiveSince.current = null;
      if (startedAt && Date.now() - startedAt >= 60_000) triggerRefresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        markInactive();
      } else {
        refreshAfterReturn();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', markInactive);
    window.addEventListener('focus', refreshAfterReturn);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', markInactive);
      window.removeEventListener('focus', refreshAfterReturn);
    };
  }, [triggerRefresh]);

  const content = useMemo(() => {
    if (appIaV2 && screen === 'home') {
      return <HomeScreen user={user as User} onNavigate={navigate} />;
    }
    if (appIaV2 && screen === 'competitions') {
      return (
        <CompetitionHub
          onOpen={(competition) => {
            const destination = screenForCompetitionSlug(competition.slug);
            if (!destination) {
              if (typeof window !== 'undefined') {
                window.alert('Esta competição ainda não possui uma área publicada.');
              }
              return false;
            }
            return navigate(destination);
          }}
        />
      );
    }
    if (appIaV2 && screen === 'not-found') {
      return (
        <RouteState
          title="Página não encontrada"
          message="Este endereço não pertence a uma página publicada do Bolão Sirel."
          actionLabel="Voltar ao início"
          onAction={() => navigate('home')}
        />
      );
    }
    if (appIaV2 && screen === 'admin' && user?.role !== 'ADMIN') {
      return (
        <RouteState
          tone="warning"
          title="Acesso restrito"
          message="Esta página está disponível somente para administradores do Bolão Sirel."
          actionLabel="Voltar ao início"
          onAction={() => navigate('home')}
        />
      );
    }
    if (appIaV2 && leagueScreens.has(screen)) {
      if (!brasileiraoNavEnabled) {
        return (
          <RouteState
            tone="warning"
            title="Competição indisponível"
            message="O Brasileirão ainda não está liberado para este participante."
            actionLabel="Ver competições"
            onAction={() => navigate('competitions')}
          />
        );
      }
      if (screen === 'brasileirao-teams') {
        return (
          <TeamDirectoryScreen
            refreshVersion={refreshVersion}
            onOpenTeam={(teamId) => navigateLeagueTeam(teamId)}
          />
        );
      }
      if (screen.startsWith('brasileirao-team-')) {
        if (!leagueTeamId) {
          return (
            <RouteState
              title="Time não encontrado"
              message="O endereço deste perfil está incompleto ou inválido."
              actionLabel="Ver todos os times"
              onAction={() => navigate('brasileirao-teams')}
            />
          );
        }
        return (
          <TeamProfileScreen
            teamId={leagueTeamId}
            section={leagueTeamSectionForScreen(screen)}
            refreshVersion={refreshVersion}
            onBack={() => navigate('brasileirao-teams')}
            onOpenSection={(section) => navigateLeagueTeam(leagueTeamId, section)}
          />
        );
      }
      const section =
        screen === 'brasileirao-predictions'
          ? 'predictions'
          : screen === 'brasileirao-standings'
            ? 'standings'
            : screen === 'brasileirao-ranking'
              ? 'ranking'
              : 'overview';
      return (
        <Brasileirao2026Screen
          currentUserId={user?.id ?? ''}
          refreshVersion={refreshVersion}
          section={section}
          onOpenTeam={(teamId) => navigateLeagueTeam(teamId)}
        />
      );
    }
    if (!appIaV2 && screen === 'brasileirao' && brasileiraoNavEnabled) {
      return (
        <Brasileirao2026Screen currentUserId={user?.id ?? ''} refreshVersion={refreshVersion} />
      );
    }
    if (screen === 'ranking')
      return <RankingScreenLayout refreshVersion={refreshVersion} currentUserId={user?.id ?? ''} />;
    if (screen === 'cup') {
      if (competitionUiV2) return <CupOverviewV2 refreshVersion={refreshVersion} />;
      return (
        <CupOverviewScreen
          refreshVersion={refreshVersion}
          onOpenTeam={(team) => {
            setSelectedTeamCode(team.code ?? null);
            navigate('teams');
          }}
          onOpenKnockout={() => navigate('knockout')}
        />
      );
    }
    if (screen === 'teams') {
      return (
        <TeamCatalogScreen selectedCode={selectedTeamCode} onSelectTeamCode={setSelectedTeamCode} />
      );
    }
    if (screen === 'predictions') {
      return (
        <PredictionsScreen
          currentUserId={user?.id ?? ''}
          refreshVersion={refreshVersion}
          onAdjustScroll={adjustAppScroll}
          onOpenTeam={(team) => {
            setSelectedTeamCode(team.code ?? null);
            navigate('teams');
          }}
        />
      );
    }
    if (screen === 'knockout') {
      return (
        <PredictionBoardScreen
          currentUserId={user?.id ?? ''}
          refreshVersion={refreshVersion}
          initialView="knockout"
          standaloneKnockout
        />
      );
    }
    if (screen === 'admin' && user?.role === 'ADMIN')
      return <AdminScreen currentUserId={user.id} refreshVersion={refreshVersion} />;
    return (
      <DaysScreen
        refreshVersion={refreshVersion}
        onOpenTeam={(team) => {
          setSelectedTeamCode(team.code ?? null);
          navigate('teams');
        }}
      />
    );
  }, [
    brasileiraoNavEnabled,
    refreshVersion,
    leagueTeamId,
    screen,
    selectedTeamCode,
    user?.id,
    user?.nickname,
    user?.role,
  ]);

  async function logout() {
    if (!confirmContextChange()) return;
    await api.logout().catch(() => undefined);
    setUser(null);
  }

  if (booting) {
    return (
      <AppShell>
        <View nativeID="conteudo-principal" role="main" style={styles.bootMain}>
          <ActivityIndicator color={colors.green} style={styles.loader} />
        </View>
      </AppShell>
    );
  }

  if (!user) return <AuthScreen onAuth={setUser} />;
  const knockoutCalloutVisible = !knockoutCalloutDismissed && nowTime < knockoutDeadline;

  return (
    <ToastProvider>
      <AppShell>
        <CompetitionProvider>
          {appIaV2 ? (
            <RoutedWorkspace
              user={user}
              screen={screen}
              content={content}
              scrollRef={appScrollRef}
              onScroll={(event) => {
                appScrollY.current = event.nativeEvent.contentOffset.y;
              }}
              onNavigate={navigate}
              onRefresh={triggerRefresh}
              onUserChange={setUser}
              canChangeContext={confirmContextChange}
              onLogout={logout}
            />
          ) : (
            <>
              <HeaderLayout
                user={user}
                screen={screen}
                setScreen={navigate}
                onRefresh={triggerRefresh}
                onUserChange={setUser}
                showBrasileirao={brasileiraoNavEnabled}
                onLogout={logout}
              />
              {competitionUiV2 ? (
                <CompetitionSelector
                  canLeave={canLeaveCurrentScreen}
                  onCompetitionChange={(competition) => {
                    const capabilities = normalizeCapabilities(competition.capabilities, null);
                    if (capabilities.has('LEAGUE') && brasileiraoNavEnabled)
                      navigate('brasileirao');
                    else if (capabilities.has('KNOCKOUT') || capabilities.has('GROUPS'))
                      navigate('days');
                  }}
                  onSeasonChange={(season) => {
                    const capabilities = normalizeCapabilities(null, season.capabilities);
                    if (capabilities.has('LEAGUE') && brasileiraoNavEnabled)
                      navigate('brasileirao');
                    else if (capabilities.has('KNOCKOUT')) navigate('knockout');
                    else navigate('days');
                  }}
                />
              ) : null}
              <ScrollView
                {...({ tabIndex: -1 } as never)}
                ref={appScrollRef}
                nativeID="conteudo-principal"
                role="main"
                style={styles.appScrollView}
                contentContainerStyle={appScrollStyle}
                onScroll={(event) => {
                  appScrollY.current = event.nativeEvent.contentOffset.y;
                }}
                scrollEventThrottle={16}
              >
                <SoftReveal key={screen} style={styles.screenTransition}>
                  <Suspense
                    fallback={<ActivityIndicator color={colors.green} style={styles.loader} />}
                  >
                    {content}
                  </Suspense>
                </SoftReveal>
              </ScrollView>
            </>
          )}
          <KnockoutCalloutModal
            visible={knockoutCalloutVisible}
            now={nowTime}
            onClose={() => setKnockoutCalloutDismissed(true)}
            onOpen={() => {
              setKnockoutCalloutDismissed(true);
              navigate('knockout');
            }}
          />
        </CompetitionProvider>
      </AppShell>
    </ToastProvider>
  );
}

const styles = StyleSheet.create({
  authScroll: {
    minHeight: '100%',
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 22,
  },
  authHero: {
    width: '100%',
    maxWidth: 520,
    gap: 8,
  },
  brand: {
    color: colors.gold,
    fontSize: 15,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  brandSmall: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  authTitle: {
    color: colors.text,
    fontSize: 38,
    fontWeight: '900',
  },
  authSubtitle: {
    color: colors.muted,
    fontSize: 17,
    lineHeight: 25,
  },
  authCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.panel,
    borderColor: colors.goldBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 16,
    boxShadow: '0 22px 70px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)' as never,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.bg2,
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentItemActive: {
    backgroundColor: colors.green,
  },
  segmentText: {
    color: colors.muted,
    fontWeight: '800',
  },
  segmentTextActive: {
    color: '#062017',
  },
  fieldGroup: {
    gap: 7,
  },
  label: {
    color: colors.soft,
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
    backgroundColor: colors.input,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 9,
    color: colors.text,
    fontSize: 17,
    paddingHorizontal: 14,
    paddingVertical: 13,
    outlineStyle: 'none' as never,
  },
  helpText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  teamGrid: {
    maxHeight: 260,
    gap: 8,
  },
  teamOption: {
    minHeight: 46,
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  teamOptionActive: {
    borderColor: colors.goldBorder,
    backgroundColor: 'rgba(5, 43, 95, 0.88)' as never,
  },
  teamFlag: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countryFlag: {
    borderRadius: 3,
    borderColor: colors.border,
    borderWidth: 1,
  },
  flagFallback: {
    borderRadius: 3,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagFallbackText: {
    color: colors.gold,
    fontSize: 8,
    fontWeight: '900',
  },
  teamOptionText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  teamCode: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '900',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 107, 90, 0.12)',
    borderColor: 'rgba(239, 107, 90, 0.35)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    color: '#ffb7ad',
    fontSize: 14,
    lineHeight: 20,
  },
  successText: {
    color: '#9af0c4',
    fontSize: 14,
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  successModal: {
    width: '100%',
    maxWidth: 390,
    backgroundColor: colors.panel,
    borderColor: colors.goldBorder,
    borderWidth: 1,
    borderRadius: 14,
    padding: 22,
    alignItems: 'center',
    gap: 14,
  },
  confirmModal: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.panel,
    borderColor: colors.goldBorder,
    borderWidth: 1,
    borderRadius: 14,
    padding: 22,
    alignItems: 'center',
    gap: 14,
  },
  knockoutCalloutModal: {
    width: '100%',
    maxWidth: 500,
    backgroundColor: colors.panel,
    borderColor: colors.goldBorder,
    borderWidth: 1,
    borderRadius: 14,
    padding: 22,
    alignItems: 'center',
    gap: 14,
  },
  knockoutCalloutIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.gold,
    borderColor: colors.goldBorder,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knockoutCalloutCountdown: {
    width: '100%',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  knockoutCalloutCountdownLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  knockoutCalloutCountdownValue: {
    color: colors.gold,
    fontSize: 34,
    fontWeight: '900',
    marginTop: 2,
  },
  knockoutCalloutCountdownHint: {
    color: colors.soft,
    fontSize: 12,
    fontWeight: '800',
  },
  knockoutCalloutRules: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  knockoutCalloutRule: {
    flex: 1,
    minWidth: 180,
    minHeight: 58,
    paddingHorizontal: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  knockoutCalloutRulePoints: {
    color: colors.gold,
    fontSize: 24,
    fontWeight: '900',
  },
  knockoutCalloutRuleText: {
    flex: 1,
    color: colors.soft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  confirmIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(239, 107, 90, 0.12)',
    borderColor: colors.red,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmModalActions: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.green,
    borderColor: colors.goldBorder,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
  },
  modalMessage: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  button: {
    minHeight: 42,
    borderRadius: 9,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 15,
    boxShadow: '0 10px 26px rgba(255, 211, 21, 0.18), inset 0 -2px 0 rgba(145,101,0,0.22)' as never,
  },
  buttonSecondary: {
    backgroundColor: 'rgba(2, 28, 70, 0.7)' as never,
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonDanger: {
    backgroundColor: colors.red,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    fontWeight: '900',
    fontSize: 15,
  },
  header: {
    minHeight: 135,
    paddingTop: 18,
    paddingHorizontal: 24,
    paddingBottom: 12,
    backgroundColor: 'rgba(0, 18, 58, 0.32)' as never,
    backgroundImage:
      'linear-gradient(180deg, rgba(2, 23, 45, 0.54), rgba(3, 18, 38, 0.18))' as never,
    gap: 14,
    position: 'relative',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.26)' as never,
  },
  headerWide: {
    paddingBottom: 0,
  },
  headerIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIdentityWide: {
    justifyContent: 'space-between',
  },
  headerAvatarShell: {
    width: 60,
    height: 60,
    borderRadius: 30,
    padding: 2,
    backgroundImage: 'linear-gradient(135deg, #ffd315, #21d66f)' as never,
    borderColor: colors.gold,
    borderWidth: 2,
    boxShadow: '0 0 18px rgba(255,211,21,0.26)' as never,
  },
  headerUserText: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 25,
  },
  avatarActions: {
    flexDirection: 'row',
    gap: 8,
  },
  avatarActionsWide: {
    paddingTop: 4,
  },
  avatarActionButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderColor: 'rgba(98, 164, 255, 0.26)' as never,
    borderWidth: 1,
    backgroundColor: 'rgba(5, 28, 62, 0.72)' as never,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' as never,
  },
  userAvatarFallback: {
    borderColor: colors.goldBorder,
    borderWidth: 1,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarImage: {
    borderColor: colors.goldBorder,
    borderWidth: 1,
    backgroundColor: colors.panel2,
  },
  userAvatarText: {
    color: colors.gold,
    fontWeight: '900',
  },
  navScroll: {
    marginTop: 4,
    flexGrow: 0,
  },
  navScrollWide: {
    position: 'absolute',
    left: 24,
    top: 88,
    right: 620,
    marginTop: 0,
  },
  navScrollContent: {
    paddingBottom: 0,
  },
  navInline: {
    alignSelf: 'flex-start',
  },
  nav: {
    flexDirection: 'row',
    gap: 0,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(4, 24, 54, 0.78)' as never,
    backdropFilter: 'blur(14px)' as never,
    boxShadow: '0 8px 28px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.06)' as never,
  },
  navTabs: {
    flexDirection: 'row',
  },
  navItem: {
    height: 45,
    minWidth: 118,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    backgroundColor: 'rgba(5, 25, 52, 0.62)' as never,
    backgroundImage:
      'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))' as never,
    transitionProperty: 'background-color, box-shadow, color, transform' as never,
    transitionDuration: '160ms' as never,
    transitionTimingFunction: 'ease' as never,
    position: 'relative',
  },
  navItemDivider: {
    position: 'absolute',
    right: 0,
    top: '10%',
    width: 1,
    height: '80%',
    backgroundImage:
      'linear-gradient(180deg, transparent, rgba(188, 212, 244, 0.18) 22%, rgba(188, 212, 244, 0.24) 50%, rgba(188, 212, 244, 0.18) 78%, transparent)' as never,
  },
  navItemFirst: {
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  navItemLast: {
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
  navItemActive: {
    backgroundColor: 'rgba(15, 127, 72, 0.88)' as never,
    backgroundImage:
      'linear-gradient(180deg, rgba(18, 168, 91, 0.95), rgba(8, 90, 63, 0.82))' as never,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    borderBottomColor: '#ffd21f',
    boxShadow:
      '0 0 0 1px rgba(255, 210, 31, 0.35), 0 8px 24px rgba(18, 168, 91, 0.22), inset 0 -2px 0 #ffd21f, inset 0 1px 0 rgba(255,255,255,0.12)' as never,
  },
  navItemText: {
    color: '#eef5ff',
    fontWeight: '800',
    fontSize: 15,
  },
  navItemTextActive: {
    color: '#ffffff',
    fontWeight: '900',
  },
  appScrollView: {
    flex: 1,
  },
  appScroll: {
    paddingTop: 0,
    paddingHorizontal: 8,
    paddingBottom: 32,
    flexGrow: 1,
  },
  appScrollCompact: {
    paddingTop: 14,
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  screenTransition: {
    width: '100%',
    borderRadius: 10,
    padding: 16,
    backgroundColor: 'rgba(0, 25, 78, 0.12)' as never,
    boxShadow: 'none' as never,
    overflow: 'hidden',
  },
  contentGrid: {
    gap: 18,
  },
  contentGridSingle: {
    gap: 18,
    maxWidth: 980,
    width: '100%',
    alignSelf: 'center',
  },
  userList: {
    gap: 12,
  },
  userAdminRow: {
    backgroundColor: colors.bg2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  userAdminInfo: {
    gap: 4,
  },
  userAdminActions: {
    gap: 10,
  },
  userActionButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  deadlinePresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  deadlinePreset: {
    minWidth: 72,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deadlinePresetActive: {
    borderColor: colors.goldBorder,
    backgroundColor: colors.greenDark,
  },
  deadlinePresetText: {
    color: colors.soft,
    fontSize: 14,
    fontWeight: '900',
  },
  deadlinePresetTextActive: {
    color: colors.text,
  },
  rulesList: {
    gap: 8,
  },
  predictionsDailyPage: {
    gap: 18,
  },
  predictionsDailyHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 14,
  },
  predictionsDailyCopy: {
    flex: 1,
    minWidth: 260,
  },
  predictionsDailyTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '900',
  },
  predictionsDailySubtitle: {
    maxWidth: 680,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 3,
  },
  predictionsDailyTabs: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 8,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  predictionsDailyTab: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  predictionsDailyTabActive: {
    backgroundColor: colors.amber,
  },
  predictionsDailyTabText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  predictionsDailyTabTextActive: {
    color: colors.bg,
  },
  predictionNotice: {
    backgroundColor: 'rgba(229, 186, 82, 0.14)',
    borderColor: colors.goldBorder,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  predictionNoticeText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  ruleRow: {
    backgroundColor: colors.bg2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rulePoints: {
    minWidth: 52,
    color: colors.gold,
    fontSize: 16,
    fontWeight: '900',
  },
  ruleText: {
    flex: 1,
    color: colors.soft,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  sideList: {
    gap: 12,
  },
  predictionDayBlock: {
    gap: 10,
  },
  animatedDetailShell: {
    transformOrigin: 'top' as never,
  },
  mainPanel: {
    flex: 1,
  },
  calendarHeader: {
    gap: 14,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  monthTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    textTransform: 'capitalize',
    textAlign: 'center',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  calendarGridCompact: {
    gap: 0,
    rowGap: 6,
  },
  weekdayLabel: {
    width: '13.4%',
    minWidth: 42,
    color: colors.gold,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
    paddingVertical: 6,
  },
  weekdayLabelCompact: {
    width: '14.2857%',
    minWidth: 0,
    fontSize: 11,
  },
  calendarDay: {
    width: '13.4%',
    minWidth: 42,
    minHeight: 66,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.bg2,
    padding: 8,
    gap: 5,
  },
  calendarDayCompact: {
    width: '14.2857%',
    minWidth: 0,
    minHeight: 64,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 7,
  },
  calendarDayBlank: {
    opacity: 0,
  },
  calendarDayInactive: {
    opacity: 0.38,
  },
  calendarDayHasGames: {
    borderColor: 'rgba(255, 211, 21, 0.72)' as never,
    backgroundColor: 'rgba(0, 77, 82, 0.46)' as never,
  },
  calendarDayToday: {
    borderColor: colors.gold,
    borderWidth: 2,
    opacity: 1,
  },
  calendarDaySelected: {
    borderColor: colors.green,
    borderWidth: 2,
    backgroundColor: 'rgba(5, 43, 95, 0.78)' as never,
    boxShadow: '0 0 22px rgba(33, 214, 111, 0.18)' as never,
  },
  calendarDayNumber: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  calendarDayNumberSelected: {
    color: colors.gold,
  },
  calendarDayNumberToday: {
    color: colors.gold,
  },
  calendarDayMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  calendarDayMetaCompact: {
    fontSize: 10,
    lineHeight: 13,
  },
  calendarMatchRow: {
    backgroundColor: 'rgba(1, 25, 65, 0.72)' as never,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  matchTime: {
    color: colors.gold,
    fontSize: 16,
    fontWeight: '900',
  },
  calendarMatchInfo: {
    gap: 4,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: 'rgba(2, 25, 66, 0.68)' as never,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 18,
    gap: 8,
  },
  nextMatchCard: {
    backgroundColor: colors.panel,
    borderColor: colors.goldBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  nextMatchLabel: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  nextMatchTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  dayCard: {
    backgroundColor: 'rgba(2, 29, 76, 0.72)' as never,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 9,
    padding: 14,
    gap: 8,
  },
  dayCardActive: {
    borderColor: colors.green,
    backgroundColor: 'rgba(5, 43, 95, 0.78)' as never,
    boxShadow: '0 0 20px rgba(33, 214, 111, 0.16)' as never,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  statusSummary: {
    flex: 1,
    minWidth: 220,
    gap: 8,
  },
  dayTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  dayStatusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  panel: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 13,
    padding: 18,
    gap: 14,
    boxShadow: '0 20px 70px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255,255,255,0.08)' as never,
    backgroundImage:
      'linear-gradient(145deg, rgba(3, 39, 94, 0.72), rgba(0, 26, 70, 0.78) 62%, rgba(0, 73, 64, 0.20))' as never,
  },
  panelHeader: {
    gap: 10,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: 'rgba(3, 31, 75, 0.82)' as never,
  },
  pillOk: {
    borderColor: colors.green,
    backgroundColor: 'rgba(33, 214, 111, 0.18)',
  },
  pillWarn: {
    borderColor: colors.gold,
    backgroundColor: 'rgba(229, 186, 82, 0.18)',
  },
  pillLive: {
    borderColor: colors.red,
    backgroundColor: 'rgba(239, 107, 90, 0.18)',
  },
  pillText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  matchCard: {
    backgroundColor: 'rgba(1, 25, 65, 0.78)' as never,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 12,
  },
  matchInfo: {
    gap: 4,
  },
  matchTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  teamNameLink: {
    color: colors.gold,
    textDecorationLine: 'underline',
  },
  teamNameButtonSingleLine: { minWidth: 0, flexShrink: 1 },
  teamNameSingleLine: { fontSize: 14 },
  matchTeamsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  scoreText: {
    color: colors.soft,
    fontSize: 14,
    fontWeight: '700',
  },
  inlineScore: {
    color: colors.gold,
    fontSize: 18,
    fontWeight: '900',
    paddingHorizontal: 2,
  },
  scoreStatusText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  matchScoreBoard: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 211, 21, 0.12)',
    borderColor: colors.goldBorder,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  matchScoreLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  matchScoreValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  predictionInputs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scoreInput: {
    width: 64,
    height: 48,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.input,
    color: colors.text,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '900',
    outlineStyle: 'none' as never,
  },
  scoreInputDisabled: {
    opacity: 0.65,
  },
  vs: {
    color: colors.text,
    fontWeight: '900',
    fontSize: 16,
  },
  publicPredictions: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 10,
  },
  publicPredictionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  publicPredictionsTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  publicPredictionsTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  publicPredictionsCount: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  publicPredictionsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  predictionRow: {
    height: 60,
    minWidth: 250,
    flexBasis: '30%',
    flexGrow: 0,
    flexShrink: 1,
    backgroundColor: colors.input,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  predictionRowMine: {
    backgroundColor: 'rgba(47, 191, 122, 0.13)',
    borderLeftColor: colors.green,
    borderLeftWidth: 3,
  },
  predictionParticipant: {
    minWidth: 0,
    width: 220,
    maxWidth: '62%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  predictionParticipantText: {
    minWidth: 0,
    flex: 1,
    gap: 1,
  },
  predictionNickname: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  predictionMineLabel: {
    color: colors.green,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  predictionScore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  predictionScoreNumber: {
    width: 36,
    height: 34,
    borderRadius: 7,
    backgroundColor: colors.panel2,
    borderColor: colors.goldBorder,
    borderWidth: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 32,
    textAlign: 'center',
  },
  predictionScoreSeparator: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: '900',
  },
  publicPredictionsEmpty: {
    minHeight: 58,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: colors.input,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rankingPage: {
    width: '100%',
    alignSelf: 'stretch',
    gap: 14,
  },
  rankingHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 18,
    borderColor: 'rgba(98, 164, 255, 0.26)' as never,
    borderWidth: 1,
    borderRadius: 14,
    backgroundImage:
      'linear-gradient(135deg, rgba(5, 33, 78, 0.92), rgba(2, 20, 50, 0.94))' as never,
    paddingHorizontal: 16,
    paddingVertical: 14,
    boxShadow: '0 16px 44px rgba(0,0,0,0.22)' as never,
  },
  rankingHeadCompact: {
    flexDirection: 'column',
  },
  rankingHeadCopy: {
    flex: 1,
    gap: 6,
  },
  rankingHeadText: {
    color: '#b8c7d9',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    maxWidth: 540,
  },
  rankingBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  rankingLiveBadge: {
    borderColor: '#8b5a41',
    borderWidth: 1,
    backgroundColor: '#734532',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rankingLiveBadgeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  rankingContextBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },
  rankingContextBadgePositive: {
    borderColor: 'rgba(33, 214, 111, 0.45)' as never,
    backgroundColor: 'rgba(18, 168, 91, 0.18)' as never,
  },
  rankingContextBadgeNeutral: {
    borderColor: 'rgba(98, 164, 255, 0.22)' as never,
    backgroundColor: 'rgba(5, 28, 62, 0.72)' as never,
  },
  rankingContextBadgeText: {
    color: '#6cffb1',
    fontSize: 12,
    fontWeight: '900',
  },
  rankingTools: {
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 10,
    alignItems: 'center',
  },
  rankingToolsCompact: {
    justifyContent: 'flex-start',
  },
  rankingSegmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(3, 22, 50, 0.82)' as never,
    borderColor: 'rgba(98, 164, 255, 0.26)' as never,
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    minHeight: 42,
  },
  rankingSegmentedButton: {
    minHeight: 32,
    paddingHorizontal: 15,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankingSegmentedButtonActive: {
    backgroundColor: '#2ed085',
    boxShadow: '0 8px 20px rgba(50,210,139,0.25)' as never,
  },
  rankingSegmentedText: {
    color: '#c2d4ea',
    fontSize: 13,
    fontWeight: '900',
  },
  rankingSegmentedTextActive: {
    color: '#052016',
  },
  rankingSearchField: {
    minWidth: 190,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderColor: 'rgba(98, 164, 255, 0.26)' as never,
    borderWidth: 1,
    backgroundColor: 'rgba(5, 28, 62, 0.72)' as never,
    paddingHorizontal: 12,
  },
  rankingSearchInput: {
    flex: 1,
    minWidth: 120,
    color: '#eaf3ff',
    fontSize: 14,
    fontWeight: '800',
    outlineStyle: 'none' as never,
  },
  rankingStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  rankingStatCard: {
    minWidth: 156,
    flex: 1,
    minHeight: 76,
    borderColor: 'rgba(98, 164, 255, 0.24)' as never,
    borderWidth: 1,
    backgroundImage:
      'linear-gradient(180deg, rgba(5, 35, 82, 0.9), rgba(2, 22, 55, 0.94))' as never,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 7,
  },
  rankingStatLabel: {
    color: '#9fb4d0',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  rankingStatValue: {
    color: colors.text,
    fontSize: 25,
    fontWeight: '900',
  },
  rankingStatDetail: {
    color: '#5ee8a0',
    fontSize: 12,
    fontWeight: '900',
  },
  rankingMainGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    width: '100%',
  },
  rankingMainGridCompact: {
    flexDirection: 'column',
    width: '100%',
  },
  rankingPrimaryColumn: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    alignSelf: 'stretch',
    gap: 12,
  },
  rankingPodiumGrid: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  rankingPodiumGridCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    width: '100%',
  },
  rankingPodiumCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 116,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: 'rgba(2, 31, 78, 0.75)' as never,
    borderRadius: 10,
    padding: 13,
    gap: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  rankingPodiumCardFirst: {
    minHeight: 132,
    borderColor: colors.gold,
    backgroundImage:
      'linear-gradient(135deg, rgba(255,211,21,0.18), rgba(7,52,112,0.66), rgba(2,31,78,0.94))' as never,
  },
  rankingPodiumCardSecond: {
    borderColor: 'rgba(160, 188, 224, 0.32)' as never,
    backgroundImage: 'linear-gradient(135deg, rgba(185,205,226,0.12), rgba(4,36,86,0.9))' as never,
  },
  rankingPodiumCardThird: {
    borderColor: '#9c6b36',
    backgroundImage: 'linear-gradient(135deg, rgba(227,139,68,0.14), rgba(4,36,86,0.9))' as never,
  },
  rankingPodiumGhostRank: {
    position: 'absolute',
    right: 12,
    top: 10,
    color: 'rgba(255,255,255,0.08)' as never,
    fontSize: 42,
    lineHeight: 42,
    fontWeight: '900',
  },
  rankingPodiumLabel: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  rankingPodiumIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rankingPodiumInfo: {
    flex: 1,
    gap: 4,
  },
  rankingPodiumName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  rankingPodiumMeta: {
    color: '#adc3de',
    fontSize: 12,
    fontWeight: '800',
  },
  rankingPodiumPoints: {
    marginTop: 4,
    color: colors.gold,
    fontSize: 24,
    fontWeight: '900',
  },
  rankingMovementBadge: {
    alignSelf: 'flex-start',
    minHeight: 24,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rankingMovementBadgeCompact: {
    minHeight: 20,
    paddingHorizontal: 7,
    gap: 3,
  },
  rankingMovementBadgeUp: {
    borderColor: 'rgba(72, 214, 133, 0.4)',
    backgroundColor: 'rgba(30, 96, 62, 0.35)',
  },
  rankingMovementBadgeDown: {
    borderColor: 'rgba(239, 107, 90, 0.4)',
    backgroundColor: 'rgba(95, 38, 35, 0.35)',
  },
  rankingMovementBadgeNeutral: {
    borderColor: 'rgba(150, 177, 165, 0.3)',
    backgroundColor: 'rgba(16, 42, 34, 0.6)',
  },
  rankingMovementText: {
    fontSize: 11,
    fontWeight: '900',
  },
  rankingMovementTextCompact: {
    fontSize: 10,
  },
  rankingMovementTextUp: {
    color: '#8ff5be',
  },
  rankingMovementTextDown: {
    color: '#ffb0a4',
  },
  rankingMovementTextNeutral: {
    color: '#d4e4dc',
  },
  rankingTablePanel: {
    width: '100%',
    alignSelf: 'stretch',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: colors.panel,
    padding: 0,
    overflow: 'hidden',
  },
  rankingTableHeaderRow: {
    minHeight: 66,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: 'rgba(2, 31, 78, 0.78)' as never,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rankingTableTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  rankingTableSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 3,
  },
  loaderInline: {
    marginVertical: 14,
  },
  rankingTableScroller: {
    width: '100%',
  },
  rankingTableScrollerContent: {
    flexGrow: 1,
  },
  rankingHighlights: {
    gap: 10,
  },
  rankingHighlightStack: {
    gap: 10,
  },
  rankingHighlightCard: {
    borderColor: 'rgba(98, 164, 255, 0.24)' as never,
    borderWidth: 1,
    borderRadius: 15,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  leaderCard: {
    backgroundImage:
      'linear-gradient(180deg, rgba(5, 38, 88, 0.9), rgba(2, 22, 55, 0.94))' as never,
  },
  lastCard: {
    backgroundColor: 'rgba(4, 24, 54, 0.86)' as never,
  },
  rankingHighlightAvatar: {
    position: 'relative',
  },
  rankingMarker: {
    position: 'absolute',
    bottom: -4,
    alignSelf: 'center',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.bg,
    borderWidth: 2,
  },
  leaderMarker: {
    backgroundColor: colors.gold,
  },
  lastMarker: {
    backgroundColor: colors.red,
  },
  rankingHighlightInfo: {
    flex: 1,
    gap: 3,
  },
  rankingHighlightLabel: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  rankingHighlightName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  rankingTable: {
    width: '100%',
    minWidth: 860,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(1, 24, 64, 0.84)' as never,
  },
  rankingTableRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(1, 24, 64, 0.84)' as never,
    borderBottomColor: 'rgba(98, 144, 210, 0.24)' as never,
    borderBottomWidth: 1,
  },
  rankingTableRowAlt: {
    backgroundColor: 'rgba(3, 34, 82, 0.82)' as never,
  },
  rankingTableRowCurrentUser: {
    borderLeftColor: colors.green,
    borderLeftWidth: 3,
    boxShadow: 'inset 0 0 0 1px rgba(50,210,139,0.45)' as never,
    backgroundImage: 'linear-gradient(90deg, rgba(50,210,139,0.12), rgba(5,34,82,0.34))' as never,
  },
  rankingTableHeader: {
    minHeight: 42,
    backgroundColor: 'rgba(4, 76, 112, 0.62)' as never,
  },
  rankingCell: {
    color: '#dce8f7',
    fontSize: 12,
    fontWeight: '900',
    paddingHorizontal: 12,
    textAlign: 'left',
    textTransform: 'uppercase' as never,
    letterSpacing: 0.6,
  },
  rankingCellBox: {
    paddingHorizontal: 12,
  },
  rankColumn: {
    width: 48,
  },
  playerColumn: {
    width: 260,
  },
  numericColumn: {
    width: 56,
  },
  formColumn: {
    width: 148,
  },
  pointsColumn: {
    width: 64,
  },
  rankingRankText: {
    color: colors.gold,
    fontSize: 16,
    textAlign: 'center',
  },
  rankingPlayerCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rankingPlayerAvatarGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rankingPlayerInfo: {
    flex: 1,
  },
  rankingPlayerName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  rankingPlayerStatus: {
    color: '#8fae9f',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  rankingPointsText: {
    color: colors.gold,
    fontSize: 18,
    textAlign: 'center',
  },
  rankingFooterNote: {
    marginTop: 12,
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  rankingSidebar: {
    width: 392,
    alignSelf: 'stretch',
    minWidth: 340,
    maxWidth: 420,
    flexShrink: 0,
    gap: 12,
  },
  rankingSidebarBelow: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  rankingSidePanel: {
    borderColor: 'rgba(98, 164, 255, 0.24)' as never,
    borderWidth: 1,
    borderRadius: 14,
    backgroundImage:
      'linear-gradient(180deg, rgba(5, 35, 82, 0.9), rgba(2, 22, 55, 0.94))' as never,
    padding: 13,
    gap: 10,
  },
  rankingSidePanelBelow: {
    flexGrow: 1,
    flexBasis: 300,
    minWidth: 280,
    maxWidth: '100%',
  },
  rankingSideTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  rankingSideText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  trophyShelfPanel: {
    borderColor: 'rgba(229,186,82,0.34)' as never,
    backgroundImage: 'linear-gradient(180deg, rgba(5,35,82,0.96), rgba(2,22,55,0.98))' as never,
  },
  trophyShelfPanelWide: {
    flexGrow: 2,
    flexBasis: 520,
    minWidth: 320,
    maxWidth: '100%',
  },
  trophyShelfHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  trophyShelfTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  trophyShelfCounter: {
    minHeight: 32,
    minWidth: 58,
    borderRadius: 999,
    borderColor: 'rgba(229,186,82,0.45)' as never,
    borderWidth: 1,
    backgroundColor: 'rgba(229,186,82,0.1)' as never,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  trophyShelfCounterText: {
    color: '#f6d979',
    fontSize: 12,
    fontWeight: '900',
  },
  trophyAwardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    alignItems: 'flex-start',
  },
  trophyAwardCard: {
    minWidth: 0,
    minHeight: 122,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(98,164,255,0.22)' as never,
    backgroundColor: 'rgba(4, 24, 54, 0.86)' as never,
    padding: 10,
    gap: 8,
    overflow: 'hidden',
  },
  trophyAwardGridItem: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 150,
  },
  trophyAwardCardFeatured: {
    alignSelf: 'stretch',
    minHeight: 128,
    borderColor: 'rgba(229,186,82,0.58)' as never,
    backgroundImage:
      'linear-gradient(135deg, rgba(229,186,82,0.24), rgba(40,167,255,0.10) 52%, rgba(2,22,55,0.86))' as never,
    padding: 12,
  },
  trophyAwardCardMajor: {
    flexBasis: '100%',
    minHeight: 108,
    backgroundImage: 'linear-gradient(120deg, rgba(229,186,82,0.13), rgba(5,35,82,0.94))' as never,
  },
  trophyAwardLocked: {
    borderColor: 'rgba(229,186,82,0.42)' as never,
  },
  trophyAwardLive: {
    borderColor: 'rgba(47,191,122,0.55)' as never,
    backgroundImage: 'linear-gradient(160deg, rgba(47,191,122,0.10), rgba(5,35,82,0.96))' as never,
  },
  trophyAwardPending: {
    borderColor: 'rgba(168,187,179,0.22)' as never,
    backgroundColor: 'rgba(4, 24, 54, 0.76)' as never,
  },
  trophyAwardEmpty: {
    borderColor: 'rgba(168,187,179,0.16)' as never,
    backgroundColor: 'rgba(3, 20, 46, 0.72)' as never,
    opacity: 0.72,
  },
  trophyAwardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  trophyIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundImage: 'linear-gradient(145deg, #f6d979, #b98522)' as never,
    boxShadow: '0 0 0 4px rgba(229,186,82,0.08)' as never,
  },
  trophyIconFeatured: {
    width: 58,
    height: 58,
    borderRadius: 17,
    boxShadow: '0 0 0 5px rgba(229,186,82,0.12), 0 16px 30px rgba(0,0,0,0.24)' as never,
  },
  trophyIconMuted: {
    backgroundImage: 'linear-gradient(145deg, #526860, #233d35)' as never,
    boxShadow: 'none' as never,
  },
  trophyAwardCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  trophyAwardLabel: {
    color: '#f6d979',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.4,
    textTransform: 'uppercase' as never,
    lineHeight: 12,
  },
  trophyAwardTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 16,
  },
  trophyAwardTitleFeatured: {
    color: '#f6d979',
    fontSize: 18,
    lineHeight: 22,
  },
  trophyAwardSubtitle: {
    color: '#d7e5de',
    fontSize: 12,
    fontWeight: '800',
  },
  trophyWinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 30,
  },
  trophyWinnerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  trophyWinnerName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  trophyWinnerMeta: {
    color: '#9dbbad',
    fontSize: 10,
    fontWeight: '800',
  },
  trophyPlaceholderAvatar: {
    width: 30,
    height: 30,
    borderRadius: 14,
  },
  trophyStatusBadge: {
    alignSelf: 'flex-start',
    minHeight: 22,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    justifyContent: 'center',
  },
  trophyStatusBadgeLocked: {
    backgroundColor: colors.green,
  },
  trophyStatusBadgeLive: {
    backgroundColor: 'rgba(229,186,82,0.16)' as never,
    borderColor: 'rgba(229,186,82,0.35)' as never,
    borderWidth: 1,
  },
  trophyStatusBadgeMuted: {
    backgroundColor: 'rgba(168,187,179,0.14)' as never,
  },
  trophyStatusText: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase' as never,
  },
  trophyStatusTextLocked: {
    color: '#071311',
  },
  trophyStatusTextLive: {
    color: '#f6d979',
  },
  rankingCriteriaList: {
    gap: 8,
    marginTop: 8,
  },
  rankingCriteriaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  rankingCriteriaKey: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '900',
    minWidth: 28,
  },
  rankingCriteriaText: {
    flex: 1,
    color: '#bed7ce',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  lastFiveList: {
    flexDirection: 'row',
    gap: 5,
  },
  lastFiveBadge: {
    width: 21,
    height: 21,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastFiveExact: {
    backgroundColor: '#35d283',
  },
  lastFiveResult: {
    backgroundColor: '#f2c14e',
  },
  lastFiveGoal: {
    backgroundColor: colors.blue,
  },
  lastFiveMiss: {
    backgroundColor: colors.red,
  },
  lastFiveEmpty: {
    backgroundColor: '#37554a',
  },
  lastFiveText: {
    color: '#062017',
    fontSize: 11,
    fontWeight: '900',
  },
  lastFiveTooltip: {
    position: 'absolute',
    bottom: 28,
    left: -57,
    width: 130,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  lastFiveTooltipContent: {
    gap: 6,
    alignItems: 'center',
  },
  lastFiveTooltipTeams: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lastFiveTooltipVs: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '600',
  },
  lastFiveTooltipScore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastFiveTooltipScoreText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '700',
  },
  lastFiveTooltipPoints: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastFiveTooltipPointsText: {
    color: colors.green,
    fontSize: 10,
    fontWeight: '600',
  },
  cupSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  cupSummaryItem: {
    flex: 1,
    minWidth: 180,
    backgroundColor: colors.bg2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    gap: 4,
  },
  cupGroupsList: {
    width: '95%',
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 12,
  },
  cupPanel: { borderRadius: 6 },
  cupGroupsListSingle: { width: '100%', flexDirection: 'column' },
  cupGroupBlock: {
    width: '49%',
    minWidth: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderRadius: 0,
    padding: 0,
    gap: 10,
  },
  cupGroupBlockFull: { width: '100%' },
  cupGroupTitle: {
    color: colors.gold,
    fontSize: 16,
    fontWeight: '900',
  },
  cupTable: {
    minWidth: 620,
    overflow: 'hidden',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 4,
    boxShadow: '0 14px 45px rgba(0,0,0,0.24)' as never,
  },
  cupTableWide: { minWidth: 1280 },
  cupTableRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(1, 24, 64, 0.82)' as never,
    borderBottomColor: 'rgba(98, 144, 210, 0.28)' as never,
    borderBottomWidth: 1,
  },
  cupTableHeader: {
    minHeight: 34,
    backgroundColor: 'rgba(4, 76, 112, 0.62)' as never,
  },
  cupCell: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    paddingHorizontal: 7,
    textAlign: 'center',
  },
  cupCellBox: {
    paddingHorizontal: 7,
  },
  cupRankColumn: {
    width: 40,
  },
  cupTeamColumn: {
    width: 220,
  },
  cupTeamColumnFull: { width: 'auto', minWidth: 180, flex: 1 },
  cupStatColumn: {
    width: 34,
  },
  cupFormColumn: {
    width: 115,
  },
  cupPointsColumn: {
    width: 40,
  },
  cupTeamCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cupThirdPlacedWrapper: { marginTop: 16, gap: 10 },
  cupThirdPlacedHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cupThirdPlacedHeadingCopy: { flex: 1, gap: 2 },
  cupThirdQualifiedRow: { borderLeftWidth: 4, borderLeftColor: colors.green },
  cupThirdTeamCopy: { minWidth: 0, flex: 1 },
  cupThirdGroup: { color: colors.muted, fontSize: 9, marginTop: 1 },
  cupRankText: {
    color: colors.gold,
    fontSize: 15,
  },
  cupPointsText: {
    color: colors.gold,
    fontSize: 16,
    fontWeight: '900',
  },
  cupFormBadge: {
    width: 18,
    height: 18,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cupFormWin: {
    backgroundColor: colors.green,
  },
  cupFormDraw: {
    backgroundColor: colors.gold,
  },
  cupFormLoss: {
    backgroundColor: colors.red,
  },
  cupMatchesList: {
    gap: 10,
  },
  cupMatchRow: {
    backgroundColor: 'rgba(1, 25, 65, 0.78)' as never,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 5,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cupMatchDate: {
    width: 94,
    gap: 2,
  },
  cupMatchMain: {
    flex: 1,
    gap: 4,
  },
  cupScorersTable: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  cupScorerRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(1, 25, 65, 0.78)' as never,
    borderBottomColor: 'rgba(98, 144, 210, 0.26)' as never,
    borderBottomWidth: 1,
    paddingHorizontal: 10,
    gap: 10,
  },
  cupScorerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderColor: colors.goldBorder,
    borderWidth: 1,
    backgroundColor: colors.panel2,
  },
  cupScorerAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderColor: colors.goldBorder,
    borderWidth: 1,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cupScorerInfo: {
    flex: 1,
    gap: 2,
  },
  cupScorerTeamLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  cupScorerFlag: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderColor: colors.border,
    borderWidth: 1,
  },
  catalogAccordion: {
    gap: 10,
  },
  catalogTeamPanel: {
    borderRadius: 12,
    overflow: 'hidden',
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.bg2,
  },
  catalogTeamButton: {
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  catalogTeamButtonActive: {
    backgroundColor: 'rgba(5, 43, 95, 0.88)' as never,
  },
  catalogTeamIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  catalogFlag: {
    width: 34,
    height: 24,
    borderRadius: 4,
    borderColor: colors.border,
    borderWidth: 1,
  },
  catalogTeamButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  catalogTeamMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  catalogRoster: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: 12,
    gap: 12,
  },
  teamCatalogHero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  teamCatalogEyebrow: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  teamCatalogTitle: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '900',
  },
  playerGrid: {
    gap: 10,
  },
  playerCard: {
    backgroundColor: colors.bg2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playerAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderColor: colors.goldBorder,
    borderWidth: 1,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerAvatarImage: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderColor: colors.goldBorder,
    borderWidth: 1,
    backgroundColor: colors.panel2,
  },
  playerAvatarText: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: '900',
  },
  playerInfo: {
    flex: 1,
    gap: 3,
  },
  playerName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  playerPosition: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: '900',
  },
  bootMain: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: '100vh',
  },
  loader: {
    marginTop: 40,
  },
});
