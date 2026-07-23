import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type {
  CompetitionDto,
  MatchDto,
  RoundDto,
  SeasonDto,
  StandingRowDto,
  TieDto,
} from '@bolao/shared';
import type { AsyncStatus } from '../../components/AsyncState';
import { AsyncState } from '../../components/AsyncState';
import { ConnectionIndicator } from '../../components/ConnectionIndicator';
import { ScoreInput } from '../../components/ScoreInput';
import { TeamBadge } from '../../components/TeamBadge';
import type { DraftItem, ScoreSide, ScoreValue } from '../../services/drafts';
import { saveStatusLabel } from '../../services/drafts';
import { theme } from '../../theme/tokens';

export type CompetitionPresentation = {
  label?: string;
  theme?: {
    accent?: string;
    accentInk?: string;
    surface?: string;
    glow?: string;
  };
};

export type StageOption = Pick<RoundDto['stage'], 'id' | 'name' | 'type'>;

const fallbackThemes = [
  { accent: '#34d17b', accentInk: '#031b25', surface: '#063957', glow: 'rgba(52, 209, 123, .20)' },
  { accent: '#f4d65c', accentInk: '#201c08', surface: '#473b18', glow: 'rgba(244, 214, 92, .18)' },
  { accent: '#72b7f2', accentInk: '#071b2e', surface: '#123756', glow: 'rgba(114, 183, 242, .20)' },
  { accent: '#e89bc8', accentInk: '#2b0920', surface: '#4b1d3b', glow: 'rgba(232, 155, 200, .18)' },
] as const;

function stableThemeIndex(value: string) {
  return (
    [...value].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 7) %
    fallbackThemes.length
  );
}

/**
 * Presentation is data, not a tournament switch. A stored presentation may override these
 * local colours; the deterministic fallback keeps every season usable without a remote asset.
 */
export function resolveCompetitionPresentation(
  competition?: Pick<CompetitionDto, 'id' | 'name'> | null,
  presentation?: CompetitionPresentation | null,
) {
  const fallback =
    fallbackThemes[stableThemeIndex(competition?.id ?? competition?.name ?? 'competition')];
  return {
    label: presentation?.label ?? 'Temporada',
    accent: presentation?.theme?.accent ?? fallback.accent,
    accentInk: presentation?.theme?.accentInk ?? fallback.accentInk,
    surface: presentation?.theme?.surface ?? fallback.surface,
    glow: presentation?.theme?.glow ?? fallback.glow,
  };
}

export function CompetitionHero({
  competition,
  season,
  capabilities,
  presentation,
  connection,
  syncing = false,
  onRefresh,
}: {
  competition: Pick<CompetitionDto, 'id' | 'name'> | null;
  season: Pick<SeasonDto, 'name' | 'year'> | null;
  capabilities: ReadonlySet<string>;
  presentation?: CompetitionPresentation | null;
  connection: 'live' | 'reconnecting' | 'offline';
  syncing?: boolean;
  onRefresh?: () => void;
}) {
  const resolved = resolveCompetitionPresentation(competition, presentation);
  const formats = [...capabilities]
    .map(
      (capability) =>
        ({ GROUPS: 'Grupos', KNOCKOUT: 'Mata-mata', TWO_LEGS: 'Ida e volta', LEAGUE: 'Liga' })[
          capability
        ] ?? capability,
    )
    .join(' · ');
  const title = season?.name ?? competition?.name ?? 'Competição';
  return (
    <View
      accessibilityLabel={`Contexto da competição: ${title}`}
      style={[styles.hero, { backgroundColor: resolved.surface, borderColor: resolved.accent }]}
    >
      <View pointerEvents="none" style={[styles.heroGlow, { backgroundColor: resolved.glow }]} />
      <View style={styles.heroCopy}>
        <Text style={[styles.eyebrow, { color: resolved.accent }]}>
          {resolved.label.toUpperCase()}
        </Text>
        <Text role="heading" aria-level={1} style={styles.heroTitle}>
          {title}
        </Text>
        <Text style={styles.heroSubtitle}>
          {formats || 'Calendário, palpites e ranking no contexto desta temporada.'}
          {season?.year ? ` · ${season.year}` : ''}
        </Text>
      </View>
      <View style={styles.heroActions}>
        <ConnectionIndicator status={connection} />
        {onRefresh ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Atualizar competição ativa"
            accessibilityState={{ busy: syncing }}
            disabled={syncing}
            onPress={onRefresh}
            style={[
              styles.refreshButton,
              { borderColor: resolved.accent },
              syncing && styles.dimmed,
            ]}
          >
            <Text style={[styles.refreshButtonText, { color: resolved.accent }]}>
              {syncing ? 'Atualizando…' : 'Atualizar'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function SelectorRail<T extends { id: string; name: string }>({
  label,
  options,
  selectedId,
  onChange,
}: {
  label: string;
  options: readonly T[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  if (!options.length) return null;
  return (
    <View style={styles.selector}>
      <Text style={styles.selectorLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        accessibilityLabel={label}
        contentContainerStyle={styles.selectorRail}
      >
        {options.map((option) => {
          const selected = option.id === selectedId;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.id)}
              style={[styles.selectorTab, selected && styles.selectorTabActive]}
            >
              <Text style={[styles.selectorText, selected && styles.selectorTextActive]}>
                {option.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function StageSelector(props: {
  stages: readonly StageOption[];
  selectedStageId: string;
  onChange: (stageId: string) => void;
}) {
  return (
    <SelectorRail
      label="Fases disponíveis"
      options={props.stages}
      selectedId={props.selectedStageId}
      onChange={props.onChange}
    />
  );
}

export function RoundSelector(props: {
  rounds: readonly RoundDto[];
  selectedRoundId: string;
  onChange: (roundId: string) => void;
}) {
  return (
    <SelectorRail
      label="Rodadas disponíveis"
      options={props.rounds}
      selectedId={props.selectedRoundId}
      onChange={props.onChange}
    />
  );
}

function groupName(group: string) {
  return /^grupo\s+/i.test(group) ? group : `Grupo ${group}`;
}

export function GroupStandings({
  groups,
  onOpenTeam,
}: {
  groups: Array<{ group: string; rows: StandingRowDto[] }>;
  onOpenTeam?: (teamId: string) => void;
}) {
  if (!groups.length) {
    return (
      <AsyncState
        status="empty"
        emptyTitle="Grupos indisponíveis"
        emptyMessage="A tabela de grupos será exibida após a publicação oficial."
      />
    );
  }
  return (
    <View accessibilityLabel="Classificação por grupos" style={styles.groupsGrid}>
      {groups
        .slice()
        .sort((left, right) => left.group.localeCompare(right.group, 'pt-BR', { numeric: true }))
        .map((group) => (
          <View key={group.group} style={styles.groupPanel}>
            <Text accessibilityRole="header" style={styles.groupTitle}>
              {groupName(group.group)}
            </Text>
            <View style={[styles.standingRow, styles.standingHeader]}>
              <Text style={styles.rankCell}>#</Text>
              <Text style={styles.clubCell}>Time</Text>
              <Text style={styles.numberCell}>J</Text>
              <Text style={styles.numberCell}>SG</Text>
              <Text style={styles.pointsCell}>PTS</Text>
            </View>
            {group.rows.map((row) => (
              <Pressable
                key={row.team.id}
                accessibilityRole={onOpenTeam ? 'button' : undefined}
                accessibilityLabel={`${row.rank}º, ${row.team.name}, ${row.points} pontos`}
                disabled={!onOpenTeam}
                onPress={() => onOpenTeam?.(row.team.id)}
                style={styles.standingRow}
              >
                <Text style={styles.rankCell}>{row.rank}</Text>
                <View style={styles.clubCell}>
                  <TeamBadge team={row.team} kind="crest" size={26} />
                  <Text numberOfLines={1} style={styles.clubName}>
                    {row.team.name}
                  </Text>
                </View>
                <Text style={styles.numberCell}>{row.played}</Text>
                <Text style={styles.numberCell}>{row.goalDifference}</Text>
                <Text style={styles.pointsCell}>{row.points}</Text>
              </Pressable>
            ))}
          </View>
        ))}
    </View>
  );
}

function matchScore(match: TieDto['matches'][number]) {
  const home = match.regulationHomeScore ?? match.finalHomeScore ?? match.homeScore;
  const away = match.regulationAwayScore ?? match.finalAwayScore ?? match.awayScore;
  return home == null || away == null ? '–' : `${home} × ${away}`;
}

function decisionLabel(tie: TieDto) {
  if (tie.decisionMethod === 'PENALTIES') return 'Pênaltis';
  if (tie.decisionMethod === 'EXTRA_TIME') return 'Prorrogação';
  if (tie.decisionMethod === 'WALKOVER') return 'W.O.';
  if (tie.decisionMethod === 'ADMINISTRATIVE') return 'Decisão administrativa';
  return tie.status === 'DECIDED' ? 'Agregado' : null;
}

export function TieCard({ tie }: { tie: TieDto }) {
  const decision = decisionLabel(tie);
  const aggregate =
    tie.aggregateTeamAScore == null || tie.aggregateTeamBScore == null
      ? null
      : `${tie.aggregateTeamAScore} × ${tie.aggregateTeamBScore}`;
  return (
    <View
      accessibilityLabel={`${tie.teamA.name} contra ${tie.teamB.name}, ${tie.expectedLegs === 1 ? 'partida única' : 'ida e volta'}`}
      style={styles.tieCard}
    >
      <View style={styles.tieHeading}>
        <Text style={styles.tieKind}>
          {tie.expectedLegs === 1 ? 'PARTIDA ÚNICA' : 'IDA E VOLTA'}
        </Text>
        {decision ? <Text style={styles.tieDecision}>{decision}</Text> : null}
      </View>
      {[tie.teamA, tie.teamB].map((team) => {
        const winner = tie.winnerTeam?.id === team.id;
        return (
          <View key={team.id} style={styles.tieTeam}>
            <TeamBadge team={team} kind="crest" size={30} />
            <Text numberOfLines={1} style={[styles.tieName, winner && styles.tieWinner]}>
              {team.name}
            </Text>
            {winner ? <Text style={styles.qualified}>Classificado</Text> : null}
          </View>
        );
      })}
      <View style={styles.legs}>
        {tie.matches
          .slice()
          .sort((left, right) => (left.legNumber ?? 1) - (right.legNumber ?? 1))
          .map((match) => (
            <View key={match.id} style={styles.legRow}>
              <Text style={styles.legLabel}>
                {tie.expectedLegs === 1 ? 'Jogo' : `${match.legNumber}ª perna`}
              </Text>
              <Text style={styles.legTeams} numberOfLines={1}>
                {match.homeTeam.name} × {match.awayTeam.name}
              </Text>
              <Text style={styles.legScore}>{matchScore(match)}</Text>
              {match.penaltyHomeScore != null && match.penaltyAwayScore != null ? (
                <Text style={styles.penalties}>
                  Pên. {match.penaltyHomeScore}–{match.penaltyAwayScore}
                </Text>
              ) : null}
            </View>
          ))}
      </View>
      {aggregate ? <Text style={styles.aggregate}>Agregado {aggregate}</Text> : null}
    </View>
  );
}

export function KnockoutBracket({
  ties,
  rounds,
  status,
  error,
  onRetry,
}: {
  ties: TieDto[];
  rounds: RoundDto[];
  status: AsyncStatus;
  error?: string;
  onRetry?: () => void;
}) {
  if (status === 'loading') return <AsyncState status="loading" skeletonLines={5} />;
  if (!ties.length)
    return (
      <AsyncState
        status={status === 'error' ? 'error' : 'empty'}
        error={error}
        onRetry={onRetry}
        emptyTitle="Chave indisponível"
        emptyMessage="Os confrontos serão publicados pela fonte oficial."
      />
    );
  const roundById = new Map(rounds.map((round) => [round.id, round]));
  const columns = [
    ...new Map(
      ties.map((tie) => [
        tie.roundId,
        {
          id: tie.roundId,
          name: roundById.get(tie.roundId)?.name ?? 'Fase',
          order: roundById.get(tie.roundId)?.order ?? tie.order,
        },
      ]),
    ).values(),
  ].sort((left, right) => left.order - right.order);
  return (
    <AsyncState status={status} error={error} onRetry={onRetry}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        contentContainerStyle={styles.bracketRail}
        accessibilityLabel="Chave eliminatória"
      >
        {columns.map((column) => (
          <View key={column.id} style={styles.bracketColumn}>
            <Text accessibilityRole="header" style={styles.bracketRound}>
              {column.name}
            </Text>
            {ties
              .filter((tie) => tie.roundId === column.id)
              .sort((left, right) => left.order - right.order)
              .map((tie) => (
                <TieCard key={tie.id} tie={tie} />
              ))}
          </View>
        ))}
      </ScrollView>
    </AsyncState>
  );
}

export function MatchPredictionCard({
  match,
  value,
  item,
  open,
  availabilityLabel,
  unavailableReason,
  timezone,
  roundLabel,
  onEdit,
  onSave,
  onDiscard,
  onOpenPublicPredictions,
}: {
  match: MatchDto;
  value: ScoreValue;
  item?: DraftItem;
  open: boolean;
  availabilityLabel: string;
  unavailableReason?: string;
  timezone: string;
  roundLabel?: string;
  onEdit: (side: ScoreSide, value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onOpenPublicPredictions?: () => void;
}) {
  const officialHome =
    match.status === 'FINISHED' ? (match.finalHomeScore ?? match.homeScore) : match.homeScore;
  const officialAway =
    match.status === 'FINISHED' ? (match.finalAwayScore ?? match.awayScore) : match.awayScore;
  const official =
    officialHome == null || officialAway == null ? null : `${officialHome} × ${officialAway}`;
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(match.startsAt));
  const canDiscard = item?.dirty.home || item?.dirty.away;
  return (
    <View
      style={styles.predictionCard}
      accessibilityLabel={`${match.homeTeam.name} contra ${match.awayTeam.name}`}
    >
      <View style={styles.predictionMeta}>
        <View style={styles.predictionSchedule}>
          {roundLabel ? <Text style={styles.roundLabel}>{roundLabel}</Text> : null}
          <Text style={styles.matchTime}>{time}</Text>
        </View>
        <Text style={[styles.matchState, open ? styles.openState : styles.closedState]}>
          {match.status === 'LIVE'
            ? 'AO VIVO'
            : match.status === 'FINISHED'
              ? 'FINAL'
              : availabilityLabel}
        </Text>
      </View>
      <View style={styles.predictionMatchup}>
        <View style={styles.predictionTeam}>
          <TeamBadge team={match.homeTeam} kind="crest" size={34} />
          <Text numberOfLines={2} style={styles.predictionTeamName}>
            {match.homeTeam.name}
          </Text>
        </View>
        {official ? (
          <Text style={styles.officialScore}>{official}</Text>
        ) : (
          <View style={styles.scoreInputs}>
            <ScoreInput
              teamName={match.homeTeam.name}
              side="home"
              value={value.home}
              editable={open}
              error={item?.status === 'failed' ? item.error : undefined}
              onChange={(next) => onEdit('home', next)}
            />
            <Text style={styles.versus}>×</Text>
            <ScoreInput
              teamName={match.awayTeam.name}
              side="away"
              value={value.away}
              editable={open}
              onChange={(next) => onEdit('away', next)}
            />
          </View>
        )}
        <View style={styles.predictionTeam}>
          <TeamBadge team={match.awayTeam} kind="crest" size={34} />
          <Text numberOfLines={2} style={styles.predictionTeamName}>
            {match.awayTeam.name}
          </Text>
        </View>
      </View>
      {!official && unavailableReason ? (
        <Text style={styles.unavailableReason}>{unavailableReason}</Text>
      ) : null}
      {!official ? (
        <View style={styles.predictionActions}>
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.syncState, item?.status === 'failed' && styles.errorText]}
          >
            {saveStatusLabel(item)}
          </Text>
          {canDiscard ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Descartar palpite não salvo"
              onPress={onDiscard}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Descartar</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={!open || item?.status === 'saving'}
            onPress={onSave}
            style={[styles.saveButton, (!open || item?.status === 'saving') && styles.dimmed]}
          >
            <Text style={styles.saveButtonText}>
              {item?.status === 'saving' ? 'Salvando…' : 'Salvar'}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {onOpenPublicPredictions ? (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenPublicPredictions}
          style={styles.publicButton}
        >
          <Text style={styles.publicButtonText}>Ver palpites públicos</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.lg,
    justifyContent: 'space-between',
    overflow: 'hidden',
    padding: theme.space.xl,
    position: 'relative',
  },
  heroGlow: {
    borderRadius: 180,
    height: 260,
    position: 'absolute',
    right: -80,
    top: -130,
    width: 260,
  },
  heroCopy: { gap: 4, maxWidth: 700, zIndex: 1 },
  eyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  heroTitle: { color: theme.color.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.7 },
  heroSubtitle: { color: theme.color.textMuted, fontSize: 13, lineHeight: 19 },
  heroActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.sm,
    zIndex: 1,
  },
  refreshButton: {
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  refreshButtonText: { fontSize: 12, fontWeight: '900' },
  dimmed: { opacity: 0.5 },
  selector: { gap: theme.space.xs },
  selectorLabel: {
    color: theme.color.textMuted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  selectorRail: { gap: 7 },
  selectorTab: {
    borderColor: theme.color.border,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
  },
  selectorTabActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  selectorText: { color: theme.color.textMuted, fontSize: 11, fontWeight: '800' },
  selectorTextActive: { color: theme.color.accentInk },
  groupsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md },
  groupPanel: {
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 285,
    overflow: 'hidden',
    paddingBottom: theme.space.xs,
  },
  groupTitle: {
    color: theme.color.text,
    fontSize: 15,
    fontWeight: '900',
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.md,
  },
  standingRow: {
    alignItems: 'center',
    borderTopColor: theme.color.borderMuted,
    borderTopWidth: 1,
    flexDirection: 'row',
    minHeight: 42,
    paddingHorizontal: theme.space.sm,
  },
  standingHeader: { borderTopWidth: 0, marginTop: theme.space.sm },
  rankCell: {
    color: theme.color.info,
    fontSize: 10,
    fontWeight: '900',
    textAlign: 'center',
    width: 28,
  },
  clubCell: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 6, minWidth: 125 },
  clubName: { color: theme.color.text, flex: 1, fontSize: 11, fontWeight: '800' },
  numberCell: {
    color: theme.color.textMuted,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
    width: 34,
  },
  pointsCell: {
    color: theme.color.accent,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
    width: 40,
  },
  bracketRail: {
    alignItems: 'flex-start',
    gap: theme.space.md,
    minWidth: '100%',
    paddingBottom: theme.space.sm,
  },
  bracketColumn: { gap: theme.space.sm, width: 310 },
  bracketRound: {
    color: theme.color.text,
    fontSize: 14,
    fontWeight: '900',
    minHeight: theme.touchTarget,
    paddingTop: 10,
  },
  tieCard: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.space.sm,
    padding: theme.space.md,
  },
  tieHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  tieKind: { color: theme.color.textMuted, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  tieDecision: { color: theme.color.gold, fontSize: 10, fontWeight: '900' },
  tieTeam: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  tieName: { color: theme.color.text, flex: 1, fontSize: 12, fontWeight: '800' },
  tieWinner: { color: theme.color.accent },
  qualified: {
    color: theme.color.accent,
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  legs: {
    borderTopColor: theme.color.borderMuted,
    borderTopWidth: 1,
    gap: 5,
    paddingTop: theme.space.sm,
  },
  legRow: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  legLabel: { color: theme.color.textMuted, fontSize: 9, fontWeight: '800', width: 48 },
  legTeams: { color: theme.color.textMuted, flex: 1, fontSize: 9 },
  legScore: { color: theme.color.text, fontSize: 11, fontWeight: '900' },
  penalties: { color: theme.color.gold, fontSize: 8, fontWeight: '900' },
  aggregate: { color: theme.color.gold, fontSize: 11, fontWeight: '900', textAlign: 'right' },
  predictionCard: {
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    gap: theme.space.sm,
    paddingVertical: theme.space.lg,
  },
  predictionMeta: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  predictionSchedule: { alignItems: 'center', flexDirection: 'row', gap: theme.space.sm },
  roundLabel: { color: theme.color.textMuted, fontSize: 11, fontWeight: '800' },
  matchTime: { color: theme.color.textMuted, fontSize: 11, fontWeight: '800' },
  matchState: {
    borderRadius: theme.radius.pill,
    fontSize: 9,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  openState: { backgroundColor: 'rgba(52, 209, 123, .14)', color: theme.color.accent },
  closedState: { backgroundColor: 'rgba(145, 174, 204, .14)', color: theme.color.textMuted },
  predictionMatchup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.space.sm,
    justifyContent: 'space-between',
  },
  predictionTeam: { alignItems: 'center', flex: 1, gap: 5 },
  predictionTeamName: {
    color: theme.color.text,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  scoreInputs: { alignItems: 'flex-start', flexDirection: 'row', gap: 4 },
  versus: { color: theme.color.textMuted, fontSize: 18, fontWeight: '900', marginTop: 28 },
  officialScore: { color: theme.color.text, fontSize: 22, fontWeight: '900' },
  unavailableReason: {
    color: theme.color.textMuted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
  predictionActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.sm,
    justifyContent: 'flex-end',
  },
  syncState: { color: theme.color.textMuted, flex: 1, fontSize: 11, textAlign: 'right' },
  errorText: { color: theme.color.danger },
  saveButton: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.sm,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  saveButtonText: { color: theme.color.accentInk, fontSize: 12, fontWeight: '900' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
  },
  secondaryButtonText: { color: theme.color.textMuted, fontSize: 11, fontWeight: '800' },
  publicButton: { alignSelf: 'flex-end', minHeight: theme.touchTarget, justifyContent: 'center' },
  publicButtonText: { color: theme.color.gold, fontSize: 11, fontWeight: '900' },
});
