import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  api,
  createRankingEvents,
  MatchDay,
  RankingRow,
  Team,
  User,
} from './src/api';
import { flagSources } from './src/flagSources';

type Screen = 'days' | 'predictions' | 'ranking' | 'admin';

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

function matchMeta(match: MatchDay['matches'][number]) {
  const raw = match.rawPayload as { group?: string; round?: string } | null | undefined;
  return [raw?.round, raw?.group ? `Grupo ${raw.group}` : null].filter(Boolean).join(' - ');
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
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
  placeholder?: string;
  help?: string;
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
      />
      {help ? <Text style={styles.helpText}>{help}</Text> : null}
    </View>
  );
}

function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'ok' | 'warn' | 'live' }) {
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
      setError('Informe o nickname publico.');
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
          <Text style={styles.brand}>Bolao Copa 2026</Text>
          <Text style={styles.authTitle}>Palpites Copa do Mundo 2026</Text>
          <Text style={styles.authSubtitle}>
            Cadastre seu nome real, escolha um nickname publico e acompanhe o ranking ao vivo.
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
                ? 'Use o nickname publico escolhido no cadastro para entrar.'
                : 'Use seu nome real no cadastro. Espacos, hifen e apostrofo sao permitidos.'
            }
          />

          {mode === 'register' ? (
            <Field
              label="Nickname publico"
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
            placeholder="minimo 6 caracteres"
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
  onLogout,
}: {
  user: User;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  onLogout: () => void;
}) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.brandSmall}>Bolao Copa 2026</Text>
        <Text style={styles.headerTitle}>{user.nickname}</Text>
      </View>
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

function DaysScreen() {
  const [days, setDays] = useState<MatchDay[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => new Date(2026, 5, 1));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const result = await api.matchDays();
      setDays(result.matchDays);
      const firstDay = result.matchDays[0];
      if (firstDay) {
        const firstDate = new Date(firstDay.date);
        setCurrentMonth(new Date(firstDate.getFullYear(), firstDate.getMonth(), 1));
        setSelectedId((current) => current ?? firstDay.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar jogos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <ActivityIndicator color={colors.green} style={styles.loader} />;

  const daysByDate = new Map(days.map((day) => [dateOnly(day.date), day]));
  const selectedDay = days.find((day) => day.id === selectedId) ?? null;
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
            <Text style={styles.muted}>Calendario mensal dos jogos cadastrados.</Text>
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
          <View style={styles.calendarGrid}>
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'].map((label) => (
              <Text key={label} style={styles.weekdayLabel}>
                {label}
              </Text>
            ))}
            {calendarCells.map((cell) => {
              const selected = cell.day?.id === selectedId;
              return (
                <Pressable
                  key={cell.key}
                  disabled={!cell.day}
                  onPress={() => cell.day && setSelectedId(cell.day.id)}
                  style={[
                    styles.calendarDay,
                    !cell.date && styles.calendarDayBlank,
                    cell.date && !cell.day && styles.calendarDayInactive,
                    cell.day && styles.calendarDayHasGames,
                    selected && styles.calendarDaySelected,
                  ]}
                >
                  {cell.date ? (
                    <>
                      <Text style={[styles.calendarDayNumber, selected && styles.calendarDayNumberSelected]}>
                        {cell.date.getDate()}
                      </Text>
                      {cell.day ? (
                        <Text style={styles.calendarDayMeta}>{cell.day.matches.length} jogo(s)</Text>
                      ) : null}
                    </>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      {selectedDay ? (
        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.sectionTitle}>{dateTime(selectedDay.firstMatchStartsAt)}</Text>
              <Text style={styles.muted}>Fecha palpites: {dateTime(selectedDay.predictionsCloseAt)}</Text>
            </View>
            <Pill
              label={selectedDay.isOpenForPredictions ? 'Palpites abertos' : 'Palpites fechados'}
              tone={selectedDay.isOpenForPredictions ? 'ok' : 'warn'}
            />
          </View>
          {selectedDay.matches.map((match) => (
            <View key={match.id} style={styles.calendarMatchRow}>
              <Text style={styles.matchTime}>
                {new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(new Date(match.startsAt))}
              </Text>
              <View style={styles.calendarMatchInfo}>
                <View style={styles.matchTeamsLine}>
                  <TeamFlag team={match.homeTeam} />
                  <Text style={styles.matchTitle}>{match.homeTeam.name}</Text>
                  <Text style={styles.matchTitle}>x</Text>
                  <TeamFlag team={match.awayTeam} />
                  <Text style={styles.matchTitle}>{match.awayTeam.name}</Text>
                </View>
                {matchMeta(match) ? <Text style={styles.muted}>{matchMeta(match)}</Text> : null}
              </View>
              <Pill label={match.status} tone={match.status === 'LIVE' ? 'live' : 'neutral'} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PredictionsScreen() {
  const [days, setDays] = useState<MatchDay[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const result = await api.matchDays();
      setDays(result.matchDays);
      setSelectedId((current) => current ?? result.matchDays[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar campos de palpite.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <ActivityIndicator color={colors.green} style={styles.loader} />;

  return (
    <View style={styles.sideList}>
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.sectionTitle}>Regras de pontuacao</Text>
          <Text style={styles.muted}>A pontuacao e calculada automaticamente ao atualizar os placares.</Text>
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
            <Text style={styles.ruleText}>Acertou os gols de uma das equipes, mas errou o resultado.</Text>
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
          <Text style={styles.emptyTitle}>Carregando jogos da proxima rodada</Text>
          <Text style={styles.muted}>
            Entre no painel Admin para importar a tabela da Copa ou cadastrar jogos manualmente.
          </Text>
        </View>
      ) : null}
      {days.map((day) => {
        const open = Boolean(day.isOpenForPredictions);
        const selected = selectedId === day.id;
        return (
          <View key={day.id} style={styles.predictionDayBlock}>
            <Pressable
              onPress={() => setSelectedId((current) => (current === day.id ? null : day.id))}
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
              <Text style={styles.muted}>Fecha: {dateTime(day.predictionsCloseAt)}</Text>
              <Text style={styles.muted}>{day.matches.length} jogo(s)</Text>
            </Pressable>
            <AnimatedMatchDayDetail id={day.id} open={selected} />
          </View>
        );
      })}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function AnimatedMatchDayDetail({ id, open }: { id: string; open: boolean }) {
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [rendered, setRendered] = useState(open);

  useEffect(() => {
    if (open) setRendered(true);

    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: open ? 260 : 190,
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
                outputRange: [-18, 0],
              }),
            },
            {
              scaleY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.94, 1],
              }),
            },
          ],
        },
      ]}
    >
      <MatchDayDetail id={id} />
    </Animated.View>
  );
}

function MatchDayDetail({ id }: { id: string }) {
  const [day, setDay] = useState<MatchDay | null>(null);
  const [values, setValues] = useState<Record<string, { home: string; away: string }>>({});
  const [successVisible, setSuccessVisible] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDay(null);
    setSuccessVisible(false);
    setError('');
    api.matchDay(id).then(({ matchDay }) => {
      setDay(matchDay);
      const next: Record<string, { home: string; away: string }> = {};
      for (const match of matchDay.matches) {
        const mine = match.predictions[0];
        next[match.id] = {
          home: mine ? String(mine.predictedHomeScore) : '',
          away: mine ? String(mine.predictedAwayScore) : '',
        };
      }
      setValues(next);
    });
  }, [id]);

  async function save() {
    if (!day) return;
    setError('');
    setSuccessVisible(false);

    const predictions = day.matches.map((match) => ({
      matchId: match.id,
      predictedHomeScore: Number(values[match.id]?.home ?? 0),
      predictedAwayScore: Number(values[match.id]?.away ?? 0),
    }));

    try {
      await api.savePredictions(day.id, predictions);
      setSuccessVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel salvar.');
    }
  }

  if (!day) return <ActivityIndicator color={colors.green} style={styles.loader} />;

  const closed = new Date(day.predictionsCloseAt) <= new Date();

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <View>
          <Text style={styles.sectionTitle}>Campo de palpites</Text>
          <Text style={styles.muted}>Fecha: {dateTime(day.predictionsCloseAt)}</Text>
        </View>
        <Pill label={closed ? 'Publico' : 'Em aberto'} tone={closed ? 'warn' : 'ok'} />
      </View>
      {!closed ? (
        <Text style={styles.muted}>
          Edite os placares abaixo e salve todos os palpites deste dia de uma vez.
        </Text>
      ) : null}

      {day.matches.map((match) => (
        <View key={match.id} style={styles.matchCard}>
          <View style={styles.matchInfo}>
            <View style={styles.matchTeamsLine}>
              <TeamFlag team={match.homeTeam} />
              <Text style={styles.matchTitle}>{match.homeTeam.name}</Text>
              <Text style={styles.matchTitle}>x</Text>
              <TeamFlag team={match.awayTeam} />
              <Text style={styles.matchTitle}>{match.awayTeam.name}</Text>
            </View>
            <Text style={styles.muted}>{dateTime(match.startsAt)}</Text>
            <Text style={styles.scoreText}>
              Placar atual: {match.homeScore ?? '-'} x {match.awayScore ?? '-'}
            </Text>
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

          {closed && match.predictions.length > 0 ? (
            <View style={styles.publicPredictions}>
              {match.predictions.map((prediction) => (
                <Text key={prediction.id} style={styles.predictionLine}>
                  {prediction.user?.nickname ?? 'Participante'}: {prediction.predictedHomeScore} x{' '}
                  {prediction.predictedAwayScore}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ))}

      {!closed ? <PrimaryButton label="Salvar palpites do dia" icon="save-outline" onPress={save} /> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <SuccessModal
        visible={successVisible}
        title="Palpites salvos"
        message="Seus palpites foram salvos com sucesso."
        onClose={() => setSuccessVisible(false)}
      />
    </View>
  );
}

function AdminScreen({ currentUserId }: { currentUserId: string }) {
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

  async function loadAdminData() {
    setLoading(true);
    try {
      const [teamsResult, usersResult] = await Promise.all([api.adminTeams(), api.adminUsers()]);
      setTeams(teamsResult.teams);
      setUsers(usersResult.users);
      setHomeTeamCode((current) => current || teamsResult.teams[0]?.code || '');
      setAwayTeamCode((current) => current || teamsResult.teams[1]?.code || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel carregar dados administrativos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAdminData();
  }, []);

  async function seedOfficialData() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.seedWorldCup2026();
      setMessage(`Tabela importada: ${result.teams} selecoes e ${result.matches} jogos salvos.`);
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel importar a tabela.');
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
      setError(err instanceof Error ? err.message : 'Nao foi possivel cadastrar o jogo.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleUserStatus(targetUser: User) {
    setUserSaving(targetUser.id);
    setUserError('');
    setUserMessage('');
    try {
      const blocked = targetUser.status !== 'BLOCKED';
      const result = await api.setAdminUserStatus(targetUser.id, blocked);
      setUsers((current) => current.map((user) => (user.id === targetUser.id ? result.user : user)));
      setUserMessage(blocked ? 'Usuario bloqueado.' : 'Usuario desbloqueado.');
    } catch (err) {
      setUserError(err instanceof Error ? err.message : 'Nao foi possivel alterar o usuario.');
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
      setUserError(err instanceof Error ? err.message : 'Nao foi possivel alterar a senha.');
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
          Fonte usada para a carga local: calendario publicado pelo ge e conferencia na pagina de
          jogos da FIFA.
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Cadastrar jogo</Text>
        <Field
          label="Data e hora de Brasilia"
          value={startsAt}
          onChangeText={setStartsAt}
          placeholder="2026-06-11T16:00"
          help="Formato: AAAA-MM-DDTHH:mm. Exemplo: 2026-06-13T19:00."
        />
        <TeamSelector label="Mandante" teams={teams} selectedCode={homeTeamCode} onSelect={setHomeTeamCode} />
        <TeamSelector label="Visitante" teams={teams} selectedCode={awayTeamCode} onSelect={setAwayTeamCode} />
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
            Administradores visualizam e gerenciam contas, mas nao entram no ranking nem participam
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
                      label={managedUser.role === 'ADMIN' ? 'Admin' : isBlocked ? 'Bloqueado' : 'Usuario'}
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
                    placeholder="minimo 6 caracteres"
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
                  {isSelf ? <Text style={styles.muted}>Sua propria conta nao pode ser bloqueada.</Text> : null}
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

function RankingScreen() {
  const [ranking, setRanking] = useState<RankingRow[]>([]);

  useEffect(() => {
    api.ranking().then((result) => setRanking(result.ranking));
    const source = createRankingEvents(setRanking);
    return () => source.close();
  }, []);

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.sectionTitle}>Ranking ao vivo</Text>
        <Pill label="Atualizacao ativa" tone="live" />
      </View>
      {ranking.map((row) => (
        <View key={row.userId} style={styles.rankingRow}>
          <View style={styles.rankBadge}>
            <Text style={styles.rankText}>#{row.rank}</Text>
          </View>
          <View style={styles.rankingInfo}>
            <Text style={styles.matchTitle}>{row.nickname}</Text>
            <Text style={styles.muted}>
              Exatos {row.exactScores} | Resultado {row.resultHits} | Gols {row.oneGoalHits}
            </Text>
          </View>
          <View style={styles.rankingPoints}>
            <Pill label={row.hasLiveData ? 'Provisorio' : 'Definitivo'} tone={row.hasLiveData ? 'warn' : 'ok'} />
            <Text style={styles.pointsText}>{row.points} pts</Text>
          </View>
        </View>
      ))}
      {ranking.length === 0 ? <Text style={styles.muted}>Ranking vazio por enquanto.</Text> : null}
    </View>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [screen, setScreen] = useState<Screen>('days');
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((result) => setUser(result.user))
      .catch(() => undefined)
      .finally(() => setBooting(false));
  }, []);

  const content = useMemo(() => {
    if (screen === 'ranking') return <RankingScreen />;
    if (screen === 'predictions') return <PredictionsScreen />;
    if (screen === 'admin' && user?.role === 'ADMIN') return <AdminScreen currentUserId={user.id} />;
    return <DaysScreen />;
  }, [screen, user?.id, user?.role]);

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
      <Header user={user} screen={screen} setScreen={setScreen} onLogout={logout} />
      <ScrollView style={styles.appScrollView} contentContainerStyle={styles.appScroll}>
        {content}
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
  headerTitle: {
    color: colors.text,
    fontSize: 24,
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
  contentGrid: {
    gap: 18,
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
  rulesList: {
    gap: 8,
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
  weekdayLabel: {
    width: '13.4%',
    minWidth: 42,
    color: colors.gold,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
    paddingVertical: 6,
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
  calendarDayMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
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
    paddingTop: 10,
    gap: 6,
  },
  predictionLine: {
    color: colors.soft,
    fontSize: 14,
  },
  rankingRow: {
    backgroundColor: colors.bg2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  rankBadge: {
    width: 52,
    height: 42,
    borderRadius: 10,
    backgroundColor: 'rgba(229, 186, 82, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    color: colors.gold,
    fontWeight: '900',
    fontSize: 18,
  },
  rankingInfo: {
    gap: 4,
  },
  rankingPoints: {
    gap: 8,
  },
  pointsText: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  loader: {
    marginTop: 40,
  },
});

