import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LeagueTeamSection } from '../../navigation/routes';
import type { SeasonTeamSummaryDto, TeamMatchHistoryDto, TeamProfileDto } from '@bolao/shared';
import { useCompetition } from '../../app/CompetitionContext';
import { api, errorMessage, LatestRequest } from '../../api';
import { AsyncState, type AsyncStatus } from '../../components/AsyncState';
import { TeamBadge } from '../../components/TeamBadge';
import { RouteLink } from '../../navigation/RouteLink';
import { pathForCompetition, pathForLeagueTeam, pathForScreen } from '../../navigation/routes';
import { theme } from '../../theme/tokens';

function normalizeName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bsaf\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function formatCollectedAt(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function SourceStatus({ profile }: { profile: TeamProfileDto }) {
  const stale = Date.now() - new Date(profile.source.collectedAt).getTime() > 48 * 60 * 60 * 1_000;
  return (
    <View style={[styles.sourceStatus, stale && styles.sourceStatusStale]}>
      <Ionicons
        name={stale ? 'time-outline' : 'checkmark-circle-outline'}
        size={16}
        color={stale ? theme.color.warning : theme.color.accent}
      />
      <Text style={styles.sourceText}>
        Dados de {profile.source.label} · coleta de {formatCollectedAt(profile.source.collectedAt)}
      </Text>
      <Pressable
        {...({ href: profile.source.url, target: '_blank', rel: 'noreferrer' } as never)}
        accessibilityRole="link"
        accessibilityLabel={`Abrir fonte oficial de ${profile.team.name} em nova aba`}
        style={styles.sourceLink}
      >
        <Text style={styles.sourceLinkText}>Ver fonte oficial</Text>
        <Ionicons name="open-outline" size={14} color={theme.color.info} />
      </Pressable>
    </View>
  );
}

export function TeamDirectoryScreen({
  refreshVersion,
  onOpenTeam,
}: {
  refreshVersion: number;
  onOpenTeam: (teamId: string) => void;
}) {
  const context = useCompetition();
  const { width } = useWindowDimensions();
  const [teams, setTeams] = useState<SeasonTeamSummaryDto[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const request = useRef(new LatestRequest()).current;
  const season = context.season;
  const competitionSlug = context.competition?.slug;
  const columns = width >= 1180 ? 4 : width >= 720 ? 3 : width >= 520 ? 2 : 1;

  useEffect(() => {
    if (!season) return;
    setStatus(teams.length ? 'refreshing' : 'loading');
    request
      .run((signal) => api.seasonTeams(season.id, signal))
      .then((result) => {
        if (!result) return;
        setTeams(result.teams);
        setError('');
        setStatus(result.teams.length ? 'success' : 'empty');
      })
      .catch((cause) => {
        setError(errorMessage(cause));
        setStatus('error');
      });
    return () => request.cancel();
  }, [season?.id, refreshVersion, reload]);

  const filtered = useMemo(() => {
    const normalized = normalizeName(query);
    if (!normalized) return teams;
    return teams.filter((entry) =>
      normalizeName(`${entry.team.name} ${entry.team.code ?? ''} ${entry.state ?? ''}`).includes(
        normalized,
      ),
    );
  }, [query, teams]);

  return (
    <View style={styles.page}>
      <View style={styles.directoryHeader}>
        <View style={styles.headingGroup}>
          <Text style={styles.eyebrow}>TIMES · TEMPORADA</Text>
          <Text accessibilityRole="header" style={styles.pageTitle}>
            Times de {season?.name ?? context.competition?.name ?? 'competição'}
          </Text>
          <Text style={styles.pageSubtitle}>
            Perfis compactos com atletas inscritos, partidas e números oficiais da competição.
          </Text>
        </View>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={theme.color.textMuted} />
          <TextInput
            accessibilityLabel="Buscar time por nome, sigla ou estado"
            autoCapitalize="none"
            onChangeText={setQuery}
            placeholder="Buscar time"
            placeholderTextColor={theme.color.textMuted}
            style={styles.searchInput}
            value={query}
          />
        </View>
      </View>
      <View style={styles.resultMeta} accessibilityLiveRegion="polite">
        <Text style={styles.resultCount}>
          {filtered.length} {filtered.length === 1 ? 'clube' : 'clubes'}
        </Text>
        <Text style={styles.resultHint}>Selecione um escudo para abrir o perfil.</Text>
      </View>
      <AsyncState
        status={status}
        error={error}
        emptyTitle="Nenhum time cadastrado"
        emptyMessage="Os clubes aparecerão quando a temporada for sincronizada."
        onRetry={() => setReload((value) => value + 1)}
        skeletonLines={5}
      >
        {teams.length && !filtered.length ? (
          <View style={styles.filteredEmpty} accessibilityRole="summary">
            <Text style={styles.filteredEmptyTitle}>Nenhum resultado para “{query}”</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setQuery('')}
              style={styles.clearButton}
            >
              <Text style={styles.clearButtonText}>Limpar busca</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.teamGrid}>
            {filtered.map((entry) => (
              <RouteLink
                key={entry.team.id}
                href={
                  competitionSlug
                    ? pathForLeagueTeam(competitionSlug, entry.team.id)
                    : pathForScreen('competitions')
                }
                accessibilityLabel={`Abrir perfil de ${entry.team.name}`}
                onActivate={() => onOpenTeam(entry.team.id)}
                style={[
                  styles.teamItem,
                  { flexBasis: columns === 1 ? '100%' : `${97 / columns}%` },
                ]}
              >
                <TeamBadge team={entry.team} kind="crest" size={52} />
                <View style={styles.teamCopy}>
                  <Text style={styles.teamName} numberOfLines={2}>
                    {entry.team.name}
                  </Text>
                  <Text style={styles.teamMeta}>
                    {[entry.state, entry.team.code].filter(Boolean).join(' · ') || season?.name}
                  </Text>
                  <Text style={entry.profileAvailable ? styles.available : styles.pending}>
                    {entry.profileAvailable ? 'Perfil oficial disponível' : 'Importação pendente'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.color.textMuted} />
              </RouteLink>
            ))}
          </View>
        )}
      </AsyncState>
    </View>
  );
}

const sectionItems: Array<{
  section: LeagueTeamSection;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { section: 'athletes', label: 'Atletas', icon: 'people-outline' },
  { section: 'matches', label: 'Partidas', icon: 'calendar-outline' },
  { section: 'statistics', label: 'Estatísticas', icon: 'stats-chart-outline' },
];

function AthletesSection({ profile }: { profile: TeamProfileDto }) {
  const [query, setQuery] = useState('');
  const athletes = useMemo(() => {
    const normalized = normalizeName(query);
    return normalized
      ? profile.athletes.filter((athlete) =>
          normalizeName(
            `${athlete.nickname ?? ''} ${athlete.fullName} ${athlete.currentClub.name}`,
          ).includes(normalized),
        )
      : profile.athletes;
  }, [profile.athletes, query]);
  return (
    <View style={styles.sectionBody}>
      <View style={styles.sectionHeadingRow}>
        <View style={styles.headingGroup}>
          <Text style={styles.sectionTitle}>Atletas cadastrados por {profile.source.label}</Text>
          <Text style={styles.sectionDescription}>
            A relação é histórica da competição; o clube atual informado pode ser diferente.
          </Text>
        </View>
        <View style={styles.smallSearchBox}>
          <Ionicons name="search-outline" size={16} color={theme.color.textMuted} />
          <TextInput
            accessibilityLabel="Buscar atleta"
            onChangeText={setQuery}
            placeholder="Buscar atleta"
            placeholderTextColor={theme.color.textMuted}
            style={styles.smallSearchInput}
            value={query}
          />
        </View>
      </View>
      <View style={styles.athleteList}>
        {athletes.map((athlete) => {
          const moved =
            normalizeName(athlete.currentClub.name) !== normalizeName(profile.team.name);
          return (
            <View key={athlete.externalId} style={styles.athleteRow}>
              <View style={styles.athleteAvatar} accessibilityElementsHidden>
                <Text style={styles.athleteAvatarText}>
                  {(athlete.nickname ?? athlete.fullName).slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.athleteIdentity}>
                <Text style={styles.athleteName}>{athlete.nickname ?? athlete.fullName}</Text>
                {athlete.nickname ? (
                  <Text style={styles.athleteFullName}>{athlete.fullName}</Text>
                ) : null}
              </View>
              <View style={styles.currentClub}>
                <Text style={styles.currentClubLabel}>CLUBE INFORMADO</Text>
                <Text style={styles.currentClubName}>{athlete.currentClub.name}</Text>
              </View>
              {moved ? <Text style={styles.movedBadge}>OUTRO CLUBE</Text> : null}
            </View>
          );
        })}
        {!athletes.length ? (
          <Text style={styles.noResults} accessibilityLiveRegion="polite">
            Nenhum atleta corresponde à busca.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function resultLabel(match: TeamMatchHistoryDto) {
  return match.result === 'WIN' ? 'Vitória' : match.result === 'LOSS' ? 'Derrota' : 'Empate';
}

function MatchesSection({ profile }: { profile: TeamProfileDto }) {
  return (
    <View style={styles.sectionBody}>
      <View style={styles.headingGroup}>
        <Text style={styles.sectionTitle}>Histórico de partidas</Text>
        <Text style={styles.sectionDescription}>
          Jogos concluídos, do mais recente ao mais antigo, no horário de Brasília.
        </Text>
      </View>
      <View style={styles.matchList}>
        {profile.matches.map((match) => {
          const homeSelected = match.home.externalId === profile.externalId;
          const opponent = homeSelected ? match.away : match.home;
          const when = new Intl.DateTimeFormat('pt-BR', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Sao_Paulo',
          }).format(new Date(match.startsAt));
          return (
            <View
              key={match.externalId}
              accessibilityLabel={`${resultLabel(match)}: ${match.home.name} ${match.home.score} a ${match.away.score} ${match.away.name}`}
              style={styles.matchRow}
            >
              <View style={styles.matchWhen}>
                <Text style={styles.matchRound}>RODADA {match.round}</Text>
                <Text style={styles.matchDate}>{when}</Text>
                <Text style={styles.matchVenue} numberOfLines={2}>
                  {match.venue}
                </Text>
              </View>
              <View style={styles.matchOpponent}>
                <TeamBadge
                  team={{
                    id: opponent.externalId,
                    name: opponent.name,
                    code: null,
                    flagUrl: null,
                    crestUrl: null,
                  }}
                  kind="crest"
                  size={38}
                />
                <View style={styles.matchOpponentCopy}>
                  <Text style={styles.homeAway}>{homeSelected ? 'EM CASA' : 'FORA'}</Text>
                  <Text style={styles.opponentName}>{opponent.name}</Text>
                </View>
              </View>
              <View style={styles.scoreBlock}>
                <Text style={styles.score}>
                  {match.home.score} × {match.away.score}
                </Text>
                <Text
                  style={[
                    styles.resultBadge,
                    match.result === 'WIN'
                      ? styles.resultWin
                      : match.result === 'LOSS'
                        ? styles.resultLoss
                        : styles.resultDraw,
                  ]}
                >
                  {resultLabel(match).toUpperCase()}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function StatisticsSection({
  profile,
  seasonName,
}: {
  profile: TeamProfileDto;
  seasonName: string;
}) {
  const stats = profile.statistics;
  const goalDifference = stats.goalsFor - stats.goalsAgainst;
  const efficiency = stats.played
    ? Math.round(((stats.wins * 3 + stats.draws) / (stats.played * 3)) * 100)
    : 0;
  const metrics = [
    ['Jogos', stats.played],
    ['Vitórias', stats.wins],
    ['Empates', stats.draws],
    ['Derrotas', stats.losses],
    ['Gols marcados', stats.goalsFor],
    ['Gols sofridos', stats.goalsAgainst],
    ['Saldo de gols', goalDifference > 0 ? `+${goalDifference}` : goalDifference],
    ['Sem sofrer gol', stats.cleanSheets],
    ['Aproveitamento', `${efficiency}%`],
    ['Cartões amarelos', stats.yellowCards],
    ['Cartões vermelhos', stats.redCards],
  ];
  return (
    <View style={styles.sectionBody}>
      <View style={styles.headingGroup}>
        <Text style={styles.sectionTitle}>Números em {seasonName}</Text>
        <Text style={styles.sectionDescription}>
          Resumo acumulado do clube no recorte oficial da competição.
        </Text>
      </View>
      <View style={styles.metricsGrid}>
        {metrics.map(([label, value], index) => (
          <View key={String(label)} style={[styles.metric, index < 4 && styles.metricPrimary]}>
            <Text style={styles.metricValue}>{value}</Text>
            <Text style={styles.metricLabel}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function TeamProfileScreen({
  teamId,
  section,
  refreshVersion,
  onBack,
  onOpenSection,
}: {
  teamId: string;
  section: LeagueTeamSection;
  refreshVersion: number;
  onBack: () => void;
  onOpenSection: (section: LeagueTeamSection) => void;
}) {
  const context = useCompetition();
  const [profile, setProfile] = useState<TeamProfileDto | null>(null);
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const request = useRef(new LatestRequest()).current;
  const season = context.season;
  const competitionSlug = context.competition?.slug;

  useEffect(() => {
    if (!season || !teamId) return;
    setStatus(profile ? 'refreshing' : 'loading');
    request
      .run((signal) => api.seasonTeamProfile(season.id, teamId, signal))
      .then((result) => {
        if (!result) return;
        setProfile(result.profile);
        setError('');
        setStatus('success');
      })
      .catch((cause) => {
        setError(errorMessage(cause));
        setStatus('error');
      });
    return () => request.cancel();
  }, [season?.id, teamId, refreshVersion, reload]);

  return (
    <View style={styles.page}>
      <RouteLink
        href={
          competitionSlug
            ? pathForCompetition(competitionSlug, 'teams')
            : pathForScreen('competitions')
        }
        accessibilityLabel="Voltar para todos os times"
        onActivate={onBack}
        style={styles.backLink}
      >
        <Ionicons name="arrow-back" size={17} color={theme.color.textMuted} />
        <Text style={styles.backText}>Todos os times</Text>
      </RouteLink>
      <AsyncState
        status={status}
        error={error}
        onRetry={() => setReload((value) => value + 1)}
        skeletonLines={6}
      >
        {profile ? (
          <>
            <View style={styles.profileHeader}>
              <TeamBadge team={profile.team} kind="crest" size={82} />
              <View style={styles.profileIdentity}>
                <Text style={styles.eyebrow}>PERFIL DO CLUBE · {profile.state ?? 'BR'}</Text>
                <Text accessibilityRole="header" style={styles.profileName}>
                  {profile.team.name}
                </Text>
                <Text style={styles.profileCompetition}>{season?.name ?? 'Temporada'}</Text>
              </View>
              <View style={styles.profileQuickStats}>
                <View style={styles.quickStat}>
                  <Text style={styles.quickValue}>{profile.statistics.played}</Text>
                  <Text style={styles.quickLabel}>JOGOS</Text>
                </View>
                <View style={styles.quickStat}>
                  <Text style={styles.quickValue}>{profile.statistics.wins}</Text>
                  <Text style={styles.quickLabel}>VITÓRIAS</Text>
                </View>
                <View style={styles.quickStat}>
                  <Text style={styles.quickValue}>{profile.statistics.goalsFor}</Text>
                  <Text style={styles.quickLabel}>GOLS</Text>
                </View>
              </View>
            </View>
            <SourceStatus profile={profile} />
            <View
              accessibilityRole="navigation"
              accessibilityLabel={`Seções do perfil de ${profile.team.name}`}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.sectionNav}
              >
                {sectionItems.map((item) => {
                  const active = item.section === section;
                  return (
                    <RouteLink
                      key={item.section}
                      {...({ 'aria-current': active ? 'page' : undefined } as never)}
                      href={
                        competitionSlug
                          ? pathForLeagueTeam(competitionSlug, teamId, item.section)
                          : pathForScreen('competitions')
                      }
                      accessibilityLabel={item.label}
                      accessibilityState={{ selected: active }}
                      onActivate={() => onOpenSection(item.section)}
                      style={[styles.sectionLink, active && styles.sectionLinkActive]}
                    >
                      <Ionicons
                        name={item.icon}
                        size={17}
                        color={active ? theme.color.accentInk : theme.color.textMuted}
                      />
                      <Text
                        style={[styles.sectionLinkText, active && styles.sectionLinkTextActive]}
                      >
                        {item.label}
                      </Text>
                      {item.section === 'athletes' ? (
                        <Text style={[styles.sectionCount, active && styles.sectionCountActive]}>
                          {profile.athletes.length}
                        </Text>
                      ) : null}
                    </RouteLink>
                  );
                })}
              </ScrollView>
            </View>
            {section === 'athletes' ? <AthletesSection profile={profile} /> : null}
            {section === 'matches' ? <MatchesSection profile={profile} /> : null}
            {section === 'statistics' ? (
              <StatisticsSection profile={profile} seasonName={season?.name ?? 'esta temporada'} />
            ) : null}
          </>
        ) : null}
      </AsyncState>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: theme.space.lg, width: '100%' },
  directoryHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
    justifyContent: 'space-between',
  },
  headingGroup: { flex: 1, minWidth: 220 },
  eyebrow: { color: theme.color.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  pageTitle: { color: theme.color.text, fontSize: 28, fontWeight: '900', marginTop: 4 },
  pageSubtitle: {
    color: theme.color.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 5,
    maxWidth: 680,
  },
  searchBox: {
    alignItems: 'center',
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: theme.touchTarget,
    minWidth: 250,
    paddingHorizontal: 12,
  },
  searchInput: {
    color: theme.color.text,
    flex: 1,
    fontSize: 14,
    minHeight: theme.touchTarget,
    outlineStyle: 'none',
  } as never,
  resultMeta: {
    alignItems: 'center',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    paddingBottom: 10,
  },
  resultCount: { color: theme.color.text, fontSize: 12, fontWeight: '900' },
  resultHint: { color: theme.color.textMuted, fontSize: 11 },
  teamGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  teamItem: {
    alignItems: 'center',
    backgroundColor: theme.color.surface,
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexGrow: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 88,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  teamCopy: { flex: 1, minWidth: 0 },
  teamName: { color: theme.color.text, fontSize: 14, fontWeight: '900', lineHeight: 18 },
  teamMeta: { color: theme.color.textMuted, fontSize: 10, fontWeight: '700', marginTop: 3 },
  available: { color: theme.color.accent, fontSize: 9, fontWeight: '800', marginTop: 4 },
  pending: { color: theme.color.warning, fontSize: 9, fontWeight: '800', marginTop: 4 },
  filteredEmpty: { alignItems: 'flex-start', gap: 12, paddingVertical: 32 },
  filteredEmptyTitle: { color: theme.color.text, fontSize: 16, fontWeight: '800' },
  clearButton: {
    alignItems: 'center',
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: 14,
  },
  clearButtonText: { color: theme.color.text, fontWeight: '800' },
  backLink: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 7,
    minHeight: theme.touchTarget,
  },
  backText: { color: theme.color.textMuted, fontSize: 12, fontWeight: '800' },
  profileHeader: {
    alignItems: 'center',
    backgroundColor: theme.color.surface,
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
    padding: 20,
  },
  profileIdentity: { flex: 1, minWidth: 190 },
  profileName: { color: theme.color.text, fontSize: 28, fontWeight: '900', marginTop: 4 },
  profileCompetition: { color: theme.color.textMuted, fontSize: 12, marginTop: 4 },
  profileQuickStats: { alignItems: 'stretch', flexDirection: 'row', gap: 2 },
  quickStat: {
    alignItems: 'center',
    borderLeftColor: theme.color.borderMuted,
    borderLeftWidth: 1,
    minWidth: 72,
    paddingHorizontal: 12,
  },
  quickValue: { color: theme.color.text, fontSize: 22, fontWeight: '900' },
  quickLabel: {
    color: theme.color.textMuted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: 2,
  },
  sourceStatus: {
    alignItems: 'center',
    backgroundColor: 'rgba(52, 209, 123, 0.07)',
    borderColor: 'rgba(52, 209, 123, 0.25)',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    minHeight: theme.touchTarget,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sourceStatusStale: {
    backgroundColor: 'rgba(255, 209, 102, 0.07)',
    borderColor: 'rgba(255, 209, 102, 0.28)',
  },
  sourceText: { color: theme.color.textMuted, flex: 1, fontSize: 11, minWidth: 210 },
  sourceLink: { alignItems: 'center', flexDirection: 'row', gap: 5, minHeight: theme.touchTarget },
  sourceLinkText: { color: theme.color.info, fontSize: 11, fontWeight: '900' },
  sectionNav: {
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    gap: 5,
    minWidth: '100%',
  },
  sectionLink: {
    alignItems: 'center',
    borderTopLeftRadius: theme.radius.sm,
    borderTopRightRadius: theme.radius.sm,
    flexDirection: 'row',
    gap: 7,
    minHeight: theme.touchTarget,
    paddingHorizontal: 14,
  },
  sectionLinkActive: { backgroundColor: theme.color.accent },
  sectionLinkText: { color: theme.color.textMuted, fontSize: 12, fontWeight: '900' },
  sectionLinkTextActive: { color: theme.color.accentInk },
  sectionCount: {
    backgroundColor: theme.color.surfaceRaised,
    borderRadius: theme.radius.pill,
    color: theme.color.textMuted,
    fontSize: 9,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sectionCountActive: { backgroundColor: 'rgba(3,27,37,0.14)', color: theme.color.accentInk },
  sectionBody: { gap: theme.space.lg },
  sectionHeadingRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    justifyContent: 'space-between',
  },
  sectionTitle: { color: theme.color.text, fontSize: 20, fontWeight: '900' },
  sectionDescription: {
    color: theme.color.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
    maxWidth: 720,
  },
  smallSearchBox: {
    alignItems: 'center',
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: theme.touchTarget,
    minWidth: 220,
    paddingHorizontal: 10,
  },
  smallSearchInput: {
    color: theme.color.text,
    flex: 1,
    fontSize: 12,
    minHeight: theme.touchTarget,
    outlineStyle: 'none',
  } as never,
  athleteList: {
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  athleteRow: {
    alignItems: 'center',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  athleteAvatar: {
    alignItems: 'center',
    backgroundColor: theme.color.surfaceRaised,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  athleteAvatarText: { color: theme.color.text, fontSize: 13, fontWeight: '900' },
  athleteIdentity: { flex: 1, minWidth: 160 },
  athleteName: { color: theme.color.text, fontSize: 13, fontWeight: '900' },
  athleteFullName: { color: theme.color.textMuted, fontSize: 10, marginTop: 2 },
  currentClub: { minWidth: 180 },
  currentClubLabel: {
    color: theme.color.textMuted,
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  currentClubName: { color: theme.color.text, fontSize: 11, fontWeight: '700', marginTop: 2 },
  movedBadge: {
    borderColor: theme.color.warning,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    color: theme.color.warning,
    fontSize: 8,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  noResults: { color: theme.color.textMuted, padding: 20 },
  matchList: {
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  matchRow: {
    alignItems: 'center',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    minHeight: 96,
    padding: 14,
  },
  matchWhen: { minWidth: 190 },
  matchRound: { color: theme.color.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.9 },
  matchDate: { color: theme.color.text, fontSize: 11, fontWeight: '800', marginTop: 3 },
  matchVenue: { color: theme.color.textMuted, fontSize: 9, lineHeight: 13, marginTop: 3 },
  matchOpponent: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 10, minWidth: 190 },
  matchOpponentCopy: { flex: 1 },
  homeAway: { color: theme.color.textMuted, fontSize: 7, fontWeight: '900', letterSpacing: 0.8 },
  opponentName: { color: theme.color.text, fontSize: 12, fontWeight: '900', marginTop: 2 },
  scoreBlock: { alignItems: 'flex-end', gap: 5, minWidth: 90 },
  score: { color: theme.color.text, fontSize: 20, fontWeight: '900' },
  resultBadge: {
    borderRadius: theme.radius.pill,
    fontSize: 8,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  resultWin: { backgroundColor: 'rgba(52,209,123,0.14)', color: theme.color.accent },
  resultLoss: { backgroundColor: 'rgba(255,136,120,0.12)', color: theme.color.danger },
  resultDraw: { backgroundColor: 'rgba(114,183,242,0.12)', color: theme.color.info },
  metricsGrid: {
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    overflow: 'hidden',
  },
  metric: {
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    borderRightColor: theme.color.borderMuted,
    borderRightWidth: 1,
    flexBasis: '25%',
    flexGrow: 1,
    minHeight: 96,
    minWidth: 145,
    padding: 16,
  },
  metricPrimary: { backgroundColor: 'rgba(52,209,123,0.05)' },
  metricValue: { color: theme.color.text, fontSize: 25, fontWeight: '900' },
  metricLabel: { color: theme.color.textMuted, fontSize: 10, fontWeight: '800', marginTop: 5 },
});
