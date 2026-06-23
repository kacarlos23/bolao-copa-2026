import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { Ionicons } from '@expo/vector-icons';
import {
  api,
  createPredictionBoardEvents,
  type CupMatchResult,
  type CupOverview,
  type CupStandingGroup,
  type CupStandingRow,
  type KnockoutFixture,
  type Match,
  type MatchDay,
  type Team,
} from './api';
import { flagSources } from './flagSources';
import { SoftReveal } from './motion';

const c = {
  bg: '#00143a',
  panel: 'rgba(2, 30, 76, 0.78)',
  panel2: 'rgba(2, 44, 96, 0.82)',
  line: 'rgba(98, 144, 210, 0.42)',
  lineStrong: 'rgba(255, 211, 21, 0.52)',
  text: '#f8fbff',
  muted: '#b8c6dd',
  green: '#21d66f',
  greenDark: '#008a4f',
  gold: '#ffd315',
  red: '#ff6b59',
};

function localDay(value: string | Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    typeof value === 'string' ? new Date(value) : value,
  );
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'America/Sao_Paulo',
  })
    .format(new Date(value))
    .replace('.', '');
}

function time(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function fullDateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function TeamFlag({ team, size = 18 }: { team?: Team | null; size?: number }) {
  const source = team?.metadata?.iso2 ? flagSources[team.metadata.iso2.toLowerCase()] : undefined;
  if (!source) {
    return (
      <View style={[styles.flagFallback, { width: size * 1.5, height: size }]}>
        <Text style={styles.flagFallbackText}>{team?.code?.slice(0, 2) ?? '--'}</Text>
      </View>
    );
  }
  return (
    <Image
      source={source}
      resizeMode="cover"
      style={[styles.flag, { width: size * 1.5, height: size }]}
    />
  );
}

function TeamName({ team }: { team?: Team | null }) {
  return (
    <View style={styles.teamNameLine}>
      <TeamFlag team={team} size={16} />
      <Text style={styles.teamName} numberOfLines={1}>
        {team?.name ?? 'A definir'}
      </Text>
    </View>
  );
}

function MatchTeamLabel({ team, side }: { team?: Team | null; side: 'home' | 'away' }) {
  return (
    <View style={[styles.matchTeamLabel, side === 'home' && styles.matchTeamLabelHome]}>
      {side === 'away' ? <TeamFlag team={team} size={18} /> : null}
      <Text style={styles.matchTeamName} numberOfLines={2}>
        {team?.name ?? 'A definir'}
      </Text>
      {side === 'home' ? <TeamFlag team={team} size={18} /> : null}
    </View>
  );
}

function score(match: Match | CupMatchResult | KnockoutFixture) {
  const home =
    match.status === 'FINISHED' ? (match.finalHomeScore ?? match.homeScore) : match.homeScore;
  const away =
    match.status === 'FINISHED' ? (match.finalAwayScore ?? match.awayScore) : match.awayScore;
  return home == null || away == null ? null : `${home} x ${away}`;
}

function StatusBadge({ status, open }: { status: string; open?: boolean }) {
  const live = status === 'LIVE';
  const label = live
    ? 'Ao vivo'
    : open
      ? 'Aberto'
      : status === 'FINISHED'
        ? 'Encerrado'
        : 'Fechado';
  return (
    <View style={[styles.statusBadge, live && styles.statusLive, open && styles.statusOpen]}>
      <View
        style={[styles.statusDot, live && styles.statusDotLive, open && styles.statusDotOpen]}
      />
      <Text style={styles.statusText}>{label}</Text>
    </View>
  );
}

function RulesBar({ closeMinutes }: { closeMinutes: number }) {
  return (
    <View style={styles.rulesBar}>
      <View style={styles.ruleDeadline}>
        <Ionicons name="time-outline" size={18} color={c.gold} />
        <Text style={styles.ruleDeadlineText}>Fecha {closeMinutes} min antes de cada jogo</Text>
      </View>
      {[
        ['7', 'Placar exato'],
        ['3', 'Resultado'],
        ['1', 'Gol de um time'],
        ['0', 'Erro'],
      ].map(([points, label]) => (
        <View key={points} style={styles.ruleItem}>
          <Text style={[styles.rulePoints, points === '0' && styles.rulePointsMiss]}>{points}</Text>
          <Text style={styles.ruleLabel}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function PredictionsModal({
  match,
  currentUserId,
  onClose,
}: {
  match: Match | null;
  currentUserId: string;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const compact = width < 650;
  const predictions = useMemo(
    () =>
      [...(match?.predictions ?? [])].sort((a, b) => {
        if (a.userId === currentUserId) return -1;
        if (b.userId === currentUserId) return 1;
        return (a.user?.nickname ?? '').localeCompare(b.user?.nickname ?? '', 'pt-BR');
      }),
    [currentUserId, match],
  );
  return (
    <Modal transparent animationType="fade" visible={Boolean(match)} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleGroup}>
              <Text style={styles.modalTitle}>Palpites dos participantes</Text>
            </View>
            <Pressable onPress={onClose} style={styles.iconButton} accessibilityLabel="Fechar">
              <Ionicons name="close" size={22} color={c.text} />
            </Pressable>
          </View>
          {match ? (
            <View style={[styles.modalMatchup, compact && styles.modalMatchupCompact]}>
              <View style={styles.modalTeam}>
                <TeamFlag team={match.homeTeam} size={compact ? 24 : 30} />
                <Text style={styles.modalTeamName} numberOfLines={2}>
                  {match.homeTeam.name}
                </Text>
              </View>
              <View style={styles.modalVersus}>
                <Text style={styles.modalVersusText}>x</Text>
                <Text style={styles.modalMatchTime}>{time(match.startsAt)}</Text>
              </View>
              <View style={styles.modalTeam}>
                <TeamFlag team={match.awayTeam} size={compact ? 24 : 30} />
                <Text style={styles.modalTeamName} numberOfLines={2}>
                  {match.awayTeam.name}
                </Text>
              </View>
            </View>
          ) : null}
          <ScrollView style={styles.modalList} contentContainerStyle={styles.predictionGrid}>
            {predictions.map((prediction) => (
              <View
                key={prediction.id}
                style={[
                  styles.publicPrediction,
                  compact && styles.publicPredictionCompact,
                  prediction.userId === currentUserId && styles.publicPredictionMine,
                ]}
              >
                <Text style={styles.publicNickname} numberOfLines={1}>
                  {prediction.user?.nickname ?? 'Participante'}
                </Text>
                <Text style={styles.publicScore}>
                  {prediction.predictedHomeScore} x {prediction.predictedAwayScore}
                </Text>
              </View>
            ))}
            {predictions.length === 0 ? (
              <Text style={styles.muted}>Nenhum palpite enviado para esta partida.</Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function DailyPredictionsV2({
  currentUserId,
  refreshVersion,
}: {
  currentUserId: string;
  refreshVersion: number;
}) {
  const { width } = useWindowDimensions();
  const compact = width < 850;
  const [days, setDays] = useState<MatchDay[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [day, setDay] = useState<MatchDay | null>(null);
  const [closeMinutes, setCloseMinutes] = useState(5);
  const [draft, setDraft] = useState<Record<string, { home: string; away: string }>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [publicMatch, setPublicMatch] = useState<Match | null>(null);
  const [saved, setSaved] = useState(false);
  const skipNextDaysRefreshUntil = useRef(0);

  const loadDays = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await api.matchDays();
      setDays(result.matchDays);
      setCloseMinutes(result.predictionCloseMinutes);
      setSelectedId((current) => {
        if (current && result.matchDays.some((item) => item.id === current)) return current;
        const today = localDay(new Date());
        const currentDay = result.matchDays.find((item) => localDay(item.date) === today);
        const nextOpen = result.matchDays.find((item) =>
          item.matches.some((match) => match.isOpenForPredictions),
        );
        return currentDay?.id ?? nextOpen?.id ?? result.matchDays[0]?.id ?? null;
      });
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar os jogos.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadDay = useCallback(
    async (id: string, quiet = false) => {
      if (!quiet) setDay(null);
      try {
        const result = await api.matchDay(id);
        setDay(result.matchDay);
        setCloseMinutes(result.predictionCloseMinutes);
        setDraft((current) => {
          const next = { ...current };
          for (const match of result.matchDay.matches) {
            const own = match.predictions.find((prediction) => prediction.userId === currentUserId);
            next[match.id] = {
              home: own ? String(own.predictedHomeScore) : (next[match.id]?.home ?? ''),
              away: own ? String(own.predictedAwayScore) : (next[match.id]?.away ?? ''),
            };
          }
          return next;
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Não foi possível abrir este dia.');
      }
    },
    [currentUserId],
  );

  useEffect(() => {
    void loadDays();
    const events = createPredictionBoardEvents(() => {
      if (Date.now() > skipNextDaysRefreshUntil.current) {
        void loadDays(true);
      }
      if (selectedId) void loadDay(selectedId, true);
    });
    const timer = setInterval(() => {
      void loadDays(true);
      if (selectedId) void loadDay(selectedId, true);
    }, 30_000);
    return () => {
      events.close();
      clearInterval(timer);
    };
  }, [loadDay, loadDays, refreshVersion, selectedId]);

  useEffect(() => {
    if (selectedId) void loadDay(selectedId);
  }, [loadDay, selectedId]);

  const completeOpenPredictions = useMemo(() => {
    if (!day) return [];
    return day.matches
      .filter((match) => match.isOpenForPredictions)
      .map((match) => {
        const values = draft[match.id];
        if (!values || values.home === '' || values.away === '') return null;
        return {
          matchId: match.id,
          predictedHomeScore: Number(values.home),
          predictedAwayScore: Number(values.away),
        };
      })
      .filter((prediction): prediction is NonNullable<typeof prediction> => Boolean(prediction));
  }, [day, draft]);

  async function saveDayPredictions() {
    if (!day || completeOpenPredictions.length === 0) return;
    setSavingAll(true);
    setError('');
    try {
      skipNextDaysRefreshUntil.current = Date.now() + 4000;
      await api.savePredictions(day.id, completeOpenPredictions);
      await loadDay(day.id, true);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Nao foi possivel salvar os palpites.');
    } finally {
      setSavingAll(false);
    }
  }

  /*
  async function saveMatch(match: Match) {
    const values = draft[match.id];
    if (!day || !values || values.home === '' || values.away === '') return;
    setSavingId(match.id);
    setError('');
    try {
      await api.savePredictions(day.id, [
        {
          matchId: match.id,
          predictedHomeScore: Number(values.home),
          predictedAwayScore: Number(values.away),
        },
      ]);
      await loadDay(day.id, true);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar o palpite.');
    } finally {
      setSavingId(null);
    }
  }
  */

  if (loading) return <ActivityIndicator color={c.green} style={styles.loader} />;

  const openCount = day?.matches.filter((match) => match.isOpenForPredictions).length ?? 0;
  const closedCount = (day?.matches.length ?? 0) - openCount;

  return (
    <View style={styles.page}>
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.pageTitle}>Jogos por dia</Text>
          <Text style={styles.pageSubtitle}>Preencha os placares e salve todos os palpites do dia.</Text>
        </View>
        <RulesBar closeMinutes={closeMinutes} />
      </View>

      <View style={[styles.datePanel, compact && styles.datePanelCompact]}>
        <View style={styles.dateScrollerShell}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            persistentScrollbar
            style={styles.dateScroller}
            contentContainerStyle={styles.dateRail}
          >
            {days.map((item) => {
              const selected = item.id === selectedId;
              const open = item.matches.filter((match) => match.isOpenForPredictions).length;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => setSelectedId(item.id)}
                  style={[styles.dateButton, selected && styles.dateButtonActive]}
                >
                  <Text style={[styles.dateButtonTitle, selected && styles.dateButtonTitleActive]}>
                    {shortDate(item.date)}
                  </Text>
                  <View style={styles.dateMeta}>
                    <View
                      style={[styles.dateDot, open > 0 ? styles.dateDotOpen : styles.dateDotClosed]}
                    />
                    <Text style={styles.dateButtonMeta}>{item.matches.length} jogos</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
        <View style={[styles.daySummary, compact && styles.daySummaryCompact]}>
          <Text style={styles.daySummaryText}>{openCount} abertos</Text>
          <Text style={styles.daySummaryDivider}>|</Text>
          <Text style={styles.daySummaryText}>{closedCount} fechados</Text>
        </View>
      </View>

      <SoftReveal key={day?.id ?? 'empty-day'} style={styles.matchesPanel}>
        {!compact ? (
          <View style={styles.matchHeaderRow}>
            <Text style={[styles.matchHeaderText, styles.timeColumn]}>Horário</Text>
            <Text style={[styles.matchHeaderText, styles.gameColumn]}>Jogo</Text>
            <Text style={[styles.matchHeaderText, styles.guessColumn]}>Palpite</Text>
            <Text style={[styles.matchHeaderText, styles.deadlineColumn]}>Prazo</Text>
            <Text style={[styles.matchHeaderText, styles.statusColumn]}>Status</Text>
            <Text style={[styles.matchHeaderText, styles.actionColumn]}>Ação</Text>
          </View>
        ) : null}
        {day?.matches.map((match) => {
          const open = Boolean(match.isOpenForPredictions);
          const values = draft[match.id] ?? { home: '', away: '' };
          const officialScore = score(match);
          const scoreInputs = (
            <View style={[styles.guessColumn, styles.scoreInputs, compact && styles.mobileGuess]}>
              <TextInput
                value={values.home}
                editable={open}
                keyboardType="number-pad"
                onChangeText={(home) =>
                  setDraft((current) => ({
                    ...current,
                    [match.id]: { ...values, home: home.replace(/\D/g, '').slice(0, 2) },
                  }))
                }
                style={[styles.scoreInput, !open && styles.scoreInputLocked]}
              />
              <Text style={styles.scoreSeparator}>x</Text>
              <TextInput
                value={values.away}
                editable={open}
                keyboardType="number-pad"
                onChangeText={(away) =>
                  setDraft((current) => ({
                    ...current,
                    [match.id]: { ...values, away: away.replace(/\D/g, '').slice(0, 2) },
                  }))
                }
                style={[styles.scoreInput, !open && styles.scoreInputLocked]}
              />
            </View>
          );
          const action = !open ? (
            <Pressable
              onPress={() => setPublicMatch(match)}
              style={styles.saveIconButton}
              accessibilityLabel="Ver palpites"
            >
              <Ionicons name="people-outline" size={19} color={c.gold} />
            </Pressable>
          ) : null;

          if (compact) {
            return (
              <View key={match.id} style={styles.mobileMatchCard}>
                <View style={styles.mobileMatchHeader}>
                  <View>
                    <Text style={styles.matchTime}>{time(match.startsAt)}</Text>
                    {match.status === 'LIVE' ? <Text style={styles.liveText}>AO VIVO</Text> : null}
                  </View>
                  <StatusBadge status={match.status} open={open} />
                </View>
                <View style={styles.mobileMatchup}>
                  <MatchTeamLabel team={match.homeTeam} side="home" />
                  <Text style={styles.mobileVersus}>{officialScore ?? 'x'}</Text>
                  <MatchTeamLabel team={match.awayTeam} side="away" />
                </View>
                <View style={styles.mobileMatchFooter}>
                  {scoreInputs}
                  <View style={styles.mobileDeadline}>
                    <Text style={styles.mobileMetaLabel}>Prazo</Text>
                    <Text style={styles.deadlineText}>
                      {match.predictionsCloseAt ? time(match.predictionsCloseAt) : '-'}
                    </Text>
                  </View>
                  {action ? <View style={styles.mobileAction}>{action}</View> : null}
                </View>
              </View>
            );
          }

          return (
            <View key={match.id} style={styles.matchRow}>
              <View style={styles.timeColumn}>
                <Text style={styles.matchTime}>{time(match.startsAt)}</Text>
                {match.status === 'LIVE' ? <Text style={styles.liveText}>AO VIVO</Text> : null}
              </View>
              <View style={[styles.gameColumn, styles.gameTeams]}>
                <MatchTeamLabel team={match.homeTeam} side="home" />
                <Text style={styles.versus}>{officialScore ?? 'x'}</Text>
                <MatchTeamLabel team={match.awayTeam} side="away" />
              </View>
              {scoreInputs}
              <View style={styles.deadlineColumn}>
                <Text style={styles.deadlineText}>
                  {match.predictionsCloseAt ? `Até ${time(match.predictionsCloseAt)}` : '-'}
                </Text>
              </View>
              <View style={styles.statusColumn}>
                <StatusBadge status={match.status} open={open} />
              </View>
              <View style={[styles.actionColumn, styles.actionButtons]}>
                {action ?? <Text style={styles.noActionText}>-</Text>}
              </View>
            </View>
          );
        })}
        {!day ? <Text style={styles.muted}>Selecione uma data para ver os jogos.</Text> : null}
      </SoftReveal>

      {day ? (
        <View style={styles.bulkSaveBar}>
          <View style={styles.bulkSaveCopy}>
            <Text style={styles.bulkSaveTitle}>Salvar palpites do dia</Text>
            <Text style={styles.bulkSaveText}>
              {completeOpenPredictions.length} palpite(s) preenchido(s) em partidas abertas.
            </Text>
          </View>
          <Pressable
            onPress={() => void saveDayPredictions()}
            disabled={savingAll || completeOpenPredictions.length === 0}
            style={[
              styles.bulkSaveButton,
              (savingAll || completeOpenPredictions.length === 0) && styles.bulkSaveButtonDisabled,
            ]}
          >
            <Ionicons name="save-outline" size={19} color={c.bg} />
            <Text style={styles.bulkSaveButtonText}>
              {savingAll ? 'Salvando...' : 'Salvar todos'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PredictionsModal
        match={publicMatch}
        currentUserId={currentUserId}
        onClose={() => setPublicMatch(null)}
      />
      <Modal
        transparent
        animationType="fade"
        visible={saved}
        onRequestClose={() => setSaved(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.successCard}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark" size={42} color={c.bg} />
            </View>
            <Text style={styles.modalTitle}>Palpites salvos</Text>
            <Text style={styles.muted}>Seus placares foram registrados com sucesso.</Text>
            <Pressable onPress={() => setSaved(false)} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

type CupTab = 'groups' | 'knockout' | 'scorers';
type MatchFilter = 'all' | 'finished' | 'live' | 'upcoming';

function StandingTable({
  group,
  fullWidth = false,
}: {
  group: CupStandingGroup;
  fullWidth?: boolean;
}) {
  return (
    <View style={[styles.standingTable, fullWidth && styles.standingTableFull]}>
      <View style={styles.standingRow}>
        <Text style={[styles.standingCell, styles.rankCell]}>#</Text>
        <Text style={[styles.standingCell, styles.teamCell]}>Selecao</Text>
        <Text style={styles.standingCell}>J</Text>
        <Text style={styles.standingCell}>SG</Text>
        <Text style={styles.standingCell}>PTS</Text>
      </View>
      {group.rows.map((row) => (
        <View key={row.team.id} style={[styles.standingRow, row.rank <= 2 && styles.qualifiedRow]}>
          <Text style={[styles.standingCell, styles.rankCell]}>{row.rank}</Text>
          <View style={[styles.teamCell, styles.standingTeam]}>
            <TeamFlag team={row.team} size={13} />
            <Text style={styles.standingTeamName} numberOfLines={1}>
              {row.team.name}
            </Text>
          </View>
          <Text style={styles.standingCell}>{row.played}</Text>
          <Text style={styles.standingCell}>
            {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
          </Text>
          <Text style={[styles.standingCell, styles.pointsCell]}>{row.points}</Text>
        </View>
      ))}
    </View>
  );
}

function CupMatchLine({ match }: { match: CupMatchResult }) {
  const matchScore = score(match);
  return (
    <View style={styles.cupMatchLine}>
      <View style={styles.cupMatchWhen}>
        <Text style={styles.cupMatchDate}>{shortDate(match.startsAt)}</Text>
        <Text style={styles.cupMatchTime}>{time(match.startsAt)}</Text>
      </View>
      <View style={styles.cupMatchTeams}>
        <TeamName team={match.homeTeam} />
        <Text style={styles.cupMatchScore}>{matchScore ?? 'x'}</Text>
        <TeamName team={match.awayTeam} />
      </View>
      <Ionicons
        name={
          match.status === 'FINISHED'
            ? 'checkmark-circle-outline'
            : match.status === 'LIVE'
              ? 'radio-outline'
              : 'time-outline'
        }
        size={18}
        color={match.status === 'FINISHED' ? c.green : match.status === 'LIVE' ? c.red : c.gold}
      />
    </View>
  );
}

function matchPassesFilter(match: CupMatchResult, filter: MatchFilter) {
  if (filter === 'finished') return match.status === 'FINISHED';
  if (filter === 'live') return match.status === 'LIVE';
  if (filter === 'upcoming') return match.status !== 'FINISHED' && match.status !== 'LIVE';
  return true;
}

function GroupModule({
  group,
  matches,
  compact,
}: {
  group: CupStandingGroup;
  matches: CupMatchResult[];
  compact: boolean;
}) {
  return (
    <View style={[styles.groupModule, compact && styles.groupModuleFull]}>
      <Text style={styles.groupTitle}>Grupo {group.group}</Text>
      <View style={[styles.groupBody, compact && styles.groupBodyCompact]}>
        <StandingTable group={group} fullWidth={compact} />
        <View style={styles.groupMatches}>
          {matches.map((match) => (
            <CupMatchLine key={match.id} match={match} />
          ))}
          {matches.length === 0 ? (
            <Text style={styles.muted}>Nenhum jogo neste filtro.</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function ThirdPlacedForm({ values }: { values: CupStandingRow['lastFive'] }) {
  const recent = [...Array(Math.max(0, 5 - values.length)).fill('-'), ...values.slice(-5)];
  return (
    <View style={styles.thirdForm}>
      {recent.map((value, index) => (
        <View
          key={`${value}-${index}`}
          style={[
            styles.thirdFormBadge,
            value === 'W' && styles.thirdFormWin,
            value === 'D' && styles.thirdFormDraw,
            value === 'L' && styles.thirdFormLoss,
          ]}
        >
          <Text style={styles.thirdFormText}>
            {value === 'W' ? 'V' : value === 'D' ? 'E' : value === 'L' ? 'D' : '-'}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ThirdPlacedTable({ groups }: { groups: CupStandingGroup[] }) {
  const thirdPlaced = groups
    .map((group) => group.rows[2])
    .filter((row): row is CupStandingRow => Boolean(row))
    .sort(
      (rowA, rowB) =>
        rowB.points - rowA.points ||
        rowB.goalDifference - rowA.goalDifference ||
        rowB.goalsFor - rowA.goalsFor ||
        rowA.team.name.localeCompare(rowB.team.name, 'pt-BR'),
    );

  return (
    <View style={styles.thirdPlacedSection}>
      <View style={styles.thirdPlacedTitleRow}>
        <Ionicons name="trophy-outline" size={21} color={c.gold} />
        <View style={styles.thirdPlacedTitleCopy}>
          <Text style={styles.thirdPlacedTitle}>Equipes terceiras colocadas</Text>
          <Text style={styles.muted}>As oito melhores avançam para a fase eliminatória.</Text>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={styles.thirdPlacedTable}>
          <View style={[styles.thirdPlacedRow, styles.thirdPlacedHeader]}>
            <Text style={[styles.thirdPlacedCell, styles.thirdRankColumn]}>#</Text>
            <Text style={[styles.thirdPlacedCell, styles.thirdTeamColumn]}>Seleção</Text>
            <Text style={styles.thirdPlacedCell}>J</Text>
            <Text style={styles.thirdPlacedCell}>V</Text>
            <Text style={styles.thirdPlacedCell}>E</Text>
            <Text style={styles.thirdPlacedCell}>D</Text>
            <Text style={styles.thirdPlacedCell}>SG</Text>
            <Text style={styles.thirdPlacedCell}>GP</Text>
            <Text style={[styles.thirdPlacedCell, styles.thirdFormColumn]}>Últimos 5</Text>
            <Text style={[styles.thirdPlacedCell, styles.thirdPointsColumn]}>PTS</Text>
          </View>
          {thirdPlaced.map((row, index) => {
            const qualified = index < 8;
            return (
              <View
                key={`${row.group}-${row.team.id}`}
                style={[styles.thirdPlacedRow, qualified && styles.thirdPlacedQualifiedRow]}
              >
                <View style={[styles.thirdRank, qualified && styles.thirdRankQualified]}>
                  <Text style={[styles.thirdRankText, qualified && styles.thirdRankTextQualified]}>
                    {index + 1}
                  </Text>
                </View>
                <View style={[styles.thirdTeamColumn, styles.thirdTeam]}>
                  <TeamFlag team={row.team} size={18} />
                  <View style={styles.thirdTeamCopy}>
                    <Text style={styles.thirdTeamName} numberOfLines={1}>{row.team.name}</Text>
                    <Text style={styles.thirdGroupLabel}>Grupo {row.group}</Text>
                  </View>
                </View>
                <Text style={styles.thirdPlacedCell}>{row.played}</Text>
                <Text style={styles.thirdPlacedCell}>{row.wins}</Text>
                <Text style={styles.thirdPlacedCell}>{row.draws}</Text>
                <Text style={styles.thirdPlacedCell}>{row.losses}</Text>
                <Text style={styles.thirdPlacedCell}>
                  {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                </Text>
                <Text style={styles.thirdPlacedCell}>{row.goalsFor}</Text>
                <View style={styles.thirdFormColumn}><ThirdPlacedForm values={row.lastFive} /></View>
                <Text style={[styles.thirdPlacedCell, styles.thirdPointsColumn]}>{row.points}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const stageLabels: Record<KnockoutFixture['stage'], string> = {
  ROUND_OF_32: '32 avos',
  ROUND_OF_16: 'Oitavas',
  QUARTER_FINAL: 'Quartas',
  SEMI_FINAL: 'Semifinais',
  THIRD_PLACE: 'Terceiro lugar',
  FINAL: 'Final',
};

export function CupOverviewV2({ refreshVersion }: { refreshVersion: number }) {
  const { width } = useWindowDimensions();
  const [overview, setOverview] = useState<CupOverview | null>(null);
  const [tab, setTab] = useState<CupTab>('groups');
  const [filter, setFilter] = useState<MatchFilter>('all');
  const [groupFilter, setGroupFilter] = useState('ALL');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setOverview(await api.cupOverview());
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar a Copa.');
    }
  }, []);

  useEffect(() => {
    void load();
    const events = createPredictionBoardEvents(() => void load());
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      events.close();
      clearInterval(timer);
    };
  }, [load, refreshVersion]);

  if (!overview) {
    return error ? (
      <Text style={styles.error}>{error}</Text>
    ) : (
      <ActivityIndicator color={c.green} style={styles.loader} />
    );
  }

  const visibleGroups = overview.standingsByGroup.filter(
    (group) => groupFilter === 'ALL' || group.group === groupFilter,
  );
  const fixturesByStage = overview.knockoutFixtures.reduce<Record<string, KnockoutFixture[]>>(
    (acc, fixture) => {
      acc[fixture.stage] = acc[fixture.stage] ?? [];
      acc[fixture.stage].push(fixture);
      return acc;
    },
    {},
  );

  return (
    <View style={styles.page}>
      <View style={styles.cupHeader}>
        <View>
          <Text style={styles.pageTitle}>Copa do Mundo 2026</Text>
          <Text style={styles.pageSubtitle}>
            Classificação e resultados oficiais em um único quadro.
          </Text>
        </View>
        <Text style={styles.updatedText}>Atualizado em {fullDateTime(overview.checkedAt)}</Text>
      </View>
      <View style={styles.cupTabs}>
        {[
          ['groups', 'people-outline', 'Fase de grupos'],
          ['knockout', 'git-network-outline', 'Eliminatórias'],
          ['scorers', 'football-outline', 'Artilharia'],
        ].map(([value, icon, label], index, tabs) => (
          <Pressable
            key={value}
            onPress={() => setTab(value as CupTab)}
            style={[styles.cupTab, tab === value && styles.cupTabActive]}
          >
            <Ionicons
              name={icon as keyof typeof Ionicons.glyphMap}
              size={17}
              color={tab === value ? c.bg : c.text}
            />
            <Text style={[styles.cupTabText, tab === value && styles.cupTabTextActive]}>
              {label}
            </Text>
            {index < tabs.length - 1 ? <View style={styles.cupTabDivider} /> : null}
          </Pressable>
        ))}
      </View>

      <SoftReveal key={tab === 'groups' ? `groups-${filter}-${groupFilter}` : tab}>
        {tab === 'groups' ? (
          <>
            <View style={styles.filtersRow}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterButtons}
              >
                {[
                  ['all', 'Todos'],
                  ['finished', 'Encerrados'],
                  ['live', 'Ao vivo'],
                  ['upcoming', 'Próximos'],
                ].map(([value, label]) => (
                  <Pressable
                    key={value}
                    onPress={() => setFilter(value as MatchFilter)}
                    style={[styles.filterButton, filter === value && styles.filterButtonActive]}
                  >
                    <Text
                      style={[
                        styles.filterButtonText,
                        filter === value && styles.filterButtonTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.groupFilterRail}
              >
                <Pressable
                  onPress={() => setGroupFilter('ALL')}
                  style={[
                    styles.groupFilterButton,
                    groupFilter === 'ALL' && styles.groupFilterButtonActive,
                  ]}
                >
                  <Text style={styles.groupFilterText}>Todos os grupos</Text>
                </Pressable>
                {overview.standingsByGroup.map((group) => (
                  <Pressable
                    key={group.group}
                    onPress={() => setGroupFilter(group.group)}
                    style={[
                      styles.groupFilterButton,
                      groupFilter === group.group && styles.groupFilterButtonActive,
                    ]}
                  >
                    <Text style={styles.groupFilterText}>{group.group}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <View style={[styles.groupsGrid, width < 820 && styles.groupsGridSingle]}>
              {visibleGroups.map((group) => (
                <GroupModule
                  key={group.group}
                  group={group}
                  compact={width < 820}
                  matches={overview.matches.filter(
                    (match) => match.group === group.group && matchPassesFilter(match, filter),
                  )}
                />
              ))}
            </View>
            <ThirdPlacedTable groups={overview.standingsByGroup} />
          </>
        ) : null}

        {tab === 'knockout' ? (
          <View style={styles.knockoutOverview}>
            {Object.entries(stageLabels).map(([stage, label]) => (
              <View key={stage} style={styles.knockoutStage}>
                <Text style={styles.groupTitle}>{label}</Text>
                <View style={styles.knockoutFixtureGrid}>
                  {(fixturesByStage[stage] ?? []).map((fixture) => (
                    <View key={fixture.id} style={styles.knockoutFixture}>
                      <Text style={styles.knockoutFixtureDate}>
                        {fullDateTime(fixture.startsAt)}
                      </Text>
                      <View style={styles.knockoutTeamLine}>
                        <TeamName team={fixture.homeTeam} />
                        <Text style={styles.knockoutScore}>{fixture.homeScore ?? '-'}</Text>
                      </View>
                      <View style={styles.knockoutTeamLine}>
                        <TeamName team={fixture.awayTeam} />
                        <Text style={styles.knockoutScore}>{fixture.awayScore ?? '-'}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {tab === 'scorers' ? (
          <View style={styles.scorersTable}>
            {overview.topScorers.map((scorer) => (
              <View key={`${scorer.rank}-${scorer.playerName}`} style={styles.scorerRow}>
                <Text style={styles.scorerRank}>{scorer.rank}</Text>
                {scorer.imageUrl ? (
                  <Image source={{ uri: scorer.imageUrl }} style={styles.scorerImage} />
                ) : (
                  <View style={styles.scorerImageFallback}>
                    <Ionicons name="person-outline" size={20} color={c.gold} />
                  </View>
                )}
                <View style={styles.scorerInfo}>
                  <Text style={styles.scorerName}>{scorer.playerName}</Text>
                  <Text style={styles.muted}>{scorer.teamName}</Text>
                </View>
                <Text style={styles.scorerGoals}>{scorer.goals}</Text>
              </View>
            ))}
            {overview.topScorers.length === 0 ? (
              <Text style={styles.muted}>Artilharia ainda sem dados coletados.</Text>
            ) : null}
          </View>
        ) : null}
      </SoftReveal>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  loader: { marginTop: 60 },
  pageHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  pageTitle: { color: c.text, fontSize: 28, fontWeight: '900' },
  pageSubtitle: { color: c.muted, fontSize: 14, marginTop: 4 },
  muted: { color: c.muted, fontSize: 13, lineHeight: 18 },
  error: { color: '#ffb5aa', fontSize: 14 },
  flag: { borderRadius: 2, borderWidth: 1, borderColor: c.line },
  flagFallback: {
    borderRadius: 2,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagFallbackText: { color: c.gold, fontSize: 7, fontWeight: '900' },
  teamNameLine: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamName: { minWidth: 0, flexShrink: 1, color: c.text, fontSize: 13, fontWeight: '800' },
  rulesBar: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 10,
    backgroundColor: c.panel,
    boxShadow: '0 16px 46px rgba(0,0,0,0.24)' as never,
  },
  ruleDeadline: { flexDirection: 'row', alignItems: 'center', gap: 7, marginRight: 8 },
  ruleDeadlineText: { color: c.gold, fontSize: 12, fontWeight: '900' },
  ruleItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rulePoints: {
    width: 28,
    height: 28,
    borderRadius: 5,
    textAlign: 'center',
    textAlignVertical: 'center',
    color: '#8bf0b6',
    borderWidth: 1,
    borderColor: c.greenDark,
    fontSize: 16,
    fontWeight: '900',
  },
  rulePointsMiss: { color: '#ff9a8e', borderColor: c.red },
  ruleLabel: { color: c.text, fontSize: 12 },
  datePanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    backgroundColor: c.panel,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 10,
    boxShadow: '0 16px 46px rgba(0,0,0,0.22)' as never,
  },
  datePanelCompact: { flexDirection: 'column', alignItems: 'stretch' },
  dateScrollerShell: {
    flex: 1,
    minWidth: 0,
    gap: 7,
  },
  dateScroller: {
    flex: 1,
    minWidth: 0,
    paddingBottom: 10,
    overflowX: 'scroll' as never,
    overflowY: 'hidden' as never,
    scrollbarColor: 'rgba(98, 164, 255, 0.72) rgba(1, 18, 55, 0.58)' as never,
    scrollbarWidth: 'thin' as never,
  },
  dateRail: { gap: 10, paddingRight: 8, paddingBottom: 2 },
  dateButton: {
    minWidth: 142,
    minHeight: 66,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 8,
    backgroundColor: 'rgba(1, 24, 64, 0.82)' as never,
    justifyContent: 'center',
    gap: 6,
  },
  dateButtonActive: {
    borderColor: c.green,
    backgroundColor: 'rgba(5, 43, 95, 0.78)' as never,
    boxShadow: '0 0 18px rgba(33, 214, 111, 0.15)' as never,
  },
  dateButtonTitle: { color: c.text, fontSize: 14, fontWeight: '900', textTransform: 'capitalize' },
  dateButtonTitleActive: { color: c.gold },
  dateMeta: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dateDot: { width: 9, height: 9, borderRadius: 5 },
  dateDotOpen: { backgroundColor: c.green },
  dateDotClosed: { backgroundColor: '#71827b' },
  dateButtonMeta: { color: c.muted, fontSize: 12 },
  daySummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginLeft: 'auto',
    paddingHorizontal: 12,
    minHeight: 42,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 10,
  },
  daySummaryCompact: { alignSelf: 'flex-start', marginLeft: 0 },
  daySummaryText: { color: c.text, fontSize: 12, fontWeight: '800' },
  daySummaryDivider: { color: c.lineStrong },
  matchesPanel: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: c.panel,
    boxShadow: '0 18px 54px rgba(0,0,0,0.28)' as never,
  },
  matchHeaderRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
    backgroundColor: 'rgba(4, 76, 112, 0.62)' as never,
  },
  matchHeaderText: { color: c.muted, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  matchRow: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
  },
  timeColumn: {
    width: '9%',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameColumn: {
    width: '39%',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guessColumn: {
    width: '18%',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deadlineColumn: {
    width: '13%',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusColumn: {
    width: '13%',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionColumn: {
    width: '8%',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchTime: { color: c.gold, fontSize: 16, fontWeight: '900' },
  liveText: { color: c.red, fontSize: 9, fontWeight: '900', marginTop: 3 },
  gameTeams: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 10,
  },
  matchTeamLabel: {
    flex: 1,
    minWidth: 0,
    maxWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
  },
  matchTeamLabelHome: { justifyContent: 'flex-end' },
  matchTeamName: {
    flexShrink: 1,
    color: c.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
  },
  versus: { color: c.gold, fontSize: 12, fontWeight: '900' },
  scoreInputs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  scoreInput: {
    width: 52,
    height: 42,
    borderWidth: 1,
    borderColor: c.lineStrong,
    borderRadius: 8,
    backgroundColor: 'rgba(1, 18, 55, 0.78)' as never,
    color: c.text,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '900',
    outlineStyle: 'none' as never,
  },
  scoreInputLocked: { color: c.muted, backgroundColor: 'rgba(2, 44, 96, 0.65)' as never },
  scoreSeparator: { color: c.gold, fontWeight: '900' },
  deadlineText: { color: c.muted, fontSize: 12 },
  statusBadge: {
    alignSelf: 'center',
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 8,
    backgroundColor: 'rgba(1, 18, 55, 0.54)' as never,
  },
  statusOpen: { borderColor: c.greenDark, backgroundColor: 'rgba(33,214,111,0.12)' as never },
  statusLive: { borderColor: c.red },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#71827b' },
  statusDotOpen: { backgroundColor: c.green },
  statusDotLive: { backgroundColor: c.red },
  statusText: { color: c.text, fontSize: 11, fontWeight: '800' },
  actionButtons: { alignItems: 'center', justifyContent: 'center' },
  noActionText: { color: c.muted, fontSize: 16, fontWeight: '900' },
  bulkSaveBar: {
    minHeight: 74,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 12,
    backgroundColor: c.panel,
    padding: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    boxShadow: '0 18px 54px rgba(0,0,0,0.22)' as never,
  },
  bulkSaveCopy: { flex: 1, minWidth: 0, gap: 4 },
  bulkSaveTitle: { color: c.text, fontSize: 16, fontWeight: '900' },
  bulkSaveText: { color: c.muted, fontSize: 12, fontWeight: '700' },
  bulkSaveButton: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: c.gold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    boxShadow: '0 14px 32px rgba(255,210,31,0.18)' as never,
  },
  bulkSaveButtonDisabled: {
    opacity: 0.48,
  },
  bulkSaveButtonText: { color: c.bg, fontSize: 14, fontWeight: '900' },
  mobileMatchCard: {
    padding: 14,
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
  },
  mobileMatchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  mobileMatchup: {
    width: '100%',
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mobileVersus: {
    minWidth: 34,
    color: c.gold,
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  mobileMatchFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  mobileGuess: { width: 'auto', flexShrink: 0 },
  mobileDeadline: { flex: 1, alignItems: 'center', gap: 3 },
  mobileMetaLabel: { color: c.muted, fontSize: 10, fontWeight: '800' },
  mobileAction: { width: 42, alignItems: 'flex-end' },
  saveIconButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(1, 18, 55, 0.78)' as never,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    width: '100%',
    maxWidth: 760,
    maxHeight: '80%',
    padding: 18,
    borderWidth: 1,
    borderColor: c.lineStrong,
    borderRadius: 12,
    backgroundColor: c.panel,
    boxShadow: '0 24px 80px rgba(0,0,0,0.45)' as never,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  modalTitleGroup: { flex: 1 },
  modalTitle: { color: c.text, fontSize: 20, fontWeight: '900' },
  iconButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 7,
  },
  modalMatchup: {
    minHeight: 112,
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 10,
    backgroundColor: 'rgba(1, 24, 64, 0.82)' as never,
  },
  modalMatchupCompact: { minHeight: 104, paddingHorizontal: 8, gap: 8 },
  modalTeam: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modalTeamName: {
    color: c.text,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '900',
    textAlign: 'center',
  },
  modalVersus: { width: 46, alignItems: 'center', justifyContent: 'center', gap: 4 },
  modalVersusText: { color: c.gold, fontSize: 20, fontWeight: '900' },
  modalMatchTime: { color: c.muted, fontSize: 10, fontWeight: '800' },
  modalList: { marginTop: 14 },
  predictionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  publicPrediction: {
    width: '31.8%',
    minWidth: 190,
    minHeight: 54,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 8,
    backgroundColor: 'rgba(1, 24, 64, 0.82)' as never,
  },
  publicPredictionCompact: { width: '100%', minWidth: 0 },
  publicPredictionMine: { borderColor: c.green },
  publicNickname: { flex: 1, color: c.text, fontSize: 12, fontWeight: '800' },
  publicScore: { color: c.gold, fontSize: 15, fontWeight: '900' },
  successCard: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 14,
    padding: 22,
    borderWidth: 1,
    borderColor: c.gold,
    borderRadius: 12,
    backgroundColor: c.panel,
  },
  successIcon: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: c.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    minWidth: 120,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: c.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: c.bg, fontWeight: '900' },
  cupHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 12,
  },
  updatedText: { color: c.muted, fontSize: 12 },
  cupTabs: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 7,
    overflow: 'hidden',
  },
  cupTab: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 18,
    position: 'relative',
  },
  cupTabDivider: {
    position: 'absolute',
    right: 0,
    top: '10%',
    width: 1,
    height: '80%',
    backgroundImage:
      'linear-gradient(180deg, transparent, rgba(188, 212, 244, 0.18) 22%, rgba(188, 212, 244, 0.24) 50%, rgba(188, 212, 244, 0.18) 78%, transparent)' as never,
  },
  cupTabActive: { backgroundColor: c.gold },
  cupTabText: { color: c.text, fontSize: 13, fontWeight: '800' },
  cupTabTextActive: { color: c.bg },
  filtersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  filterButtons: { gap: 6 },
  filterButton: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.line,
  },
  filterButtonActive: { backgroundColor: c.gold, borderColor: c.gold },
  filterButtonText: { color: c.text, fontSize: 12, fontWeight: '800' },
  filterButtonTextActive: { color: c.bg },
  groupFilterRail: { gap: 6 },
  groupFilterButton: {
    minHeight: 36,
    minWidth: 42,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.line,
  },
  groupFilterButtonActive: { borderColor: c.gold, backgroundColor: '#2d2a16' },
  groupFilterText: { color: c.text, fontSize: 12, fontWeight: '800' },
  groupsGrid: {
    width: '95%',
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 14,
  },
  groupsGridSingle: { width: '100%', flexDirection: 'column' },
  groupModule: {
    width: '49%',
    minWidth: 0,
    borderWidth: 0,
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  groupModuleFull: { width: '100%' },
  groupTitle: {
    color: c.gold,
    fontSize: 17,
    fontWeight: '900',
    paddingHorizontal: 0,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
    backgroundColor: 'rgba(4, 76, 112, 0.62)' as never,
  },
  groupBody: { flexDirection: 'row', minHeight: 260 },
  groupBodyCompact: { flexDirection: 'column' },
  standingTable: { width: '42%', minWidth: 230, borderRightWidth: 1, borderRightColor: c.line },
  standingTableFull: { width: '100%' },
  standingRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: c.line,
    paddingHorizontal: 6,
  },
  qualifiedRow: { borderLeftWidth: 4, borderLeftColor: c.green },
  standingCell: { width: 32, color: c.text, fontSize: 11, textAlign: 'center' },
  rankCell: { width: 24 },
  teamCell: { flex: 1, minWidth: 0, textAlign: 'left' },
  standingTeam: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  standingTeamName: { flexShrink: 1, color: c.text, fontSize: 11, fontWeight: '800' },
  pointsCell: { fontWeight: '900' },
  groupMatches: { flex: 1 },
  thirdPlacedSection: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: c.panel,
    boxShadow: '0 16px 48px rgba(0,0,0,0.24)' as never,
  },
  thirdPlacedTitleRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0,
    backgroundColor: 'transparent',
  },
  thirdPlacedTitleCopy: { flex: 1, gap: 2 },
  thirdPlacedTitle: { color: c.text, fontSize: 18, fontWeight: '900' },
  thirdPlacedTable: { minWidth: 820, width: '100%' },
  thirdPlacedRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderBottomWidth: 0,
  },
  thirdPlacedHeader: { minHeight: 38, backgroundColor: 'rgba(1, 18, 55, 0.72)' as never },
  thirdPlacedQualifiedRow: { borderLeftWidth: 3, borderLeftColor: c.green },
  thirdPlacedCell: { width: 48, color: c.text, fontSize: 11, textAlign: 'center' },
  thirdRankColumn: { width: 40 },
  thirdTeamColumn: { width: 240, minWidth: 240 },
  thirdTeam: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thirdTeamCopy: { minWidth: 0, flex: 1 },
  thirdTeamName: { color: c.text, fontSize: 12, fontWeight: '900' },
  thirdGroupLabel: { color: c.muted, fontSize: 9, marginTop: 1 },
  thirdRank: {
    width: 24,
    height: 24,
    marginHorizontal: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(184, 198, 221, 0.14)' as never,
  },
  thirdRankQualified: { backgroundColor: c.green },
  thirdRankText: { color: c.text, fontSize: 11, fontWeight: '900' },
  thirdRankTextQualified: { color: c.bg },
  thirdFormColumn: { width: 160, alignItems: 'center', justifyContent: 'center' },
  thirdPointsColumn: { width: 56, color: c.gold, fontWeight: '900' },
  thirdForm: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  thirdFormBadge: {
    width: 22,
    height: 22,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(184, 198, 221, 0.12)' as never,
  },
  thirdFormWin: { backgroundColor: c.green },
  thirdFormDraw: { backgroundColor: c.gold },
  thirdFormLoss: { backgroundColor: c.red },
  thirdFormText: { color: c.bg, fontSize: 10, fontWeight: '900' },
  cupMatchLine: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 9,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
  },
  cupMatchWhen: { width: 54 },
  cupMatchDate: { color: c.muted, fontSize: 9, textTransform: 'capitalize' },
  cupMatchTime: { color: c.text, fontSize: 10, fontWeight: '800' },
  cupMatchTeams: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  cupMatchScore: { color: c.gold, fontSize: 11, fontWeight: '900' },
  knockoutOverview: { gap: 14 },
  knockoutStage: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: c.panel,
  },
  knockoutFixtureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 12 },
  knockoutFixture: {
    width: 230,
    gap: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 8,
    backgroundColor: 'rgba(1, 24, 64, 0.82)' as never,
  },
  knockoutFixtureDate: { color: c.muted, fontSize: 10 },
  knockoutTeamLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  knockoutScore: { color: c.gold, fontSize: 14, fontWeight: '900' },
  scorersTable: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: c.panel,
    boxShadow: '0 16px 48px rgba(0,0,0,0.24)' as never,
  },
  scorerRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
  },
  scorerRank: { width: 28, color: c.gold, fontSize: 16, fontWeight: '900' },
  scorerImage: { width: 42, height: 42, borderRadius: 21 },
  scorerImageFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.bg,
    borderWidth: 1,
    borderColor: c.line,
  },
  scorerInfo: { flex: 1 },
  scorerName: { color: c.text, fontSize: 14, fontWeight: '900' },
  scorerGoals: { color: c.gold, fontSize: 22, fontWeight: '900' },
});
