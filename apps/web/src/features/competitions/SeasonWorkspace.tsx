import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { MatchDto, RankingRowDto, RoundDto, SeasonDto, StandingRowDto } from '@bolao/shared';
import { useCompetition } from '../../app/CompetitionContext';
import { AsyncState, type AsyncStatus } from '../../components/AsyncState';
import { ConnectionIndicator } from '../../components/ConnectionIndicator';
import { RankingTable } from '../../components/RankingTable';
import { ScoreInput } from '../../components/ScoreInput';
import { TeamBadge } from '../../components/TeamBadge';
import { useToast } from '../../components/Toast';
import { api, errorMessage, LatestRequest } from '../../api';
import {
  draftReducer,
  draftStorageKey,
  hasDirtyDraft,
  loadDraft,
  persistDraft,
  saveStatusLabel,
  warnBeforeUnload,
  type DraftState,
} from '../../services/drafts';
import { createRealtimeClient, type ConnectionStatus } from '../../services/realtime';
import { theme } from '../../theme/tokens';

const POOL_SLUG = 'bolao-do-trabalho';
type RankingScope = 'overall' | 'round' | 'month' | 'turn-1' | 'turn-2';

function formatMatchTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function isPredictionOpen(match: MatchDto) {
  const closesAt = match.predictionClosesAt
    ? new Date(match.predictionClosesAt).getTime()
    : new Date(match.startsAt).getTime() - 5 * 60_000;
  return match.status === 'SCHEDULED' && closesAt > Date.now();
}

function score(match: MatchDto) {
  const home = match.status === 'FINISHED' ? match.finalHomeScore ?? match.homeScore : match.homeScore;
  const away = match.status === 'FINISHED' ? match.finalAwayScore ?? match.awayScore : match.awayScore;
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

function standingsTable(rows: StandingRowDto[], compact: boolean) {
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
          <View key={`${row.group}:${row.team.id}`} style={styles.standingRow} accessibilityLabel={`${row.rank}º ${row.team.name}, ${row.points} pontos`}>
            <Text style={[styles.standingCell, styles.standingPosition]}>{row.rank}</Text>
            <View style={[styles.standingTeam, styles.standingIdentity]}>
              <TeamBadge team={row.team} kind="crest" size={24} />
              <Text style={styles.standingName} numberOfLines={1}>{row.team.name}</Text>
            </View>
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
}: {
  currentUserId: string;
  refreshVersion: number;
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
  const [standings, setStandings] = useState<StandingRowDto[]>([]);
  const [ranking, setRanking] = useState<RankingRowDto[]>([]);
  const [roundRanking, setRoundRanking] = useState<RankingRowDto[]>([]);
  const [previousRanks, setPreviousRanks] = useState<Map<string, number>>(new Map());
  const [scope, setScope] = useState<RankingScope>('overall');
  const [draft, setDraft] = useState<DraftState>({ items: {} });
  const [poolSeasonId, setPoolSeasonId] = useState('');
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<ConnectionStatus>('reconnecting');
  const selectedRound = rounds.find((round) => round.id === roundId);
  const dataRequest = useRef(new LatestRequest()).current;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const stablePoolSeasonKey = poolSeasonId || (season ? `pool:${POOL_SLUG}:season:${season.id}` : 'pending');
  const storageKey = draftStorageKey(currentUserId, stablePoolSeasonKey, 'league-predictions');

  function dispatch(action: Parameters<typeof draftReducer>[1]) {
    setDraft((current) => draftReducer(current, action));
  }

  useEffect(() => {
    if (isLeague) {
      setFallbackSeason(null);
      return;
    }
    api.brasileiraoSeasons().then((result) => {
      setFallbackSeason(result.seasons.find((item) => item.status === 'ACTIVE') ?? result.seasons[0] ?? null);
    }).catch((cause) => setError(errorMessage(cause)));
  }, [isLeague]);

  useEffect(() => {
    if (!season) return;
    setStatus('loading');
    api.seasonRounds(season.id)
      .then((result) => {
        setRounds(result.rounds);
        const active = result.rounds.find((round) => round.status === 'ACTIVE')
          ?? result.rounds.find((round) => round.order === 20)
          ?? result.rounds[0];
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
        const [matchesResult, standingsResult, predictionsResult, rankingResult, roundResult] = await Promise.all([
          api.seasonMatches(season.id, roundId),
          api.seasonStandings(season.id),
          api.seasonPredictions(POOL_SLUG, season.id),
          api.seasonRanking(POOL_SLUG, season.id, query),
          api.seasonRanking(POOL_SLUG, season.id, `scope=round&roundId=${encodeURIComponent(roundId)}`),
        ]);
        return { matchesResult, standingsResult, predictionsResult, rankingResult, roundResult };
      });
      if (!active || !result) return;
      const values = Object.fromEntries(result.predictionsResult.predictions.map((prediction) => [
        prediction.matchId,
        { home: String(prediction.predictedHomeScore), away: String(prediction.predictedAwayScore) },
      ]));
      const resolvedPoolSeasonId = result.predictionsResult.predictions[0]?.poolSeasonId;
      if (resolvedPoolSeasonId) setPoolSeasonId(resolvedPoolSeasonId);
      setMatches(result.matchesResult.matches);
      setStandings(result.standingsResult.standingsByGroup.flatMap((group) => group.rows));
      setRanking(result.rankingResult.ranking);
      setRoundRanking(result.roundResult.ranking);
      dispatch({ type: 'hydrate', values });
      setError('');
      setStatus(result.matchesResult.matches.length ? 'success' : 'empty');

      const snapshotKey = `bolao:ranking-snapshot:${currentUserId}:${stablePoolSeasonKey}`;
      if (typeof window !== 'undefined') {
        try {
          const previous = JSON.parse(window.localStorage.getItem(snapshotKey) ?? '{}') as Record<string, number>;
          setPreviousRanks(new Map(Object.entries(previous)));
          window.localStorage.setItem(snapshotKey, JSON.stringify(Object.fromEntries(result.rankingResult.ranking.map((row) => [row.userId, row.rank]))));
        } catch {
          setPreviousRanks(new Map());
        }
      }
    };
    void load();
    const interval = setInterval(() => void load(true), 30_000);
    const realtime = createRealtimeClient({
      seasonId: season.id,
      poolSeasonId: poolSeasonId || undefined,
      eventTypes: ['prediction.updated', 'ranking.updated', 'match.updated', 'provider.sync.completed'],
      onEvent: () => void load(true),
      onStatus: setConnection,
    });
    return () => {
      active = false;
      clearInterval(interval);
      realtime.close();
      dataRequest.cancel();
    };
  }, [season?.id, roundId, scope, refreshVersion, poolSeasonId]);

  useEffect(() => {
    const stored = loadDraft(storageKey);
    if (hasDirtyDraft(stored)) setDraft(stored);
  }, [storageKey]);

  useEffect(() => persistDraft(storageKey, draft), [draft, storageKey]);
  useEffect(() => warnBeforeUnload(() => hasDirtyDraft(draftRef.current)), []);

  async function saveMatches(matchIds: string[]) {
    if (!season) return;
    const valid = matchIds.flatMap((matchId) => {
      const match = matches.find((item) => item.id === matchId);
      const item = draft.items[matchId];
      if (!match || !item || item.value.home === '' || item.value.away === '') return [];
      return [{ match, item }];
    });
    if (!valid.length) {
      showToast('Preencha os dois placares antes de salvar.', 'error');
      return;
    }
    const ids = valid.map(({ match }) => match.id);
    dispatch({ type: 'saving', itemIds: ids });
    try {
      const grouped = new Map<string, typeof valid>();
      for (const entry of valid) {
        const entries = grouped.get(entry.match.matchDayId) ?? [];
        entries.push(entry);
        grouped.set(entry.match.matchDayId, entries);
      }
      const saved = (await Promise.all([...grouped.entries()].map(([matchDayId, entries]) =>
        api.saveSeasonPredictions(POOL_SLUG, season.id, matchDayId, entries.map(({ match, item }) => ({
          matchId: match.id,
          predictedHomeScore: Number(item.value.home),
          predictedAwayScore: Number(item.value.away),
        }))),
      ))).flatMap((result) => result.predictions);
      if (saved[0]?.poolSeasonId) setPoolSeasonId(saved[0].poolSeasonId);
      dispatch({ type: 'saved', itemIds: saved.map((item) => item.matchId) });
      showToast(`${saved.length} ${saved.length === 1 ? 'palpite salvo' : 'palpites salvos'}.`, 'success');
    } catch (cause) {
      const message = errorMessage(cause);
      dispatch({ type: 'failed', itemIds: ids, error: message });
      showToast(message, 'error');
    }
  }

  if (!season && status === 'loading') return <AsyncState status="loading" skeletonLines={6} />;

  const dirtyOpenIds = matches
    .filter((match) => isPredictionOpen(match) && draft.items[match.id]?.status === 'dirty')
    .map((match) => match.id);

  return (
    <View style={styles.page} accessibilityLabel={season?.name ?? 'Temporada de liga'}>
      <View style={[styles.titleRow, compact && styles.titleRowCompact]}>
        <View>
          <Text style={styles.eyebrow}>TEMPORADA · LIGA</Text>
          <Text style={styles.title}>{season?.name ?? 'Competição'}</Text>
          <Text style={styles.subtitle}>Palpites, classificação e ranking no mesmo contexto de temporada.</Text>
        </View>
        <ConnectionIndicator status={connection} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roundRail} accessibilityRole="tablist">
        {rounds.map((round) => {
          const selected = round.id === roundId;
          return (
            <Pressable key={round.id} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => setRoundId(round.id)} style={[styles.roundTab, selected && styles.roundTabActive]}>
              <Text style={[styles.roundText, selected && styles.roundTextActive]}>{round.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <AsyncState status={status} error={error} emptyTitle="Rodada sem partidas" emptyMessage="Escolha outra rodada ou aguarde a publicação da tabela." onRetry={() => setRoundId((value) => `${value}`)} skeletonLines={6}>
        <View style={[styles.columns, compact && styles.columnsCompact]}>
          <View style={styles.matchesColumn}>
            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.sectionEyebrow}>PALPITES</Text>
                <Text style={styles.sectionTitle}>{selectedRound?.name ?? 'Rodada'}</Text>
              </View>
              <Text style={styles.sectionMeta}>{matches.length} jogos</Text>
            </View>
            <View style={styles.matchList}>
              {matches.map((match) => {
                const item = draft.items[match.id];
                const value = item?.value ?? { home: '', away: '' };
                const open = isPredictionOpen(match);
                const official = score(match);
                const errorText = item?.status === 'failed' ? item.error : undefined;
                return (
                  <View key={match.id} style={styles.matchRow} accessibilityLabel={`${match.homeTeam.name} contra ${match.awayTeam.name}`}>
                    <View style={styles.matchMeta}>
                      <Text style={styles.matchTime}>{formatMatchTime(match.startsAt, season?.timezone ?? 'America/Sao_Paulo')}</Text>
                      <Text style={[styles.matchStatus, open ? styles.open : styles.closed]}>{official ? 'FINAL' : open ? 'ABERTO' : match.status}</Text>
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
                          <ScoreInput teamName={match.homeTeam.name} side="home" value={value.home} editable={open} error={errorText} onChange={(home) => dispatch({ type: 'edit', itemId: match.id, side: 'home', value: home })} />
                          <Text style={styles.versus}>×</Text>
                          <ScoreInput teamName={match.awayTeam.name} side="away" value={value.away} editable={open} onChange={(away) => dispatch({ type: 'edit', itemId: match.id, side: 'away', value: away })} />
                        </View>
                      )}
                      <View style={styles.teamIdentity}>
                        <TeamBadge team={match.awayTeam} kind="crest" size={34} />
                        <Text style={styles.teamName}>{match.awayTeam.name}</Text>
                      </View>
                    </View>
                    {!official ? (
                      <View style={styles.saveRow}>
                        <Text accessibilityLiveRegion="polite" style={[styles.saveState, item?.status === 'failed' && styles.failed]}>{saveStatusLabel(item)}</Text>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Salvar palpite de ${match.homeTeam.name} contra ${match.awayTeam.name}`} disabled={!open || item?.status === 'saving'} onPress={() => void saveMatches([match.id])} style={[styles.saveButton, (!open || item?.status === 'saving') && styles.disabled]}>
                          <Text style={styles.saveButtonText}>{open ? 'Salvar palpite' : 'Palpite fechado'}</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
            {dirtyOpenIds.length ? (
              <View style={styles.bulkBar}>
                <Text style={styles.bulkText}>{dirtyOpenIds.length} {dirtyOpenIds.length === 1 ? 'palpite não salvo' : 'palpites não salvos'}</Text>
                <Pressable accessibilityRole="button" onPress={() => void saveMatches(dirtyOpenIds)} style={styles.bulkButton}>
                  <Text style={styles.bulkButtonText}>Salvar alterações</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          <View style={styles.standingsColumn}>
            <Text style={styles.sectionEyebrow}>CLASSIFICAÇÃO</Text>
            <Text style={styles.sectionTitle}>Tabela da liga</Text>
            {standings.length ? standingsTable(standings, compact) : <AsyncState status="empty" emptyTitle="Classificação indisponível" emptyMessage="Os resultados oficiais ainda não formaram a tabela." />}
          </View>
        </View>
      </AsyncState>

      <View style={styles.rankingSection}>
        <View style={[styles.sectionHeading, compact && styles.sectionHeadingCompact]}>
          <View>
            <Text style={styles.sectionEyebrow}>RANKING DO BOLÃO</Text>
            <Text style={styles.sectionTitle}>Disputa e desempates</Text>
          </View>
          <ScrollView horizontal contentContainerStyle={styles.scopeRail} accessibilityRole="tablist">
            {([
              ['overall', 'Geral'], ['round', 'Rodada'], ['month', 'Mês'], ['turn-1', 'Turno 1'], ['turn-2', 'Turno 2'],
            ] as Array<[RankingScope, string]>).map(([key, label]) => (
              <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: scope === key }} onPress={() => setScope(key)} style={[styles.scopeTab, scope === key && styles.scopeTabActive]}>
                <Text style={[styles.scopeText, scope === key && styles.scopeTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        {ranking.length ? <RankingTable ranking={ranking} roundRanking={roundRanking} currentUserId={currentUserId} previousRanks={previousRanks} /> : <AsyncState status="empty" emptyTitle="Ranking ainda vazio" emptyMessage="Faça seus palpites; os pontos aparecem após resultados elegíveis." />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: theme.space.lg, paddingBottom: theme.space.xxl },
  titleRow: { alignItems: 'flex-end', borderBottomColor: theme.color.borderMuted, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingBottom: theme.space.lg },
  titleRowCompact: { alignItems: 'flex-start', flexDirection: 'column', gap: theme.space.sm },
  eyebrow: { color: theme.color.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: theme.color.text, fontSize: 30, fontWeight: '900', marginTop: 3 },
  subtitle: { color: theme.color.textMuted, lineHeight: 21, marginTop: 5 },
  roundRail: { gap: 6 },
  roundTab: { borderColor: theme.color.border, borderRadius: theme.radius.sm, borderWidth: 1, justifyContent: 'center', minHeight: theme.touchTarget, paddingHorizontal: theme.space.md },
  roundTabActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  roundText: { color: theme.color.textMuted, fontSize: 12, fontWeight: '800' },
  roundTextActive: { color: theme.color.accentInk },
  columns: { alignItems: 'flex-start', flexDirection: 'row', gap: theme.space.lg },
  columnsCompact: { flexDirection: 'column' },
  matchesColumn: { flex: 1, minWidth: 0, width: '100%' },
  standingsColumn: { borderLeftColor: theme.color.borderMuted, borderLeftWidth: 1, paddingLeft: theme.space.lg, width: 390, maxWidth: '100%' },
  sectionHeading: { alignItems: 'flex-end', flexDirection: 'row', gap: theme.space.md, justifyContent: 'space-between' },
  sectionHeadingCompact: { alignItems: 'flex-start', flexDirection: 'column' },
  sectionEyebrow: { color: theme.color.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  sectionTitle: { color: theme.color.text, fontSize: 21, fontWeight: '900', marginTop: 3 },
  sectionMeta: { color: theme.color.textMuted, fontSize: 12 },
  matchList: { gap: 1, marginTop: theme.space.md },
  matchRow: { borderBottomColor: theme.color.borderMuted, borderBottomWidth: 1, gap: theme.space.md, paddingVertical: theme.space.lg },
  matchMeta: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  matchTime: { color: theme.color.textMuted, fontSize: 11, fontWeight: '700' },
  matchStatus: { borderRadius: theme.radius.pill, fontSize: 9, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 5 },
  open: { backgroundColor: 'rgba(52, 209, 123, 0.14)', color: theme.color.accent },
  closed: { backgroundColor: 'rgba(145, 174, 204, 0.14)', color: theme.color.textMuted },
  matchup: { alignItems: 'center', flexDirection: 'row', gap: theme.space.md, justifyContent: 'space-between' },
  matchupCompact: { alignItems: 'stretch' },
  teamIdentity: { alignItems: 'center', flex: 1, gap: 6 },
  teamName: { color: theme.color.text, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  scoreGroup: { alignItems: 'flex-start', flexDirection: 'row', gap: 4 },
  versus: { color: theme.color.textMuted, fontSize: 18, fontWeight: '900', marginTop: 28 },
  officialScore: { color: theme.color.text, fontSize: 22, fontWeight: '900' },
  saveRow: { alignItems: 'center', flexDirection: 'row', gap: theme.space.md, justifyContent: 'flex-end' },
  saveState: { color: theme.color.textMuted, flex: 1, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  failed: { color: theme.color.danger },
  saveButton: { alignItems: 'center', backgroundColor: theme.color.accent, borderRadius: theme.radius.sm, justifyContent: 'center', minHeight: theme.touchTarget, paddingHorizontal: theme.space.lg },
  saveButtonText: { color: theme.color.accentInk, fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.48 },
  bulkBar: { alignItems: 'center', backgroundColor: theme.color.surface, flexDirection: 'row', gap: theme.space.md, justifyContent: 'space-between', marginTop: theme.space.md, padding: theme.space.md },
  bulkText: { color: theme.color.text, fontWeight: '800' },
  bulkButton: { backgroundColor: theme.color.gold, borderRadius: theme.radius.sm, justifyContent: 'center', minHeight: theme.touchTarget, paddingHorizontal: theme.space.lg },
  bulkButtonText: { color: '#211d08', fontWeight: '900' },
  standingsScroller: { minWidth: '100%' },
  standingsTable: { marginTop: theme.space.md, minWidth: 320, width: '100%' },
  standingRow: { alignItems: 'center', borderBottomColor: theme.color.borderMuted, borderBottomWidth: 1, flexDirection: 'row', minHeight: theme.touchTarget },
  standingHeader: { backgroundColor: theme.color.surface },
  standingCell: { color: theme.color.textMuted, fontSize: 11, textAlign: 'right', width: 36 },
  standingPosition: { color: theme.color.info, textAlign: 'center', width: 30 },
  standingTeam: { flex: 1, minWidth: 150 },
  standingIdentity: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  standingName: { color: theme.color.text, flex: 1, fontSize: 11, fontWeight: '800' },
  standingPoints: { color: theme.color.accent, fontWeight: '900', width: 40 },
  rankingSection: { borderTopColor: theme.color.borderMuted, borderTopWidth: 1, gap: theme.space.lg, paddingTop: theme.space.xl },
  scopeRail: { gap: 5 },
  scopeTab: { borderColor: theme.color.border, borderRadius: theme.radius.pill, borderWidth: 1, justifyContent: 'center', minHeight: theme.touchTarget, paddingHorizontal: theme.space.md },
  scopeTabActive: { backgroundColor: theme.color.gold, borderColor: theme.color.gold },
  scopeText: { color: theme.color.textMuted, fontSize: 11, fontWeight: '800' },
  scopeTextActive: { color: '#211d08' },
});
