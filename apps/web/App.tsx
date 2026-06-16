import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  API_URL,
  api,
  createRankingEvents,
  CupMatchResult,
  CupOverview,
  CupStandingRow,
  MatchDay,
  RankingRow,
  Team,
  User,
} from './src/api';
import { flagSources } from './src/flagSources';
import { teamCatalogByCode } from './src/teamCatalog';
import { PredictionBoardScreen } from './src/predictionBoard';
import { CupOverviewV2 } from './src/competitionV2';
import { DrawerReveal, SoftReveal } from './src/motion';

type Screen = 'days' | 'predictions' | 'ranking' | 'cup' | 'teams' | 'admin';

const competitionUiV2 = process.env.EXPO_PUBLIC_COMPETITION_UI_V2 === '1';

const colors = {
  bg: '#071311',
  bg2: '#0d1c19',
  panel: '#13251f',
  panel2: '#193128',
  border: '#2c4a40',
  text: '#f3f8f5',
  muted: '#a8bbb3',
  soft: '#d9e6df',
  green: '#2fbf7a',
  greenDark: '#168457',
  gold: '#e5ba52',
  goldBorder: '#d8b64c',
  red: '#ef6b5a',
  input: '#0b1815',
};

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function dateOnly(value: string | Date) {
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
}: {
  label: string;
  row?: RankingRow;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'leader' | 'last';
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
      </View>
    </View>
  );
}

function LastFive({ values }: { values: number[] }) {
  const padded = [...values.slice(-5)];
  while (padded.length < 5) padded.unshift(-1);

  return (
    <View style={styles.lastFiveList}>
      {padded.map((value, index) => (
        <View
          key={`${index}-${value}`}
          style={[
            styles.lastFiveBadge,
            value === 7 && styles.lastFiveExact,
            value === 3 && styles.lastFiveResult,
            value === 1 && styles.lastFiveGoal,
            value === 0 && styles.lastFiveMiss,
            value < 0 && styles.lastFiveEmpty,
          ]}
        >
          <Text style={styles.lastFiveText}>{value >= 0 ? value : '-'}</Text>
        </View>
      ))}
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

function TeamNameButton({ team, onOpenTeam }: { team: Team; onOpenTeam?: (team: Team) => void }) {
  if (!onOpenTeam) {
    return <Text style={styles.matchTitle}>{team.name}</Text>;
  }

  return (
    <Pressable onPress={() => onOpenTeam(team)} hitSlop={6}>
      <Text style={[styles.matchTitle, styles.teamNameLink]}>{team.name}</Text>
    </Pressable>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {children}
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  tone = 'primary',
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        tone === 'secondary' && styles.buttonSecondary,
        tone === 'danger' && styles.buttonDanger,
        disabled && styles.buttonDisabled,
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={colors.text} /> : null}
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
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
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return;
    }

    Animated.spring(progress, {
      toValue: 1,
      friction: 5,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [progress, visible]);

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
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
      <ScrollView contentContainerStyle={styles.authScroll}>
        <View style={styles.authHero}>
          <Text style={styles.brand}>Bolão Copa 2026</Text>
          <Text style={styles.authTitle}>Palpites Copa do Mundo 2026</Text>
          <Text style={styles.authSubtitle}>
            Cadastre seu nome real, escolha um nickname público e acompanhe o ranking ao vivo.
          </Text>
        </View>

        <View style={styles.authCard}>
          <View style={styles.segment}>
            <Pressable
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
            onPress={submit}
            disabled={loading}
            icon={mode === 'login' ? 'log-in-outline' : 'person-add-outline'}
          />
        </View>
      </ScrollView>
    </AppShell>
  );
}

function Header({
  user,
  screen,
  setScreen,
  onRefresh,
  onUserChange,
  onLogout,
}: {
  user: User;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  onRefresh: () => void;
  onUserChange: (user: User) => void;
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
          <Text style={styles.brandSmall}>Bolão Copa 2026</Text>
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
      <View style={styles.nav}>
        <PrimaryButton
          label="Dias"
          icon="calendar-outline"
          tone={screen === 'days' ? 'primary' : 'secondary'}
          onPress={() => setScreen('days')}
        />
        <PrimaryButton
          label="Palpites"
          icon="create-outline"
          tone={screen === 'predictions' ? 'primary' : 'secondary'}
          onPress={() => setScreen('predictions')}
        />
        <PrimaryButton
          label="Ranking"
          icon="podium-outline"
          tone={screen === 'ranking' ? 'primary' : 'secondary'}
          onPress={() => setScreen('ranking')}
        />
        <PrimaryButton
          label="Copa"
          icon="football-outline"
          tone={screen === 'cup' ? 'primary' : 'secondary'}
          onPress={() => setScreen('cup')}
        />
        <PrimaryButton
          label="Times"
          icon="people-outline"
          tone={screen === 'teams' ? 'primary' : 'secondary'}
          onPress={() => setScreen('teams')}
        />
        {user.role === 'ADMIN' ? (
          <PrimaryButton
            label="Admin"
            icon="settings-outline"
            tone={screen === 'admin' ? 'primary' : 'secondary'}
            onPress={() => setScreen('admin')}
          />
        ) : null}
        <PrimaryButton label="Sair" tone="secondary" icon="log-out-outline" onPress={onLogout} />
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

  async function load() {
    setLoading(true);
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
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
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
            <Text style={styles.sectionTitle}>Dias de jogos</Text>
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
  if (process.env.EXPO_PUBLIC_LEGACY_PREDICTIONS !== '1') {
    return <PredictionBoardScreen currentUserId={currentUserId} refreshVersion={refreshVersion} />;
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
            <Text style={styles.rulePoints}>7 pts</Text>
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
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [rendered, setRendered] = useState(open);

  useEffect(() => {
    if (open) setRendered(true);

    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: open ? 210 : 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) setRendered(false);
    });
  }, [open, progress]);

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

  async function loadAdminData() {
    setLoading(true);
    try {
      const [teamsResult, usersResult, predictionSettings] = await Promise.all([
        api.adminTeams(),
        api.adminUsers(),
        api.adminPredictionSettings(),
      ]);
      setTeams(teamsResult.teams);
      setUsers(usersResult.users);
      setHomeTeamCode((current) => current || teamsResult.teams[0]?.code || '');
      setAwayTeamCode((current) => current || teamsResult.teams[1]?.code || '');
      setPredictionCloseMinutes(String(predictionSettings.predictionCloseMinutes));
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
          Fonte usada para a carga local: calendário publicado pelo GE e conferência na página de
          jogos da FIFA.
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
                  style={[styles.deadlinePresetText, selected && styles.deadlinePresetTextActive]}
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
            Administradores visualizam e gerenciam contas, mas não entram no ranking nem participam
            dos palpites.
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
                        managedUser.role === 'ADMIN' ? 'Admin' : isBlocked ? 'Bloqueado' : 'Usuário'
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
        <Text style={styles.sectionTitle}>Ranking ao vivo</Text>
        <Pill label="Atualização ativa" tone="live" />
      </View>

      {ranking.length > 0 ? (
        <View style={styles.rankingHighlights}>
          <RankingHighlight label="Líder" row={leader} icon="trophy-outline" tone="leader" />
          <RankingHighlight label="Lanterna" row={last} icon="flashlight-outline" tone="last" />
        </View>
      ) : null}

      {ranking.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
                  <UserAvatar nickname={row.nickname} avatarUrl={row.avatarUrl} size={34} />
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
                  <LastFive values={row.lastFive} />
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
}: {
  title: string;
  rows: CupStandingRow[];
  onOpenTeam: (team: Team) => void;
}) {
  return (
    <View style={styles.cupGroupBlock}>
      <Text style={styles.cupGroupTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.cupTable}>
          <View style={[styles.cupTableRow, styles.cupTableHeader]}>
            <Text style={[styles.cupCell, styles.cupRankColumn]}>#</Text>
            <Text style={[styles.cupCell, styles.cupTeamColumn]}>Time</Text>
            <Text style={[styles.cupCell, styles.cupStatColumn]}>P</Text>
            <Text style={[styles.cupCell, styles.cupStatColumn]}>V</Text>
            <Text style={[styles.cupCell, styles.cupStatColumn]}>E</Text>
            <Text style={[styles.cupCell, styles.cupStatColumn]}>D</Text>
            <Text style={[styles.cupCell, styles.cupStatColumn]}>SG</Text>
            <Text style={[styles.cupCell, styles.cupStatColumn]}>GP</Text>
            <Text style={[styles.cupCell, styles.cupFormColumn]}>Últimos 5</Text>
            <Text style={[styles.cupCell, styles.cupPointsColumn]}>PTS</Text>
          </View>
          {rows.map((row) => (
            <View key={`${row.group}-${row.team.id}`} style={styles.cupTableRow}>
              <Text style={[styles.cupCell, styles.cupRankColumn, styles.cupRankText]}>
                {row.rank}
              </Text>
              <View style={[styles.cupCellBox, styles.cupTeamColumn, styles.cupTeamCell]}>
                <TeamFlag team={row.team} />
                <TeamNameButton team={row.team} onOpenTeam={onOpenTeam} />
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

  return (
    <View style={styles.contentGrid}>
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.sectionTitle}>Copa do Mundo 2026</Text>
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

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.sectionTitle}>Classificação</Text>
          <Text style={styles.muted}>A tabela considera apenas partidas encerradas.</Text>
        </View>
        {overview?.standingsByGroup.length ? (
          <View style={styles.cupGroupsList}>
            {overview.standingsByGroup.map((group) => (
              <CupStandingTable
                key={group.group}
                title={group.group === 'Sem grupo' ? group.group : `Grupo ${group.group}`}
                rows={group.rows}
                onOpenTeam={onOpenTeam}
              />
            ))}
          </View>
        ) : (
          <Text style={styles.muted}>Nenhum grupo cadastrado ainda.</Text>
        )}
      </View>

      <View style={styles.panel}>
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

      <View style={styles.panel}>
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
  const teams = useMemo(() => Object.values(teamCatalogByCode), []);
  const selected = selectedCode ? teamCatalogByCode[selectedCode] : null;

  return (
    <View style={styles.contentGridSingle}>
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.sectionTitle}>Times participantes</Text>
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
  const [screen, setScreen] = useState<Screen>('days');
  const [selectedTeamCode, setSelectedTeamCode] = useState<string | null>('KOR');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [booting, setBooting] = useState(true);
  const appScrollRef = useRef<ScrollView>(null);
  const appScrollY = useRef(0);
  const inactiveSince = useRef<number | null>(null);

  const triggerRefresh = useCallback(() => {
    setRefreshVersion((current) => current + 1);
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
    if (screen === 'ranking') return <RankingScreen refreshVersion={refreshVersion} />;
    if (screen === 'cup') {
      if (competitionUiV2) return <CupOverviewV2 refreshVersion={refreshVersion} />;
      return (
        <CupOverviewScreen
          refreshVersion={refreshVersion}
          onOpenTeam={(team) => {
            setSelectedTeamCode(team.code ?? null);
            setScreen('teams');
          }}
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
            setScreen('teams');
          }}
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
          setScreen('teams');
        }}
      />
    );
  }, [refreshVersion, screen, selectedTeamCode, user?.id, user?.role]);

  async function logout() {
    await api.logout().catch(() => undefined);
    setUser(null);
  }

  if (booting) {
    return (
      <AppShell>
        <ActivityIndicator color={colors.green} style={styles.loader} />
      </AppShell>
    );
  }

  if (!user) return <AuthScreen onAuth={setUser} />;

  return (
    <AppShell>
      <Header
        user={user}
        screen={screen}
        setScreen={setScreen}
        onRefresh={triggerRefresh}
        onUserChange={setUser}
        onLogout={logout}
      />
      <ScrollView
        ref={appScrollRef}
        style={styles.appScrollView}
        contentContainerStyle={styles.appScroll}
        onScroll={(event) => {
          appScrollY.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        <SoftReveal key={screen} style={styles.screenTransition}>
          {content}
        </SoftReveal>
      </ScrollView>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: '100%',
    backgroundColor: colors.bg,
  },
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
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
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
    borderRadius: 14,
    padding: 18,
    gap: 16,
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
    color: colors.text,
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
    borderColor: colors.goldBorder,
    borderWidth: 1,
    borderRadius: 10,
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
    backgroundColor: '#17372c',
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
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
  },
  buttonSecondary: {
    backgroundColor: colors.panel2,
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
    color: colors.text,
    fontWeight: '900',
    fontSize: 15,
  },
  header: {
    padding: 18,
    borderBottomColor: colors.goldBorder,
    borderBottomWidth: 1,
    backgroundColor: colors.bg2,
    gap: 14,
  },
  headerIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerUserText: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  avatarActions: {
    flexDirection: 'row',
    gap: 8,
  },
  avatarActionButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
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
  nav: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  appScrollView: {
    flex: 1,
  },
  appScroll: {
    padding: 18,
    paddingBottom: 32,
    flexGrow: 1,
  },
  screenTransition: {
    width: '100%',
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
    borderRadius: 10,
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
    borderColor: colors.goldBorder,
    backgroundColor: '#17372c',
  },
  calendarDayToday: {
    borderColor: colors.gold,
    borderWidth: 2,
    opacity: 1,
  },
  calendarDaySelected: {
    borderColor: colors.green,
    borderWidth: 2,
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
    backgroundColor: colors.bg2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
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
    fontSize: 22,
    fontWeight: '900',
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  emptyCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
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
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  dayCardActive: {
    borderColor: colors.green,
    backgroundColor: '#17372c',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
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
    borderRadius: 14,
    padding: 16,
    gap: 14,
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
    backgroundColor: colors.panel2,
  },
  pillOk: {
    borderColor: colors.green,
    backgroundColor: 'rgba(47, 191, 122, 0.18)',
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
    backgroundColor: colors.bg2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
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
    backgroundColor: 'rgba(229, 186, 82, 0.13)',
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
    borderRadius: 10,
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
  rankingHighlights: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  rankingHighlightCard: {
    minWidth: 220,
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  leaderCard: {
    borderColor: colors.goldBorder,
    backgroundColor: 'rgba(229, 186, 82, 0.13)',
  },
  lastCard: {
    borderColor: colors.red,
    backgroundColor: 'rgba(239, 107, 90, 0.12)',
  },
  rankingHighlightAvatar: {
    position: 'relative',
    paddingBottom: 10,
  },
  rankingMarker: {
    position: 'absolute',
    bottom: 0,
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
    fontSize: 20,
    fontWeight: '900',
  },
  rankingTable: {
    minWidth: 760,
    borderRadius: 10,
    overflow: 'hidden',
    borderColor: colors.border,
    borderWidth: 1,
  },
  rankingTableRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg2,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  rankingTableHeader: {
    minHeight: 38,
    backgroundColor: colors.input,
  },
  rankingCell: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    paddingHorizontal: 8,
    textAlign: 'center',
  },
  rankingCellBox: {
    paddingHorizontal: 8,
  },
  rankColumn: {
    width: 44,
  },
  playerColumn: {
    width: 230,
  },
  numericColumn: {
    width: 54,
  },
  formColumn: {
    width: 145,
  },
  pointsColumn: {
    width: 56,
  },
  rankingRankText: {
    color: colors.gold,
    fontSize: 16,
  },
  rankingPlayerCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  rankingPointsText: {
    color: colors.gold,
    fontSize: 16,
  },
  lastFiveList: {
    flexDirection: 'row',
    gap: 5,
  },
  lastFiveBadge: {
    width: 22,
    height: 22,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastFiveExact: {
    backgroundColor: colors.green,
  },
  lastFiveResult: {
    backgroundColor: colors.gold,
  },
  lastFiveGoal: {
    backgroundColor: '#52a9ff',
  },
  lastFiveMiss: {
    backgroundColor: colors.red,
  },
  lastFiveEmpty: {
    backgroundColor: colors.border,
  },
  lastFiveText: {
    color: colors.bg,
    fontSize: 11,
    fontWeight: '900',
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
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  cupGroupsList: {
    gap: 12,
  },
  cupGroupBlock: {
    backgroundColor: colors.bg2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  cupGroupTitle: {
    color: colors.gold,
    fontSize: 16,
    fontWeight: '900',
  },
  cupTable: {
    minWidth: 780,
    overflow: 'hidden',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
  },
  cupTableRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  cupTableHeader: {
    minHeight: 34,
    backgroundColor: colors.bg,
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
    width: 42,
  },
  cupTeamColumn: {
    width: 250,
  },
  cupStatColumn: {
    width: 48,
  },
  cupFormColumn: {
    width: 130,
  },
  cupPointsColumn: {
    width: 58,
  },
  cupTeamCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
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
    width: 22,
    height: 22,
    borderRadius: 5,
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
    backgroundColor: colors.bg2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
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
    backgroundColor: colors.bg2,
    borderBottomColor: colors.border,
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
    backgroundColor: '#17372c',
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
  loader: {
    marginTop: 40,
  },
});
