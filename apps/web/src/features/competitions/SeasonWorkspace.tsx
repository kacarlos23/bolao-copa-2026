import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type {
  MatchDto,
  PublicMatchPredictionDto,
  RankingRowDto,
  RoundDto,
  SeasonDto,
  StandingRowDto,
} from '@bolao/shared';
import { useCompetition } from '../../app/CompetitionContext';
import { AsyncState, type AsyncStatus } from '../../components/AsyncState';
import { ConnectionIndicator } from '../../components/ConnectionIndicator';
import { ScoreInput } from '../../components/ScoreInput';
import { TeamBadge } from '../../components/TeamBadge';
import { RouteLink } from '../../navigation/RouteLink';
import { pathForLeagueTeam } from '../../navigation/routes';
import { useToast } from '../../components/Toast';
import {
  api,
  errorMessage,
  LatestRequest,
  type EngagementDashboard,
  type PoolSeasonRules,
  type RankingAward,
} from '../../api';
import {
  draftReducer,
  draftStorageKey,
  discardStoredDraft,
  hasDirtyDraft,
  loadDraft,
  persistDraft,
  registerActiveDraftGuard,
  saveStatusLabel,
  warnBeforeUnload,
  type DraftState,
} from '../../services/drafts';
import { createRealtimeClient, type ConnectionStatus } from '../../services/realtime';
import { registerActiveRefresh } from '../../services/active-refresh';
import { theme } from '../../theme/tokens';
import { PremiumRanking } from '../rankings/PremiumRanking';
import { PublicPredictionsModal } from './PublicPredictionsModal';
import {
  civilDateKey,
  civilMonthKey,
  groupPredictionMatchesByDay,
  predictionMonthWindow,
  preferredPredictionDayKey,
  shiftMonthKey,
} from './predictionDays';

const POOL_SLUG = 'bolao-do-trabalho';
type RankingScope = 'overall' | 'round' | 'month' | 'turn-1' | 'turn-2';
export type SeasonWorkspaceSection = 'all' | 'overview' | 'predictions' | 'standings' | 'ranking';

function formatMatchHour(value: string, timezone: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function civilKeyDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function capitalize(value: string) {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

function formatDayTitle(value: string) {
  return capitalize(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'UTC',
      weekday: 'long',
      day: '2-digit',
      month: 'long',
    }).format(civilKeyDate(value)),
  );
}

function formatDayTab(value: string) {
  return capitalize(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'UTC',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    })
      .format(civilKeyDate(value))
      .replace('.', ''),
  );
}

function formatMonthTitle(value: string) {
  return capitalize(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'UTC',
      month: 'long',
      year: 'numeric',
    }).format(civilKeyDate(`${value}-01`)),
  );
}

function predictionAvailability(
  match: MatchDto,
  round: RoundDto | undefined,
  rules: PoolSeasonRules | null,
) {
  if (!rules) {
    return {
      open: false,
      label: 'VERIFICANDO',
      reason: 'Verificando a janela de palpites desta competição.',
    };
  }
  const policy = rules?.predictionPolicy;
  if (policy && !policy.historicalMatchesScoreable) {
    if (policy.scoreableFrom) {
      if (new Date(match.startsAt).getTime() < new Date(policy.scoreableFrom).getTime()) {
        return {
          open: false,
          label: 'FORA DO BOLÃO',
          reason: 'Esta partida aconteceu antes do início dos palpites deste bolão.',
        };
      }
    } else {
      const gateRound = Math.max(policy.startsAtRound ?? 0, policy.scoreableFromRound ?? 0);
      if (gateRound > 0 && (!round || round.order < gateRound)) {
        return {
          open: false,
          label: 'FORA DO BOLÃO',
          reason: `Este bolão aceita palpites a partir da rodada ${gateRound}.`,
        };
      }
    }
  }
  if (match.status === 'POSTPONED') {
    return {
      open: false,
      label: 'ADIADO',
      reason: 'Partida adiada. O palpite reabre quando a nova data for publicada.',
    };
  }
  if (match.status === 'CANCELLED') {
    return { open: false, label: 'CANCELADO', reason: 'Partida cancelada.' };
  }
  if (match.status !== 'SCHEDULED') {
    return { open: false, label: match.status, reason: 'Esta partida não aceita novos palpites.' };
  }
  const closesAt = match.predictionClosesAt
    ? new Date(match.predictionClosesAt).getTime()
    : new Date(match.startsAt).getTime() - 5 * 60_000;
  if (closesAt <= Date.now()) {
    return { open: false, label: 'FECHADO', reason: 'O prazo para este palpite terminou.' };
  }
  return { open: true, label: 'ABERTO', reason: '' };
}

function isPredictionOpen(match: MatchDto, round?: RoundDto, rules: PoolSeasonRules | null = null) {
  return predictionAvailability(match, round, rules).open;
}

function predictionsDeadlinePassed(match: MatchDto) {
  const closesAt = match.predictionClosesAt
    ? new Date(match.predictionClosesAt).getTime()
    : new Date(match.startsAt).getTime() - 5 * 60_000;
  return closesAt <= Date.now();
}

function score(match: MatchDto) {
  const home =
    match.status === 'FINISHED' ? (match.finalHomeScore ?? match.homeScore) : match.homeScore;
  const away =
    match.status === 'FINISHED' ? (match.finalAwayScore ?? match.awayScore) : match.awayScore;
  return home == null || away == null ? null : `${home} × ${away}`;
}

function rankingQuery(scope: RankingScope, round: RoundDto | undefined, matches: MatchDto[]) {
  if (scope === 'round' && round) return `scope=round&roundId=${encodeURIComponent(round.id)}`;
  if (scope === 'month') {
    const source = matches[0]?.startsAt ?? round?.startsAt;
    if (source) {
      const date = new Date(source);
      return `scope=month&month=${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    }
  }
  if (scope === 'turn-1') return 'scope=turn&turn=1';
  if (scope === 'turn-2') return 'scope=turn&turn=2';
  return 'scope=overall';
}

function standingsTable(
  rows: StandingRowDto[],
  compact: boolean,
  onOpenTeam?: (teamId: string) => void,
) {
  return (
    <ScrollView horizontal={!compact} contentContainerStyle={styles.standingsScroller}>
      <View style={styles.standingsTable} accessibilityLabel="Classificação esportiva">
        <View style={[styles.standingRow, styles.standingHeader]}>
          <Text style={[styles.standingCell, styles.standingPosition]}>#</Text>
          <Text style={[styles.standingCell, styles.standingTeam]}>Clube</Text>
          <Text style={styles.standingCell}>J</Text>
          {!compact ? <Text style={styles.standingCell}>V</Text> : null}
          {!compact ? <Text style={styles.standingCell}>SG</Text> : null}
          <Text style={[styles.standingCell, styles.standingPoints]}>PTS</Text>
        </View>
        {rows.map((row) => (
          <View
            key={`${row.group}:${row.team.id}`}
            style={styles.standingRow}
            accessibilityLabel={`${row.rank}º ${row.team.name}, ${row.points} pontos`}
          >
            <Text style={[styles.standingCell, styles.standingPosition]}>{row.rank}</Text>
            {onOpenTeam ? (
              <RouteLink
                href={pathForLeagueTeam(row.team.id)}
                accessibilityLabel={`Abrir perfil de ${row.team.name}`}
                onActivate={() => onOpenTeam(row.team.id)}
                style={[styles.standingTeam, styles.standingIdentity]}
              >
                <TeamBadge team={row.team} kind="crest" size={34} />
                <Text style={styles.standingName} numberOfLines={1}>
                  {row.team.name}
                </Text>
              </RouteLink>
            ) : (
              <View style={[styles.standingTeam, styles.standingIdentity]}>
                <TeamBadge team={row.team} kind="crest" size={34} />
                <Text style={styles.standingName} numberOfLines={1}>
                  {row.team.name}
                </Text>
              </View>
            )}
            <Text style={styles.standingCell}>{row.played}</Text>
            {!compact ? <Text style={styles.standingCell}>{row.wins}</Text> : null}
            {!compact ? <Text style={styles.standingCell}>{row.goalDifference}</Text> : null}
            <Text style={[styles.standingCell, styles.standingPoints]}>{row.points}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function SeasonWorkspace({
  currentUserId,
  refreshVersion,
  section = 'all',
  onOpenTeam,
}: {
  currentUserId: string;
  refreshVersion: number;
  section?: SeasonWorkspaceSection;
  onOpenTeam?: (teamId: string) => void;
}) {
  const context = useCompetition();
  const { showToast } = useToast();
  const { width } = useWindowDimensions();
  const compact = width < 768;
  const isLeague = context.capabilities.has('LEAGUE');
  const [fallbackSeason, setFallbackSeason] = useState<SeasonDto | null>(null);
  const season = isLeague ? context.season : fallbackSeason;
  const [rounds, setRounds] = useState<RoundDto[]>([]);
  const [roundId, setRoundId] = useState('');
  const [matches, setMatches] = useState<MatchDto[]>([]);
  const [predictionMatches, setPredictionMatches] = useState<MatchDto[]>([]);
  const [predictionMonth, setPredictionMonth] = useState('');
  const [selectedDayKey, setSelectedDayKey] = useState('');
  const [standings, setStandings] = useState<StandingRowDto[]>([]);
  const [ranking, setRanking] = useState<RankingRowDto[]>([]);
  const [roundRanking, setRoundRanking] = useState<RankingRowDto[]>([]);
  const [rules, setRules] = useState<PoolSeasonRules | null>(null);
  const [engagement, setEngagement] = useState<EngagementDashboard | null>(null);
  const [awards, setAwards] = useState<RankingAward[]>([]);
  const [scope, setScope] = useState<RankingScope>('overall');
  const [draft, setDraft] = useState<DraftState>({ items: {} });
  const [poolSeasonId, setPoolSeasonId] = useState('');
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [error, setError] = useState('');
  const [predictionStatus, setPredictionStatus] = useState<AsyncStatus>('loading');
  const [predictionError, setPredictionError] = useState('');
  const [predictionRefreshVersion, setPredictionRefreshVersion] = useState(0);
  const [connection, setConnection] = useState<ConnectionStatus>('reconnecting');
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [workspaceRefreshVersion, setWorkspaceRefreshVersion] = useState(0);
  const [publicMatch, setPublicMatch] = useState<MatchDto | null>(null);
  const [publicPredictions, setPublicPredictions] = useState<PublicMatchPredictionDto[]>([]);
  const [publicPredictionsLoading, setPublicPredictionsLoading] = useState(false);
  const [publicPredictionsError, setPublicPredictionsError] = useState('');
  const selectedRound = rounds.find((round) => round.id === roundId);
  const dataRequest = useRef(new LatestRequest()).current;
  const predictionDataRequest = useRef(new LatestRequest()).current;
  const draftRef = useRef(draft);
  const hydratedStorageKeyRef = useRef('');
  const confirmedValuesRef = useRef<Record<string, { home: string; away: string }>>({});
  const visitedSeasonRef = useRef('');
  const publicPredictionsRequestRef = useRef(0);
  draftRef.current = draft;
  const stablePoolSeasonKey = season ? `pool:${POOL_SLUG}:season:${season.id}` : 'pending';
  const storageKey = draftStorageKey(currentUserId, stablePoolSeasonKey, 'league-predictions');
  const timezone = season?.timezone ?? 'America/Sao_Paulo';
  const predictionDays = groupPredictionMatchesByDay(
    predictionMatches,
    timezone,
    predictionMonth || undefined,
  );
  const selectedPredictionDay = predictionDays.find((day) => day.key === selectedDayKey);
  const selectedDayMatches = selectedPredictionDay?.matches ?? [];
  const todayKey = civilDateKey(new Date(), timezone);

  function dispatch(action: Parameters<typeof draftReducer>[1]) {
    setDraft((current) => draftReducer(current, action));
  }

  useEffect(() => {
    if (isLeague) {
      setFallbackSeason(null);
      return;
    }
    api
      .brasileiraoSeasons()
      .then((result) => {
        setFallbackSeason(
          result.seasons.find((item) => item.status === 'ACTIVE') ?? result.seasons[0] ?? null,
        );
      })
      .catch((cause) => setError(errorMessage(cause)));
  }, [isLeague]);

  useEffect(() => {
    if (!season) return;
    setRules(null);
    setPredictionMonth(civilMonthKey(new Date(), season.timezone));
    setSelectedDayKey('');
    setPredictionMatches([]);
  }, [season?.id, season?.timezone]);

  useEffect(() => {
    if (!season) return;
    setStatus('loading');
    api
      .seasonRounds(season.id)
      .then((result) => {
        setRounds(result.rounds);
        const active =
          result.rounds.find((round) => round.status === 'ACTIVE') ??
          result.rounds.find((round) => round.order === 20) ??
          result.rounds[0];
        setRoundId(active?.id ?? '');
      })
      .catch((cause) => {
        setError(errorMessage(cause));
        setStatus('error');
      });
  }, [season?.id, refreshVersion]);

  useEffect(() => {
    if (!season || !roundId) return;
    let active = true;
    const load = async (quiet = false) => {
      if (!quiet) setStatus(matches.length ? 'refreshing' : 'loading');
      const result = await dataRequest.run(async () => {
        const query = rankingQuery(scope, selectedRound, matches);
        const [
          matchesResult,
          standingsResult,
          predictionsResult,
          rankingResult,
          roundResult,
          rulesResult,
          engagementResult,
          awardsResult,
        ] = await Promise.all([
          api.seasonMatches(season.id, roundId),
          api.seasonStandings(season.id),
          api.seasonPredictions(POOL_SLUG, season.id),
          api.seasonRanking(POOL_SLUG, season.id, query),
          api.seasonRanking(
            POOL_SLUG,
            season.id,
            `scope=round&roundId=${encodeURIComponent(roundId)}`,
          ),
          api.seasonRules(POOL_SLUG, season.id),
          api.seasonEngagement(POOL_SLUG, season.id),
          api.seasonAwards(POOL_SLUG, season.id).catch(() => ({ awards: [] })),
        ]);
        return {
          matchesResult,
          standingsResult,
          predictionsResult,
          rankingResult,
          roundResult,
          rulesResult,
          engagementResult,
          awardsResult,
        };
      });
      if (!active || !result) return;
      const values = Object.fromEntries(
        result.predictionsResult.predictions.map((prediction) => [
          prediction.matchId,
          {
            home: String(prediction.predictedHomeScore),
            away: String(prediction.predictedAwayScore),
          },
        ]),
      );
      confirmedValuesRef.current = { ...confirmedValuesRef.current, ...values };
      const resolvedPoolSeasonId = result.predictionsResult.predictions[0]?.poolSeasonId;
      if (resolvedPoolSeasonId) setPoolSeasonId(resolvedPoolSeasonId);
      setMatches(result.matchesResult.matches);
      setStandings(result.standingsResult.standingsByGroup.flatMap((group) => group.rows));
      setRanking(result.rankingResult.ranking);
      setRoundRanking(result.roundResult.ranking);
      setRules(result.rulesResult);
      setEngagement(result.engagementResult);
      setAwards(result.awardsResult.awards);
      dispatch({ type: 'hydrate', values });
      setError('');
      setStatus(result.matchesResult.matches.length ? 'success' : 'empty');

      if (visitedSeasonRef.current !== season.id) {
        visitedSeasonRef.current = season.id;
        try {
          const visit = await api.recordRankingVisit(POOL_SLUG, season.id);
          void visit.summary;
        } catch {
          visitedSeasonRef.current = '';
        }
      }
    };
    void load();
    const interval = setInterval(() => void load(true), 30_000);
    const realtime = createRealtimeClient({
      seasonId: season.id,
      poolSeasonId: poolSeasonId || undefined,
      eventTypes: [
        'prediction.updated',
        'ranking.updated',
        'match.updated',
        'provider.sync.completed',
      ],
      onEvent: () => {
        void load(true);
        setPredictionRefreshVersion((version) => version + 1);
      },
      onStatus: setConnection,
    });
    return () => {
      active = false;
      clearInterval(interval);
      realtime.close();
      dataRequest.cancel();
    };
  }, [season?.id, roundId, scope, refreshVersion, workspaceRefreshVersion, poolSeasonId]);

  useEffect(() => {
    if (!season) return;
    api
      .seasonSyncStatus(POOL_SLUG, season.id)
      .then((result) => setLastSyncedAt(result.lastSyncedAt))
      .catch(() => undefined);
  }, [season?.id]);

  async function refreshOfficialResults() {
    if (!season || syncing) return;
    setSyncing(true);
    try {
      const result = await api.syncSeasonResults(POOL_SLUG, season.id);
      setLastSyncedAt(result.lastSyncedAt);
      setWorkspaceRefreshVersion((version) => version + 1);
      showToast(
        result.changedMatches
          ? `${result.changedMatches} ${result.changedMatches === 1 ? 'jogo atualizado' : 'jogos atualizados'}.`
          : 'Nenhuma alteração encontrada.',
        'success',
      );
    } catch (cause) {
      showToast(`Não foi possível sincronizar a fonte oficial. ${errorMessage(cause)}`, 'error');
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => registerActiveRefresh(refreshOfficialResults), [season?.id, syncing]);

  useEffect(() => {
    if (!season || !predictionMonth || (section !== 'predictions' && section !== 'all')) return;
    let active = true;
    const load = async (quiet = false) => {
      if (!quiet) setPredictionStatus(predictionMatches.length ? 'refreshing' : 'loading');
      try {
        const window = predictionMonthWindow(predictionMonth);
        const result = await predictionDataRequest.run((signal) =>
          Promise.all([
            api.seasonMatches(season.id, { ...window, signal }),
            api.seasonRules(POOL_SLUG, season.id),
          ]),
        );
        if (!active || !result) return;
        const [matchesResult, rulesResult] = result;
        const days = groupPredictionMatchesByDay(
          matchesResult.matches,
          season.timezone,
          predictionMonth,
        );
        setPredictionMatches(matchesResult.matches);
        setRules(rulesResult);
        setSelectedDayKey((current) =>
          days.some((day) => day.key === current)
            ? current
            : preferredPredictionDayKey(days, season.timezone, (match) =>
                isPredictionOpen(
                  match,
                  rounds.find((round) => round.id === match.roundId),
                  rulesResult,
                ),
              ),
        );
        setPredictionError('');
        setPredictionStatus(days.length ? 'success' : 'empty');
      } catch (cause) {
        if (!active) return;
        setPredictionError(errorMessage(cause));
        setPredictionStatus('error');
      }
    };
    void load();
    const interval = setInterval(() => void load(true), 30_000);
    return () => {
      active = false;
      clearInterval(interval);
      predictionDataRequest.cancel();
    };
  }, [
    season?.id,
    season?.timezone,
    predictionMonth,
    refreshVersion,
    predictionRefreshVersion,
    section,
  ]);

  useEffect(() => {
    if (!selectedPredictionDay || !season) return;
    let active = true;
    const matchDayIds = [
      ...new Set(selectedPredictionDay.matches.map((match) => match.matchDayId)),
    ];
    void Promise.all(
      matchDayIds.map((matchDayId) => api.seasonPredictions(POOL_SLUG, season.id, matchDayId)),
    )
      .then((results) => {
        if (!active) return;
        const predictions = results.flatMap((result) => result.predictions);
        const resolvedPoolSeasonId = predictions[0]?.poolSeasonId;
        if (resolvedPoolSeasonId) setPoolSeasonId(resolvedPoolSeasonId);
        const values = Object.fromEntries(
          predictions.map((prediction) => [
            prediction.matchId,
            {
              home: String(prediction.predictedHomeScore),
              away: String(prediction.predictedAwayScore),
            },
          ]),
        );
        confirmedValuesRef.current = { ...confirmedValuesRef.current, ...values };
        dispatch({
          type: 'hydrate',
          values,
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [season?.id, selectedDayKey, predictionMatches]);

  useEffect(() => {
    hydratedStorageKeyRef.current = '';
    confirmedValuesRef.current = {};
    const stored = loadDraft(storageKey);
    setDraft(hasDirtyDraft(stored) ? stored : { items: {} });
  }, [storageKey]);

  useEffect(() => {
    if (hydratedStorageKeyRef.current !== storageKey) {
      hydratedStorageKeyRef.current = storageKey;
      return;
    }
    persistDraft(storageKey, draft);
  }, [draft, storageKey]);
  useEffect(() => warnBeforeUnload(() => hasDirtyDraft(draftRef.current)), []);
  useEffect(
    () =>
      registerActiveDraftGuard({
        key: storageKey,
        userId: currentUserId,
        isDirty: () =>
          hydratedStorageKeyRef.current === storageKey && hasDirtyDraft(draftRef.current),
        discard: () => {
          discardStoredDraft(storageKey);
          setDraft(
            draftReducer({ items: {} }, { type: 'hydrate', values: confirmedValuesRef.current }),
          );
        },
      }),
    [currentUserId, storageKey],
  );

  async function saveMatches(matchIds: string[]) {
    if (!season) return;
    const valid = matchIds.flatMap((matchId) => {
      const match = predictionMatches.find((item) => item.id === matchId);
      const item = draft.items[matchId];
      if (!match || !item || item.value.home === '' || item.value.away === '') return [];
      return [{ match, item }];
    });
    if (!valid.length) {
      showToast('Preencha os dois placares antes de salvar.', 'error');
      return;
    }
    const ids = valid.map(({ match }) => match.id);
    const submittedValues = Object.fromEntries(
      valid.map(({ match, item }) => [match.id, { ...item.value }]),
    );
    dispatch({ type: 'saving', itemIds: ids });
    const grouped = new Map<string, typeof valid>();
    for (const entry of valid) {
      const entries = grouped.get(entry.match.matchDayId) ?? [];
      entries.push(entry);
      grouped.set(entry.match.matchDayId, entries);
    }
    const groups = [...grouped.entries()];
    const results = await Promise.allSettled(
      groups.map(([matchDayId, entries]) =>
        api.saveSeasonPredictions(
          POOL_SLUG,
          season.id,
          matchDayId,
          entries.map(({ match, item }) => ({
            matchId: match.id,
            predictedHomeScore: Number(item.value.home),
            predictedAwayScore: Number(item.value.away),
          })),
        ),
      ),
    );
    const saved = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value.predictions : [],
    );
    const failures = results.flatMap((result, index) => {
      if (result.status === 'fulfilled') return [];
      const failedIds = groups[index]?.[1].map(({ match }) => match.id) ?? [];
      const message = errorMessage(result.reason);
      dispatch({ type: 'failed', itemIds: failedIds, error: message });
      return [message];
    });
    if (saved[0]?.poolSeasonId) setPoolSeasonId(saved[0].poolSeasonId);
    if (saved.length) {
      confirmedValuesRef.current = {
        ...confirmedValuesRef.current,
        ...Object.fromEntries(
          saved.flatMap((item) =>
            submittedValues[item.matchId] ? [[item.matchId, submittedValues[item.matchId]]] : [],
          ),
        ),
      };
      dispatch({
        type: 'saved',
        itemIds: saved.map((item) => item.matchId),
        submittedValues,
      });
      showToast(
        `${saved.length} ${saved.length === 1 ? 'palpite salvo' : 'palpites salvos'}.`,
        'success',
      );
    }
    if (failures.length) showToast(failures[0] ?? 'Não foi possível salvar.', 'error');
  }

  async function togglePreference(field: 'pushEnabled' | 'emailEnabled' | 'quietHoursEnabled') {
    if (!season || !engagement) return;
    const enabled = !engagement.preferences[field];
    const next = {
      ...engagement.preferences,
      [field]: enabled,
      ...(field === 'quietHoursEnabled' && enabled
        ? {
            quietHoursStart: engagement.preferences.quietHoursStart ?? '22:00',
            quietHoursEnd: engagement.preferences.quietHoursEnd ?? '08:00',
          }
        : {}),
    };
    const result = await api.updateNotificationPreferences(POOL_SLUG, season.id, next);
    setEngagement({ ...engagement, preferences: result.preferences });
  }

  async function openPublicPredictions(match: MatchDto) {
    if (!season || !predictionsDeadlinePassed(match)) return;
    const requestId = publicPredictionsRequestRef.current + 1;
    publicPredictionsRequestRef.current = requestId;
    setPublicMatch(match);
    setPublicPredictions([]);
    setPublicPredictionsError('');
    setPublicPredictionsLoading(true);
    try {
      const result = await api.seasonPublicMatchPredictions(POOL_SLUG, season.id, match.id);
      if (publicPredictionsRequestRef.current !== requestId) return;
      setPublicPredictions(result.predictions);
    } catch (cause) {
      if (publicPredictionsRequestRef.current !== requestId) return;
      setPublicPredictionsError(errorMessage(cause));
    } finally {
      if (publicPredictionsRequestRef.current === requestId) setPublicPredictionsLoading(false);
    }
  }

  function closePublicPredictions() {
    publicPredictionsRequestRef.current += 1;
    setPublicMatch(null);
    setPublicPredictions([]);
    setPublicPredictionsError('');
    setPublicPredictionsLoading(false);
  }

  if (!season && status === 'loading') return <AsyncState status="loading" skeletonLines={6} />;

  const dirtyOpenIds = selectedDayMatches
    .filter(
      (match) =>
        isPredictionOpen(
          match,
          rounds.find((round) => round.id === match.roundId),
          rules,
        ) && draft.items[match.id]?.status === 'dirty',
    )
    .map((match) => match.id);

  const sectionSubtitle: Record<SeasonWorkspaceSection, string> = {
    all: 'Palpites, classificação e ranking no mesmo contexto de temporada.',
    overview: 'Resumo da temporada, regras e seu progresso no bolão.',
    predictions: 'Escolha o dia, preencha os placares e acompanhe cada salvamento.',
    standings: 'Tabela oficial da liga, separada dos palpites e do ranking do bolão.',
    ranking: 'Sua posição, o rival mais próximo e os critérios de desempate.',
  };

  return (
    <View style={styles.page} accessibilityLabel={season?.name ?? 'Temporada de liga'}>
      <View style={[styles.titleRow, compact && styles.titleRowCompact]}>
        <View>
          <Text style={styles.eyebrow}>TEMPORADA · LIGA</Text>
          <Text role="heading" aria-level={1} style={styles.title}>
            {season?.name ?? 'Competição'}
          </Text>
          <Text style={styles.subtitle}>{sectionSubtitle[section]}</Text>
        </View>
        <ConnectionIndicator status={connection} />
      </View>

      {(section === 'overview' || section === 'all') && rules ? (
        <View
          style={styles.rulesPanel}
          accessibilityLabel={`Regra de pontuação ${rules.scoring.name}, versão ${rules.scoring.version}`}
        >
          <View>
            <Text style={styles.sectionEyebrow}>REGULAMENTO · VERSÃO {rules.scoring.version}</Text>
            <Text style={styles.sectionTitle}>Como seus pontos e empates são calculados</Text>
            <Text style={styles.rulesHelp}>
              A regra vinculada à temporada fica registrada em cada score. Empates completos
              compartilham posição.
            </Text>
          </View>
          <View style={styles.rulePointsRow}>
            {[
              [rules.scoring.rules.exactScore, 'Placar exato'],
              [rules.scoring.rules.correctOutcome, 'Resultado'],
              [rules.scoring.rules.oneTeamGoals, 'Gol de um time'],
              [rules.scoring.rules.miss, 'Erro'],
            ].map(([points, label]) => (
              <Text key={label} style={styles.ruleChip}>
                {points} pts · {label}
              </Text>
            ))}
          </View>
          <Text style={styles.tieBreakText}>
            Desempate: {rules.tieBreakers.criteria.map((item) => item.label).join(' → ')}.
          </Text>
        </View>
      ) : null}

      {section === 'overview' ? (
        <View style={styles.overviewStrip} accessibilityLabel="Resumo da temporada">
          {[
            ['Rodada atual', selectedRound?.name ?? 'A definir'],
            ['Jogos na rodada', String(matches.length)],
            ['Clubes na tabela', String(standings.length)],
            ['Participantes', String(ranking.length)],
          ].map(([label, value], index) => (
            <View
              key={label}
              style={[
                styles.overviewMetric,
                index > 0 &&
                  (compact ? styles.overviewMetricDividerCompact : styles.overviewMetricDivider),
              ]}
            >
              <Text style={styles.overviewMetricLabel}>{label}</Text>
              <Text style={styles.overviewMetricValue}>{value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {section === 'ranking' || section === 'all' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.roundRail}
          accessibilityLabel="Rodadas disponíveis"
        >
          {rounds.map((round) => {
            const selected = round.id === roundId;
            return (
              <Pressable
                key={round.id}
                {...({ 'aria-pressed': selected } as never)}
                accessibilityRole="button"
                onPress={() => setRoundId(round.id)}
                style={[styles.roundTab, selected && styles.roundTabActive]}
              >
                <Text style={[styles.roundText, selected && styles.roundTextActive]}>
                  {round.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {section === 'predictions' || section === 'all' ? (
        <View style={styles.predictionAgenda}>
          <View style={[styles.calendarToolbar, compact && styles.calendarToolbarCompact]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mês anterior"
              onPress={() => {
                setSelectedDayKey('');
                setPredictionMonth((month) =>
                  shiftMonthKey(month || civilMonthKey(new Date(), timezone), -1),
                );
              }}
              style={styles.monthButton}
            >
              <Text style={styles.monthButtonText}>‹</Text>
            </Pressable>
            <View style={styles.monthIdentity} accessibilityLiveRegion="polite">
              <Text style={styles.sectionEyebrow}>AGENDA POR DATA</Text>
              <Text style={styles.monthTitle}>
                {predictionMonth ? formatMonthTitle(predictionMonth) : 'Calendário'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Próximo mês"
              onPress={() => {
                setSelectedDayKey('');
                setPredictionMonth((month) =>
                  shiftMonthKey(month || civilMonthKey(new Date(), timezone), 1),
                );
              }}
              style={styles.monthButton}
            >
              <Text style={styles.monthButtonText}>›</Text>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            accessibilityRole="tablist"
            accessibilityLabel="Dias com jogos"
            showsHorizontalScrollIndicator
            contentContainerStyle={styles.dayRail}
          >
            {predictionDays.map((day) => {
              const selected = day.key === selectedDayKey;
              const openCount = day.matches.filter((match) =>
                isPredictionOpen(
                  match,
                  rounds.find((round) => round.id === match.roundId),
                  rules,
                ),
              ).length;
              const dirtyCount = day.matches.filter(
                (match) => draft.items[match.id]?.status === 'dirty',
              ).length;
              const title = day.key === todayKey ? 'Hoje' : formatDayTab(day.key);
              return (
                <Pressable
                  key={day.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${title}, ${day.matches.length} ${
                    day.matches.length === 1 ? 'jogo' : 'jogos'
                  }, ${openCount} ${openCount === 1 ? 'aberto' : 'abertos'}${
                    dirtyCount
                      ? `, ${dirtyCount} ${dirtyCount === 1 ? 'não salvo' : 'não salvos'}`
                      : ''
                  }`}
                  onPress={() => setSelectedDayKey(day.key)}
                  style={[styles.dayTab, selected && styles.dayTabActive]}
                >
                  <Text style={[styles.dayTabTitle, selected && styles.dayTabTitleActive]}>
                    {title}
                  </Text>
                  <Text style={[styles.dayTabMeta, selected && styles.dayTabMetaActive]}>
                    {day.matches.length} {day.matches.length === 1 ? 'jogo' : 'jogos'}
                    {openCount ? ` · ${openCount} ${openCount === 1 ? 'aberto' : 'abertos'}` : ''}
                  </Text>
                  {dirtyCount ? (
                    <Text style={styles.dayTabDirty}>
                      {dirtyCount} {dirtyCount === 1 ? 'não salvo' : 'não salvos'}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>

          <AsyncState
            status={predictionStatus}
            error={predictionError}
            emptyTitle="Nenhum jogo neste mês"
            emptyMessage="Navegue pelos meses para encontrar as próximas partidas publicadas."
            onRetry={() => setPredictionRefreshVersion((version) => version + 1)}
            skeletonLines={6}
          >
            {predictionStatus === 'loading' ||
            (predictionStatus === 'error' && !predictionMatches.length) ? null : (
              <View style={[styles.columns, compact && styles.columnsCompact]}>
                <View style={styles.matchesColumn}>
                  <View style={[styles.sectionHeading, compact && styles.sectionHeadingCompact]}>
                    <View accessibilityLiveRegion="polite">
                      <Text style={styles.sectionEyebrow}>PALPITES DO DIA</Text>
                      <Text role="heading" aria-level={2} style={styles.sectionTitle}>
                        {selectedDayKey ? formatDayTitle(selectedDayKey) : 'Selecione uma data'}
                      </Text>
                    </View>
                    <Text style={styles.sectionMeta}>
                      {selectedDayMatches.length}{' '}
                      {selectedDayMatches.length === 1 ? 'jogo' : 'jogos'}
                    </Text>
                  </View>
                  <View style={styles.matchList}>
                    {selectedDayMatches.map((match) => {
                      const item = draft.items[match.id];
                      const value = item?.value ?? { home: '', away: '' };
                      const round = rounds.find((candidate) => candidate.id === match.roundId);
                      const availability = predictionAvailability(match, round, rules);
                      const open = availability.open;
                      const official = score(match);
                      const publicAvailable = predictionsDeadlinePassed(match);
                      const errorText = item?.status === 'failed' ? item.error : undefined;
                      return (
                        <View
                          key={match.id}
                          style={styles.matchRow}
                          accessibilityLabel={`${match.homeTeam.name} contra ${match.awayTeam.name}`}
                        >
                          <View style={styles.matchMeta}>
                            <View style={styles.matchContext}>
                              <Text style={styles.matchTime}>
                                {formatMatchHour(match.startsAt, timezone)}
                              </Text>
                              {round ? <Text style={styles.roundMeta}>{round.name}</Text> : null}
                            </View>
                            <Text style={[styles.matchStatus, open ? styles.open : styles.closed]}>
                              {match.status === 'FINISHED'
                                ? 'FINAL'
                                : match.status === 'LIVE'
                                  ? 'AO VIVO'
                                  : availability.label}
                            </Text>
                          </View>
                          <View style={[styles.matchup, compact && styles.matchupCompact]}>
                            <View style={styles.teamIdentity}>
                              <TeamBadge team={match.homeTeam} kind="crest" size={34} />
                              <Text style={styles.teamName}>{match.homeTeam.name}</Text>
                            </View>
                            {official ? (
                              <Text style={styles.officialScore}>{official}</Text>
                            ) : (
                              <View style={styles.scoreGroup}>
                                <ScoreInput
                                  teamName={match.homeTeam.name}
                                  side="home"
                                  value={value.home}
                                  editable={open}
                                  error={errorText}
                                  onChange={(home) =>
                                    dispatch({
                                      type: 'edit',
                                      itemId: match.id,
                                      side: 'home',
                                      value: home,
                                    })
                                  }
                                />
                                <Text style={styles.versus}>×</Text>
                                <ScoreInput
                                  teamName={match.awayTeam.name}
                                  side="away"
                                  value={value.away}
                                  editable={open}
                                  onChange={(away) =>
                                    dispatch({
                                      type: 'edit',
                                      itemId: match.id,
                                      side: 'away',
                                      value: away,
                                    })
                                  }
                                />
                              </View>
                            )}
                            <View style={styles.teamIdentity}>
                              <TeamBadge team={match.awayTeam} kind="crest" size={34} />
                              <Text style={styles.teamName}>{match.awayTeam.name}</Text>
                            </View>
                          </View>
                          {!official && !open && availability.reason ? (
                            <Text style={styles.unavailableReason}>{availability.reason}</Text>
                          ) : null}
                          {!official ? (
                            <View style={styles.saveRow}>
                              <Text
                                accessibilityLiveRegion="polite"
                                style={[
                                  styles.saveState,
                                  item?.status === 'failed' && styles.failed,
                                ]}
                              >
                                {saveStatusLabel(item)}
                              </Text>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Salvar palpite de ${match.homeTeam.name} contra ${match.awayTeam.name}`}
                                disabled={!open || item?.status === 'saving'}
                                onPress={() => void saveMatches([match.id])}
                                style={[
                                  styles.saveButton,
                                  (!open || item?.status === 'saving') && styles.disabled,
                                ]}
                              >
                                <Text style={styles.saveButtonText}>
                                  {open
                                    ? 'Salvar palpite'
                                    : availability.label === 'FORA DO BOLÃO'
                                      ? 'Não elegível'
                                      : 'Palpite fechado'}
                                </Text>
                              </Pressable>
                              {publicAvailable ? (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`Ver palpites de ${match.homeTeam.name} contra ${match.awayTeam.name}`}
                                  onPress={() => void openPublicPredictions(match)}
                                  style={styles.publicPredictionsButton}
                                >
                                  <Text style={styles.publicPredictionsButtonText}>
                                    Ver palpites
                                  </Text>
                                </Pressable>
                              ) : null}
                            </View>
                          ) : publicAvailable ? (
                            <View style={styles.publicPredictionsRow}>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Ver palpites de ${match.homeTeam.name} contra ${match.awayTeam.name}`}
                                onPress={() => void openPublicPredictions(match)}
                                style={styles.publicPredictionsButton}
                              >
                                <Text style={styles.publicPredictionsButtonText}>
                                  Ver palpites dos participantes
                                </Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                  {dirtyOpenIds.length ? (
                    <View style={styles.bulkBar} accessibilityLiveRegion="polite">
                      <View>
                        <Text style={styles.bulkTitle}>Salvar palpites do dia</Text>
                        <Text style={styles.bulkText}>
                          {dirtyOpenIds.length}{' '}
                          {dirtyOpenIds.length === 1 ? 'palpite não salvo' : 'palpites não salvos'}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Salvar ${dirtyOpenIds.length} ${
                          dirtyOpenIds.length === 1 ? 'palpite' : 'palpites'
                        } do dia`}
                        onPress={() => void saveMatches(dirtyOpenIds)}
                        style={styles.bulkButton}
                      >
                        <Text style={styles.bulkButtonText}>Salvar todos do dia</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </View>
            )}
          </AsyncState>
        </View>
      ) : null}

      {section === 'standings' || section === 'all' ? (
        <AsyncState
          status={status}
          error={error}
          emptyTitle="Classificação indisponível"
          emptyMessage="Os resultados oficiais ainda não formaram a tabela."
          onRetry={() => setRoundId((value) => `${value}`)}
          skeletonLines={6}
        >
          <View style={styles.standingsPage}>
            <View>
              <Text style={styles.sectionEyebrow}>CLASSIFICAÇÃO</Text>
              <Text style={styles.sectionTitle}>Tabela da liga</Text>
            </View>
            {standings.length ? (
              standingsTable(standings, compact, onOpenTeam)
            ) : (
              <AsyncState
                status="empty"
                emptyTitle="Classificação indisponível"
                emptyMessage="Os resultados oficiais ainda não formaram a tabela."
              />
            )}
          </View>
        </AsyncState>
      ) : null}

      {section === 'ranking' || section === 'all' ? (
        <View style={styles.rankingSection}>
          {ranking.length ? (
            <PremiumRanking
              seasonName={season?.name ?? 'Brasileirão Série A 2026'}
              ranking={ranking}
              roundRanking={roundRanking}
              currentUserId={currentUserId}
              scope={scope}
              onScopeChange={setScope}
              connection={connection}
              syncing={syncing}
              lastSyncedAt={lastSyncedAt}
              onRefresh={() => void refreshOfficialResults()}
              awards={awards}
              engagement={engagement}
              tieBreakers={rules?.tieBreakers.criteria.map((item) => item.label) ?? []}
            />
          ) : (
            <AsyncState
              status="empty"
              emptyTitle="Ranking ainda vazio"
              emptyMessage="Faça seus palpites; os pontos aparecem após resultados elegíveis."
            />
          )}
        </View>
      ) : null}

      {(section === 'overview' || section === 'all') && engagement ? (
        <View style={styles.engagementGrid} accessibilityLabel="Conquistas e caixa de entrada">
          <View style={styles.engagementPanel}>
            <Text style={styles.sectionEyebrow}>PROGRESSO</Text>
            <Text style={styles.sectionTitle}>Conquistas</Text>
            <Text style={styles.rulesHelp}>
              Somente resultados finais consolidam sequências. Progresso ao vivo é identificado como
              provisório.
            </Text>
            {engagement.achievements.map((item) => (
              <View key={item.id} style={styles.achievementRow}>
                <Text style={styles.achievementName}>
                  {item.definition.name}
                  {item.achievedAt
                    ? ' · conquistada'
                    : item.revokedAt
                      ? ' · progresso recalculado'
                      : ' · em progresso'}
                  {item.isProvisional ? ' · provisório' : ''}
                </Text>
                <Text style={styles.rulesHelp}>{item.definition.description}</Text>
              </View>
            ))}
            {!engagement.achievements.length ? (
              <Text style={styles.rulesHelp}>
                Seu progresso aparece aqui conforme resultados finais forem publicados.
              </Text>
            ) : null}
          </View>
          <View style={styles.engagementPanel}>
            <Text style={styles.sectionEyebrow}>INBOX IN-APP</Text>
            <Text style={styles.sectionTitle}>Novidades</Text>
            {engagement.notifications.slice(0, 5).map((notification) => (
              <Pressable
                key={notification.id}
                accessibilityRole="button"
                accessibilityLabel={`${notification.title}. ${notification.body}`}
                onPress={() =>
                  season && void api.markNotificationRead(POOL_SLUG, season.id, notification.id)
                }
                style={styles.notificationRow}
              >
                <Text style={styles.achievementName}>
                  {notification.title}
                  {notification.isProvisional ? ' · provisório' : ''}
                </Text>
                <Text style={styles.rulesHelp}>{notification.body}</Text>
              </Pressable>
            ))}
            {!engagement.notifications.length ? (
              <Text style={styles.rulesHelp}>Sua caixa de entrada está vazia.</Text>
            ) : null}
            <Text style={styles.preferenceHelp}>
              Push e e-mail começam desligados e só são usados com seu consentimento. Quiet hours
              serão respeitadas nesses canais.
            </Text>
            <View style={styles.preferenceRow}>
              <Pressable
                aria-checked={engagement.preferences.pushEnabled}
                accessibilityRole="switch"
                accessibilityState={{ checked: engagement.preferences.pushEnabled }}
                onPress={() => void togglePreference('pushEnabled')}
                style={styles.preferenceButton}
              >
                <Text style={styles.preferenceButtonText}>
                  Push: {engagement.preferences.pushEnabled ? 'ativado' : 'desativado'}
                </Text>
              </Pressable>
              <Pressable
                aria-checked={engagement.preferences.emailEnabled}
                accessibilityRole="switch"
                accessibilityState={{ checked: engagement.preferences.emailEnabled }}
                onPress={() => void togglePreference('emailEnabled')}
                style={styles.preferenceButton}
              >
                <Text style={styles.preferenceButtonText}>
                  E-mail: {engagement.preferences.emailEnabled ? 'ativado' : 'desativado'}
                </Text>
              </Pressable>
              <Pressable
                aria-checked={engagement.preferences.quietHoursEnabled}
                accessibilityRole="switch"
                accessibilityState={{ checked: engagement.preferences.quietHoursEnabled }}
                onPress={() => void togglePreference('quietHoursEnabled')}
                style={styles.preferenceButton}
              >
                <Text style={styles.preferenceButtonText}>
                  Quiet hours:{' '}
                  {engagement.preferences.quietHoursEnabled
                    ? `${engagement.preferences.quietHoursStart}–${engagement.preferences.quietHoursEnd}`
                    : 'desativado'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      <PublicPredictionsModal
        match={publicMatch}
        predictions={publicPredictions}
        currentUserId={currentUserId}
        loading={publicPredictionsLoading}
        error={publicPredictionsError}
        onClose={closePublicPredictions}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: theme.space.lg, paddingBottom: theme.space.xxl },
  titleRow: {
    alignItems: 'flex-end',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: theme.space.lg,
  },
  titleRowCompact: { alignItems: 'flex-start', flexDirection: 'column', gap: theme.space.sm },
  eyebrow: { color: theme.color.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: theme.color.text, fontSize: 30, fontWeight: '900', marginTop: 3 },
  subtitle: { color: theme.color.textMuted, lineHeight: 21, marginTop: 5 },
  overviewStrip: {
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    borderTopColor: theme.color.borderMuted,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  overviewMetric: {
    flex: 1,
    minWidth: 180,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.xl,
  },
  overviewMetricDivider: { borderLeftColor: theme.color.borderMuted, borderLeftWidth: 1 },
  overviewMetricDividerCompact: { borderTopColor: theme.color.borderMuted, borderTopWidth: 1 },
  overviewMetricLabel: {
    color: theme.color.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  overviewMetricValue: { color: theme.color.text, fontSize: 20, fontWeight: '900', marginTop: 5 },
  roundRail: { gap: 6 },
  roundTab: {
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
  },
  roundTabActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  roundText: { color: theme.color.textMuted, fontSize: 12, fontWeight: '800' },
  roundTextActive: { color: theme.color.accentInk },
  predictionAgenda: { gap: theme.space.lg },
  calendarToolbar: {
    alignItems: 'center',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    borderTopColor: theme.color.borderMuted,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 72,
    paddingVertical: theme.space.sm,
  },
  calendarToolbarCompact: { minHeight: 64 },
  monthButton: {
    alignItems: 'center',
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
  },
  monthButtonText: { color: theme.color.text, fontSize: 28, fontWeight: '500', lineHeight: 30 },
  monthIdentity: { alignItems: 'center', flex: 1, paddingHorizontal: theme.space.md },
  monthTitle: { color: theme.color.text, fontSize: 18, fontWeight: '900', marginTop: 3 },
  dayRail: { gap: 7, paddingBottom: theme.space.xs },
  dayTab: {
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 68,
    minWidth: 148,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  dayTabActive: {
    backgroundColor: 'rgba(52, 209, 123, 0.1)',
    borderColor: theme.color.accent,
  },
  dayTabTitle: { color: theme.color.text, fontSize: 13, fontWeight: '900' },
  dayTabTitleActive: { color: theme.color.accent },
  dayTabMeta: { color: theme.color.textMuted, fontSize: 10, fontWeight: '700', marginTop: 3 },
  dayTabMetaActive: { color: theme.color.text },
  dayTabDirty: { color: theme.color.gold, fontSize: 9, fontWeight: '900', marginTop: 3 },
  columns: { alignItems: 'flex-start', flexDirection: 'row', gap: theme.space.lg },
  columnsCompact: { flexDirection: 'column' },
  matchesColumn: { flex: 1, minWidth: 0, width: '100%' },
  standingsColumn: {
    borderLeftColor: theme.color.borderMuted,
    borderLeftWidth: 1,
    paddingLeft: theme.space.lg,
    width: 390,
    maxWidth: '100%',
  },
  standingsPage: { gap: theme.space.lg, maxWidth: 920, width: '100%' },
  sectionHeading: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: theme.space.md,
    justifyContent: 'space-between',
  },
  sectionHeadingCompact: { alignItems: 'flex-start', flexDirection: 'column' },
  sectionEyebrow: {
    color: theme.color.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  sectionTitle: { color: theme.color.text, fontSize: 21, fontWeight: '900', marginTop: 3 },
  sectionMeta: { color: theme.color.textMuted, fontSize: 12 },
  matchList: { gap: 1, marginTop: theme.space.md },
  matchRow: {
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    gap: theme.space.md,
    paddingVertical: theme.space.lg,
  },
  matchMeta: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  matchContext: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  matchTime: { color: theme.color.textMuted, fontSize: 11, fontWeight: '700' },
  roundMeta: {
    backgroundColor: 'rgba(145, 174, 204, 0.1)',
    borderRadius: theme.radius.pill,
    color: theme.color.textMuted,
    fontSize: 9,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  matchStatus: {
    borderRadius: theme.radius.pill,
    fontSize: 9,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  open: { backgroundColor: 'rgba(52, 209, 123, 0.14)', color: theme.color.accent },
  closed: { backgroundColor: 'rgba(145, 174, 204, 0.14)', color: theme.color.textMuted },
  matchup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.space.md,
    justifyContent: 'space-between',
  },
  matchupCompact: { alignItems: 'stretch' },
  teamIdentity: { alignItems: 'center', flex: 1, gap: 6 },
  teamName: { color: theme.color.text, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  scoreGroup: { alignItems: 'flex-start', flexDirection: 'row', gap: 4 },
  versus: { color: theme.color.textMuted, fontSize: 18, fontWeight: '900', marginTop: 28 },
  officialScore: { color: theme.color.text, fontSize: 22, fontWeight: '900' },
  unavailableReason: {
    color: theme.color.textMuted,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 17,
    textAlign: 'center',
  },
  saveRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.md,
    justifyContent: 'flex-end',
  },
  saveState: {
    color: theme.color.textMuted,
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
  },
  failed: { color: theme.color.danger },
  saveButton: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.sm,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  saveButtonText: { color: theme.color.accentInk, fontSize: 12, fontWeight: '900' },
  publicPredictionsRow: { alignItems: 'flex-end' },
  publicPredictionsButton: {
    alignItems: 'center',
    borderColor: theme.color.gold,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  publicPredictionsButtonText: { color: theme.color.gold, fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.48 },
  bulkBar: {
    alignItems: 'center',
    backgroundColor: theme.color.surface,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.md,
    justifyContent: 'space-between',
    marginTop: theme.space.md,
    padding: theme.space.md,
  },
  bulkTitle: { color: theme.color.text, fontSize: 13, fontWeight: '900' },
  bulkText: { color: theme.color.textMuted, fontSize: 11, fontWeight: '700', marginTop: 3 },
  bulkButton: {
    backgroundColor: theme.color.gold,
    borderRadius: theme.radius.sm,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  bulkButtonText: { color: '#211d08', fontWeight: '900' },
  standingsScroller: { minWidth: '100%' },
  standingsTable: { marginTop: theme.space.md, minWidth: 320, width: '100%' },
  standingRow: {
    alignItems: 'center',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: theme.touchTarget,
  },
  standingHeader: { backgroundColor: theme.color.surface },
  standingCell: { color: theme.color.textMuted, fontSize: 11, textAlign: 'right', width: 36 },
  standingPosition: { color: theme.color.info, textAlign: 'center', width: 30 },
  standingTeam: { flex: 1, minWidth: 150 },
  standingIdentity: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  standingName: { color: theme.color.text, flex: 1, fontSize: 11, fontWeight: '800' },
  standingPoints: { color: theme.color.accent, fontWeight: '900', width: 40 },
  rankingSection: {
    borderTopColor: theme.color.borderMuted,
    borderTopWidth: 1,
    gap: theme.space.lg,
    paddingTop: theme.space.xl,
  },
  rulesPanel: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.space.md,
    padding: theme.space.lg,
  },
  rulesHelp: { color: theme.color.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  rulePointsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ruleChip: {
    backgroundColor: 'rgba(255, 211, 21, 0.12)',
    borderRadius: theme.radius.pill,
    color: theme.color.gold,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  tieBreakText: { color: theme.color.text, fontSize: 12, lineHeight: 19 },
  engagementGrid: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.lg,
  },
  engagementPanel: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flex: 1,
    gap: theme.space.sm,
    minWidth: 280,
    padding: theme.space.lg,
  },
  achievementRow: {
    borderTopColor: theme.color.borderMuted,
    borderTopWidth: 1,
    paddingTop: theme.space.sm,
  },
  achievementName: { color: theme.color.text, fontSize: 13, fontWeight: '900' },
  notificationRow: {
    borderTopColor: theme.color.borderMuted,
    borderTopWidth: 1,
    minHeight: theme.touchTarget,
    paddingVertical: theme.space.sm,
  },
  preferenceHelp: {
    color: theme.color.textMuted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: theme.space.sm,
  },
  preferenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preferenceButton: {
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
  },
  preferenceButtonText: { color: theme.color.text, fontSize: 11, fontWeight: '800' },
  scopeRail: { gap: 5 },
  scopeTab: {
    borderColor: theme.color.border,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
  },
  scopeTabActive: { backgroundColor: theme.color.gold, borderColor: theme.color.gold },
  scopeText: { color: theme.color.textMuted, fontSize: 11, fontWeight: '800' },
  scopeTextActive: { color: '#211d08' },
});
