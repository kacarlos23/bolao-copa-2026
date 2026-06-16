import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  api,
  createPredictionBoardEvents,
  type KnockoutFixture,
  type PredictionBoard,
  type PredictionBoardGroup,
  type PredictionBoardMatch,
  type PublicKnockoutBracket,
  type Team,
} from './api';
import { flagSources } from './flagSources';
import { DailyPredictionsV2 } from './competitionV2';
import { SoftReveal } from './motion';

const competitionUiV2 = process.env.EXPO_PUBLIC_COMPETITION_UI_V2 === '1';

const palette = {
  shell: '#071311',
  shellSoft: '#10231d',
  bracket: '#081713',
  bracketCard: '#102820',
  bracketBorder: '#315447',
  paper: '#ffffff',
  paperSoft: '#f3f6f4',
  ink: '#10231d',
  muted: '#62736c',
  line: '#d9e2dd',
  green: '#18975f',
  greenDark: '#0d6d46',
  yellow: '#f0c735',
  red: '#d9574d',
  white: '#f7fbf8',
};

type ScoreDraft = Record<string, { home: string; away: string }>;
type KnockoutDraft = Record<number, { home: string; away: string; advancingTeamId: string | null }>;

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function compactDateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
    .format(new Date(value))
    .replace(',', ' ·');
}

function shortTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function TeamFlag({ team, size = 18 }: { team?: Team | null; size?: number }) {
  const iso2 = team?.metadata?.iso2?.toLowerCase();
  const source = iso2 ? flagSources[iso2] : null;
  if (!source) {
    return (
      <View style={[styles.flagFallback, { width: size * 1.5, height: size }]}>
        <Text style={[styles.flagFallbackText, { fontSize: Math.max(5, size * 0.45) }]}>
          {team?.code?.slice(0, 2) ?? '--'}
        </Text>
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

function TeamLabel({
  team,
  compact = false,
  dense = false,
  tone = 'dark',
}: {
  team?: Team | null;
  compact?: boolean;
  dense?: boolean;
  tone?: 'dark' | 'light';
}) {
  return (
    <View style={[styles.teamLabel, dense && styles.teamLabelDense]}>
      <TeamFlag team={team} size={dense ? 10 : compact ? 15 : 18} />
      <Text
        style={[
          dense ? styles.teamNameDense : compact ? styles.teamNameCompact : styles.teamName,
          tone === 'light' && styles.teamNameLight,
        ]}
        numberOfLines={1}
      >
        {team?.name ?? 'A definir'}
      </Text>
    </View>
  );
}

function scoreForMatch(match: PredictionBoardMatch, draft: ScoreDraft) {
  if (!match.isOpenForPredictions && match.status === 'FINISHED') {
    const home = match.finalHomeScore ?? match.homeScore;
    const away = match.finalAwayScore ?? match.awayScore;
    return home == null || away == null ? null : { home, away };
  }
  if (!match.isOpenForPredictions && match.status === 'LIVE') {
    return match.homeScore == null || match.awayScore == null
      ? null
      : { home: match.homeScore, away: match.awayScore };
  }
  const value = draft[match.id];
  if (!value || value.home === '' || value.away === '') return null;
  return { home: Number(value.home), away: Number(value.away) };
}

function projectedRows(group: PredictionBoardGroup, draft: ScoreDraft) {
  const rows = new Map(
    group.standings.map((row) => [
      row.team.id,
      {
        team: row.team,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
      },
    ]),
  );
  for (const match of group.matches) {
    const score = scoreForMatch(match, draft);
    const home = rows.get(match.homeTeam.id);
    const away = rows.get(match.awayTeam.id);
    if (!score || !home || !away) continue;
    const add = (row: typeof home, goalsFor: number, goalsAgainst: number) => {
      row.played += 1;
      row.goalsFor += goalsFor;
      row.goalsAgainst += goalsAgainst;
      row.goalDifference = row.goalsFor - row.goalsAgainst;
      if (goalsFor > goalsAgainst) {
        row.wins += 1;
        row.points += 3;
      } else if (goalsFor === goalsAgainst) {
        row.draws += 1;
        row.points += 1;
      } else {
        row.losses += 1;
      }
    };
    add(home, score.home, score.away);
    add(away, score.away, score.home);
  }
  return [...rows.values()]
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor ||
        a.team.name.localeCompare(b.team.name, 'pt-BR'),
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function PublicPredictionsModal({
  match,
  currentUserId,
  onClose,
}: {
  match: PredictionBoardMatch | null;
  currentUserId: string;
  onClose: () => void;
}) {
  const predictions = [...(match?.publicPredictions ?? [])].sort((a, b) => {
    if (a.userId === currentUserId) return -1;
    if (b.userId === currentUserId) return 1;
    return (a.user?.nickname ?? '').localeCompare(b.user?.nickname ?? '', 'pt-BR');
  });
  return (
    <Modal transparent animationType="fade" visible={Boolean(match)} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.publicModal}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Palpites dos participantes</Text>
              {match ? (
                <Text style={styles.modalSubtitle}>
                  {match.homeTeam.name} x {match.awayTeam.name}
                </Text>
              ) : null}
            </View>
            <Pressable style={styles.iconButton} onPress={onClose} accessibilityLabel="Fechar">
              <Ionicons name="close" size={22} color={palette.white} />
            </Pressable>
          </View>
          <ScrollView style={styles.publicList} contentContainerStyle={styles.publicListContent}>
            {predictions.length ? (
              predictions.map((prediction) => (
                <View
                  key={prediction.id}
                  style={[
                    styles.publicPredictionRow,
                    prediction.userId === currentUserId && styles.publicPredictionMine,
                  ]}
                >
                  <Text style={styles.publicPredictionName} numberOfLines={1}>
                    {prediction.user?.nickname ?? 'Participante'}
                  </Text>
                  <Text style={styles.publicPredictionScore}>
                    {prediction.predictedHomeScore} x {prediction.predictedAwayScore}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.modalSubtitle}>Nenhum palpite enviado.</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function SuccessModal({
  visible,
  message,
  onClose,
}: {
  visible: boolean;
  message: string;
  onClose: () => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return progress.setValue(0);
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
            style={[styles.successMark, { opacity: progress, transform: [{ scale: progress }] }]}
          >
            <Ionicons name="checkmark" size={52} color={palette.white} />
          </Animated.View>
          <Text style={styles.successTitle}>Palpites salvos</Text>
          <Text style={styles.successMessage}>{message}</Text>
          <Pressable style={styles.primaryButton} onPress={onClose}>
            <Text style={styles.primaryButtonText}>OK</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function GroupMatchRow({
  match,
  draft,
  canPredict,
  saving,
  onChange,
  onSave,
  onOpenPublic,
}: {
  match: PredictionBoardMatch;
  draft: ScoreDraft;
  canPredict: boolean;
  saving: boolean;
  onChange: (matchId: string, side: 'home' | 'away', value: string) => void;
  onSave: (match: PredictionBoardMatch) => void;
  onOpenPublic: (match: PredictionBoardMatch) => void;
}) {
  const value = draft[match.id] ?? { home: '', away: '' };
  const locked = !canPredict || !match.isOpenForPredictions;
  const showsOfficialScore =
    !match.isOpenForPredictions && (match.status === 'FINISHED' || match.status === 'LIVE');
  const official = scoreForMatch(match, draft);
  const displayHome = showsOfficialScore ? String(official?.home ?? '-') : value.home;
  const displayAway = showsOfficialScore ? String(official?.away ?? '-') : value.away;

  return (
    <View style={[styles.groupMatchRow, match.status === 'LIVE' && styles.groupMatchLive]}>
      <View style={styles.matchMetaLine}>
        <Text style={styles.matchTime}>{shortTime(match.startsAt)}</Text>
        <Text style={styles.matchState}>
          {!match.isOpenForPredictions && match.status === 'FINISHED'
            ? 'Final'
            : !match.isOpenForPredictions && match.status === 'LIVE'
              ? 'Ao vivo'
              : match.isOpenForPredictions
                ? `Fecha ${dateTime(match.predictionsCloseAt)}`
                : 'Fechado'}
        </Text>
      </View>
      <View style={styles.matchTeamsAndScore}>
        <View style={styles.matchTeams}>
          <TeamLabel team={match.homeTeam} compact />
          <TeamLabel team={match.awayTeam} compact />
        </View>
        <View style={styles.compactScoreInputs}>
          <TextInput
            editable={!locked}
            keyboardType="number-pad"
            maxLength={2}
            value={displayHome}
            onChangeText={(text) => onChange(match.id, 'home', text.replace(/\D/g, ''))}
            style={[styles.compactScoreInput, locked && styles.compactScoreLocked]}
          />
          <Text style={styles.scoreSeparator}>x</Text>
          <TextInput
            editable={!locked}
            keyboardType="number-pad"
            maxLength={2}
            value={displayAway}
            onChangeText={(text) => onChange(match.id, 'away', text.replace(/\D/g, ''))}
            style={[styles.compactScoreInput, locked && styles.compactScoreLocked]}
          />
        </View>
      </View>
      <View style={styles.matchActions}>
        {!locked ? (
          <Pressable
            disabled={saving || value.home === '' || value.away === ''}
            onPress={() => onSave(match)}
            style={[
              styles.saveMatchButton,
              (saving || value.home === '' || value.away === '') && styles.disabled,
            ]}
          >
            <Ionicons name="save-outline" size={15} color={palette.white} />
            <Text style={styles.saveMatchText}>{saving ? 'Salvando' : 'Salvar'}</Text>
          </Pressable>
        ) : null}
        {match.predictionsArePublic ? (
          <Pressable style={styles.publicButton} onPress={() => onOpenPublic(match)}>
            <Ionicons name="people-outline" size={15} color={palette.greenDark} />
            <Text style={styles.publicButtonText}>{match.publicPredictions.length}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function GroupModule({
  group,
  draft,
  canPredict,
  savingMatchId,
  onChange,
  onSave,
  onOpenPublic,
}: {
  group: PredictionBoardGroup;
  draft: ScoreDraft;
  canPredict: boolean;
  savingMatchId: string | null;
  onChange: (matchId: string, side: 'home' | 'away', value: string) => void;
  onSave: (match: PredictionBoardMatch) => void;
  onOpenPublic: (match: PredictionBoardMatch) => void;
}) {
  const standings = projectedRows(group, draft);
  return (
    <View style={styles.groupModule}>
      <View style={styles.groupHeader}>
        <Text style={styles.groupTitle}>Grupo {group.group}</Text>
        <Text style={styles.groupProgress}>
          {group.matches.filter((match) => match.status === 'FINISHED').length}/6 jogos
        </Text>
      </View>
      <View style={styles.groupMatches}>
        {group.matches.map((match) => (
          <GroupMatchRow
            key={match.id}
            match={match}
            draft={draft}
            canPredict={canPredict}
            saving={savingMatchId === match.id}
            onChange={onChange}
            onSave={onSave}
            onOpenPublic={onOpenPublic}
          />
        ))}
      </View>
      <View style={styles.standingsTable}>
        <View style={[styles.standingsRow, styles.standingsHeader]}>
          <Text style={[styles.standingCell, styles.positionCell]}>#</Text>
          <Text style={[styles.standingCell, styles.standingTeamCell]}>Selecao</Text>
          {['J', 'V', 'E', 'D', 'SG', 'PTS'].map((label) => (
            <Text key={label} style={[styles.standingCell, styles.statCell]}>
              {label}
            </Text>
          ))}
        </View>
        {standings.map((row) => (
          <View key={row.team.id} style={styles.standingsRow}>
            <Text
              style={[styles.standingCell, styles.positionCell, row.rank <= 2 && styles.qualified]}
            >
              {row.rank}
            </Text>
            <View style={styles.standingTeamCell}>
              <TeamLabel team={row.team} compact />
            </View>
            {[row.played, row.wins, row.draws, row.losses, row.goalDifference, row.points].map(
              (value, index) => (
                <Text
                  key={index}
                  style={[styles.standingCell, styles.statCell, index === 5 && styles.points]}
                >
                  {value > 0 && index === 4 ? `+${value}` : value}
                </Text>
              ),
            )}
          </View>
        ))}
      </View>
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

const bracketStageOrder = [
  'ROUND_OF_32',
  'ROUND_OF_16',
  'QUARTER_FINAL',
  'SEMI_FINAL',
  'THIRD_PLACE',
  'FINAL',
] as const;

const bracketStageRanges: Record<KnockoutFixture['stage'], string> = {
  ROUND_OF_32: '28/06 - 03/07',
  ROUND_OF_16: '04/07 - 07/07',
  QUARTER_FINAL: '09/07 - 11/07',
  SEMI_FINAL: '14/07 - 15/07',
  THIRD_PLACE: '18/07',
  FINAL: '19/07',
};

const BRACKET_CARD_WIDTH = 132;
const BRACKET_CARD_HEIGHT = 52;
const BRACKET_CANVAS_WIDTH = 1292;
const BRACKET_CANVAS_HEIGHT = 550;

type BracketPosition = { x: number; y: number };

const bracketPositions = new Map<number, BracketPosition>();

function assignBracketPositions(numbers: number[], x: number, firstY: number, gap: number) {
  numbers.forEach((number, index) => bracketPositions.set(number, { x, y: firstY + index * gap }));
}

assignBracketPositions([74, 77, 73, 75, 83, 84, 81, 82], 4, 36, 64);
assignBracketPositions([89, 90, 93, 94], 148, 68, 128);
assignBracketPositions([97, 98], 292, 132, 256);
assignBracketPositions([101], 436, 260, 0);
assignBracketPositions([104], 580, 202, 0);
assignBracketPositions([103], 580, 388, 0);
assignBracketPositions([102], 724, 260, 0);
assignBracketPositions([99, 100], 868, 132, 256);
assignBracketPositions([91, 92, 95, 96], 1012, 68, 128);
assignBracketPositions([76, 78, 79, 80, 86, 88, 85, 87], 1156, 36, 64);

const bracketPairs = [
  { sources: [74, 77], target: 89, side: 'right' },
  { sources: [73, 75], target: 90, side: 'right' },
  { sources: [83, 84], target: 93, side: 'right' },
  { sources: [81, 82], target: 94, side: 'right' },
  { sources: [89, 90], target: 97, side: 'right' },
  { sources: [93, 94], target: 98, side: 'right' },
  { sources: [97, 98], target: 101, side: 'right' },
  { sources: [76, 78], target: 91, side: 'left' },
  { sources: [79, 80], target: 92, side: 'left' },
  { sources: [86, 88], target: 95, side: 'left' },
  { sources: [85, 87], target: 96, side: 'left' },
  { sources: [91, 92], target: 99, side: 'left' },
  { sources: [95, 96], target: 100, side: 'left' },
  { sources: [99, 100], target: 102, side: 'left' },
] as const;

function BracketPairConnector({
  sources,
  target,
  side,
}: {
  sources: readonly [number, number];
  target: number;
  side: 'left' | 'right';
}) {
  const sourcePositions = sources.map((number) => bracketPositions.get(number));
  const targetPosition = bracketPositions.get(target);
  if (!sourcePositions[0] || !sourcePositions[1] || !targetPosition) return null;
  const sourceEdgeX =
    side === 'right' ? sourcePositions[0].x + BRACKET_CARD_WIDTH : sourcePositions[0].x;
  const targetEdgeX = side === 'right' ? targetPosition.x : targetPosition.x + BRACKET_CARD_WIDTH;
  const middleX = (sourceEdgeX + targetEdgeX) / 2;
  const sourceCenters = sourcePositions.map((position) => position!.y + BRACKET_CARD_HEIGHT / 2);
  const targetCenter = targetPosition.y + BRACKET_CARD_HEIGHT / 2;
  const sourceLineLeft = Math.min(sourceEdgeX, middleX);
  const sourceLineWidth = Math.abs(sourceEdgeX - middleX);
  const targetLineLeft = Math.min(targetEdgeX, middleX);
  const targetLineWidth = Math.abs(targetEdgeX - middleX);
  return (
    <>
      {sourceCenters.map((center, index) => (
        <View
          key={`${sources[index]}-${target}`}
          style={[
            styles.bracketConnectorHorizontal,
            { left: sourceLineLeft, top: center, width: sourceLineWidth },
          ]}
        />
      ))}
      <View
        style={[
          styles.bracketConnectorVertical,
          {
            left: middleX,
            top: Math.min(...sourceCenters),
            height: Math.max(...sourceCenters) - Math.min(...sourceCenters),
          },
        ]}
      />
      <View
        style={[
          styles.bracketConnectorHorizontal,
          { left: targetLineLeft, top: targetCenter, width: targetLineWidth },
        ]}
      />
    </>
  );
}

function BracketFinalConnector({ from, side }: { from: number; side: 'left' | 'right' }) {
  const source = bracketPositions.get(from);
  const target = bracketPositions.get(104);
  if (!source || !target) return null;
  const sourceEdge = side === 'right' ? source.x + BRACKET_CARD_WIDTH : source.x;
  const targetEdge = side === 'right' ? target.x : target.x + BRACKET_CARD_WIDTH;
  const middleX = (sourceEdge + targetEdge) / 2;
  const sourceCenter = source.y + BRACKET_CARD_HEIGHT / 2;
  const targetCenter = target.y + BRACKET_CARD_HEIGHT / 2;
  return (
    <>
      <View
        style={[
          styles.bracketConnectorHorizontal,
          {
            left: Math.min(sourceEdge, middleX),
            top: sourceCenter,
            width: Math.abs(sourceEdge - middleX),
          },
        ]}
      />
      <View
        style={[
          styles.bracketConnectorVertical,
          {
            left: middleX,
            top: Math.min(sourceCenter, targetCenter),
            height: Math.abs(sourceCenter - targetCenter),
          },
        ]}
      />
      <View
        style={[
          styles.bracketConnectorHorizontal,
          {
            left: Math.min(targetEdge, middleX),
            top: targetCenter,
            width: Math.abs(targetEdge - middleX),
          },
        ]}
      />
    </>
  );
}

function sourceParticipant(
  source: string,
  participants: Map<number, { homeTeamId: string | null; awayTeamId: string | null }>,
  draft: KnockoutDraft,
) {
  const sourceNumber = Number(source.slice(1));
  const previous = participants.get(sourceNumber);
  const advancing = draft[sourceNumber]?.advancingTeamId;
  if (!previous?.homeTeamId || !previous.awayTeamId || !advancing) return null;
  if (source.startsWith('W')) return advancing;
  return advancing === previous.homeTeamId ? previous.awayTeamId : previous.homeTeamId;
}

function materializeClientParticipants(board: PredictionBoard, draft: KnockoutDraft) {
  const participants = new Map(
    board.knockout.roundOf32.map((item) => [
      item.matchNumber,
      { homeTeamId: item.homeTeamId, awayTeamId: item.awayTeamId },
    ]),
  );
  for (const fixture of [...board.knockout.fixtures].sort(
    (a, b) => a.matchNumber - b.matchNumber,
  )) {
    if (participants.has(fixture.matchNumber)) continue;
    const homeTeamId = sourceParticipant(fixture.homeSource, participants, draft);
    const awayTeamId = sourceParticipant(fixture.awaySource, participants, draft);
    if (homeTeamId && awayTeamId) participants.set(fixture.matchNumber, { homeTeamId, awayTeamId });
  }
  return participants;
}

function KnockoutMatchCard({
  fixture,
  teams,
  participants,
  value,
  open,
  onChangeScore,
  onChoose,
}: {
  fixture: KnockoutFixture;
  teams: Map<string, Team>;
  participants?: { homeTeamId: string | null; awayTeamId: string | null };
  value: KnockoutDraft[number];
  open: boolean;
  onChangeScore: (side: 'home' | 'away', value: string) => void;
  onChoose: (teamId: string) => void;
}) {
  const homeTeam = participants?.homeTeamId ? teams.get(participants.homeTeamId) : null;
  const awayTeam = participants?.awayTeamId ? teams.get(participants.awayTeamId) : null;
  const matchupReady = Boolean(participants?.homeTeamId && participants.awayTeamId);
  const tied = value.home !== '' && value.home === value.away;
  return (
    <View style={styles.knockoutCard}>
      <View style={styles.knockoutCardHeader}>
        <Text style={styles.knockoutMatchNumber}>Jogo {fixture.matchNumber}</Text>
        <Text style={styles.knockoutDate}>{compactDateTime(fixture.startsAt)}</Text>
      </View>
      {[
        { team: homeTeam, side: 'home' as const },
        { team: awayTeam, side: 'away' as const },
      ].map(({ team, side }) => {
        const teamId = side === 'home' ? participants?.homeTeamId : participants?.awayTeamId;
        const selected = teamId && value.advancingTeamId === teamId;
        return (
          <Pressable
            key={side}
            disabled={!open || !matchupReady || !teamId || !tied}
            onPress={() => teamId && onChoose(teamId)}
            style={[styles.knockoutTeamRow, selected && styles.knockoutTeamSelected]}
          >
            <TeamLabel team={team} dense />
            <View style={styles.knockoutScoreArea}>
              <TextInput
                editable={open && matchupReady}
                keyboardType="number-pad"
                maxLength={2}
                value={side === 'home' ? value.home : value.away}
                onChangeText={(text) => onChangeScore(side, text.replace(/\D/g, ''))}
                style={styles.knockoutScoreInput}
              />
              <View style={styles.knockoutAdvanceMarker}>
                {tied && selected ? (
                  <Ionicons name="checkmark-circle" size={10} color={palette.greenDark} />
                ) : null}
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function PublicBracketsModal({
  visible,
  brackets,
  loading,
  onClose,
}: {
  visible: boolean;
  brackets: PublicKnockoutBracket[];
  loading: boolean;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (visible && brackets.length) setSelectedId((current) => current ?? brackets[0].id);
    if (!visible) setSelectedId(null);
  }, [brackets, visible]);
  const selected = brackets.find((bracket) => bracket.id === selectedId) ?? null;
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.bracketsModal}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Chaves dos participantes</Text>
              <Text style={styles.modalSubtitle}>Palpites publicados após o fechamento.</Text>
            </View>
            <Pressable style={styles.iconButton} onPress={onClose} accessibilityLabel="Fechar">
              <Ionicons name="close" size={22} color={palette.white} />
            </Pressable>
          </View>
          {loading ? (
            <ActivityIndicator color={palette.yellow} style={{ margin: 40 }} />
          ) : (
            <View style={styles.bracketsModalBody}>
              <ScrollView horizontal contentContainerStyle={styles.bracketUserTabs}>
                {brackets.map((bracket) => (
                  <Pressable
                    key={bracket.id}
                    onPress={() => setSelectedId(bracket.id)}
                    style={[
                      styles.bracketUserTab,
                      bracket.id === selectedId && styles.bracketUserTabActive,
                    ]}
                  >
                    <Text style={styles.bracketUserTabText}>{bracket.user.nickname}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <ScrollView contentContainerStyle={styles.publicBracketPicks}>
                {selected?.picks.map((pick) => (
                  <View key={pick.id} style={styles.publicBracketPick}>
                    <Text style={styles.knockoutMatchNumber}>Jogo {pick.fixture.matchNumber}</Text>
                    <Text style={styles.publicBracketTeams} numberOfLines={1}>
                      {pick.homeTeam.name} {pick.predictedHomeScore} x {pick.predictedAwayScore}{' '}
                      {pick.awayTeam.name}
                    </Text>
                    <Text style={styles.publicBracketWinner}>
                      Avanca: {pick.advancingTeam.name}
                    </Text>
                  </View>
                )) ?? <Text style={styles.modalSubtitle}>Nenhuma chave publicada.</Text>}
              </ScrollView>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function KnockoutBoard({
  board,
  onSaved,
}: {
  board: PredictionBoard;
  onSaved: (next: PredictionBoard) => void;
}) {
  const { width } = useWindowDimensions();
  const bracketScrollRef = useRef<ScrollView>(null);
  const draftKey = `bolao-knockout-draft-v1:${board.knockout.generation.id}`;
  const [draft, setDraft] = useState<KnockoutDraft>(() => {
    const saved = board.knockout.savedBracket?.picks ?? [];
    if (saved.length) {
      return Object.fromEntries(
        saved.map((pick) => [
          pick.matchNumber,
          {
            home: String(pick.predictedHomeScore),
            away: String(pick.predictedAwayScore),
            advancingTeamId: pick.advancingTeamId,
          },
        ]),
      );
    }
    if (typeof window !== 'undefined') {
      try {
        return JSON.parse(window.localStorage.getItem(draftKey) ?? '{}') as KnockoutDraft;
      } catch {
        return {};
      }
    }
    return {};
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [publicVisible, setPublicVisible] = useState(false);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicBrackets, setPublicBrackets] = useState<PublicKnockoutBracket[]>([]);
  const [activeStage, setActiveStage] = useState<KnockoutFixture['stage']>('ROUND_OF_32');
  const teams = useMemo(
    () =>
      new Map(
        board.groups.flatMap((group) =>
          group.standings.map((row) => [row.team.id, row.team] as const),
        ),
      ),
    [board.groups],
  );
  const participants = useMemo(() => materializeClientParticipants(board, draft), [board, draft]);
  const classifiedSlots = useMemo(
    () =>
      board.knockout.roundOf32.reduce(
        (total, matchup) =>
          total + Number(Boolean(matchup.homeTeamId)) + Number(Boolean(matchup.awayTeamId)),
        0,
      ),
    [board.knockout.roundOf32],
  );
  const canEdit = board.canPredict && board.knockout.generation.isOpen;

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(draftKey, JSON.stringify(draft));
  }, [draft, draftKey]);

  function changeScore(matchNumber: number, side: 'home' | 'away', text: string) {
    setDraft((current) => {
      const next = { ...current };
      const value = {
        home: '',
        away: '',
        advancingTeamId: null,
        ...next[matchNumber],
        [side]: text,
      };
      const matchParticipants = participants.get(matchNumber);
      if (
        matchParticipants?.homeTeamId &&
        matchParticipants.awayTeamId &&
        value.home !== '' &&
        value.away !== '' &&
        value.home !== value.away
      ) {
        value.advancingTeamId =
          Number(value.home) > Number(value.away)
            ? matchParticipants.homeTeamId
            : matchParticipants.awayTeamId;
      } else if (value.home === value.away) {
        value.advancingTeamId = null;
      }
      next[matchNumber] = value;
      for (const fixture of board.knockout.fixtures.filter(
        (item) => item.matchNumber > matchNumber,
      )) {
        if (next[fixture.matchNumber])
          next[fixture.matchNumber] = { home: '', away: '', advancingTeamId: null };
      }
      return next;
    });
  }

  const complete = board.knockout.fixtures.every((fixture) => {
    const value = draft[fixture.matchNumber];
    const matchup = participants.get(fixture.matchNumber);
    return Boolean(
      matchup?.homeTeamId &&
      matchup.awayTeamId &&
      value &&
      value.home !== '' &&
      value.away !== '' &&
      value.advancingTeamId,
    );
  });

  async function save() {
    setSaving(true);
    setError('');
    try {
      const next = await api.saveKnockoutBracket(
        board.knockout.fixtures.map((fixture) => ({
          matchNumber: fixture.matchNumber,
          predictedHomeScore: Number(draft[fixture.matchNumber].home),
          predictedAwayScore: Number(draft[fixture.matchNumber].away),
          advancingTeamId: draft[fixture.matchNumber].advancingTeamId!,
        })),
      );
      if (typeof window !== 'undefined') window.localStorage.removeItem(draftKey);
      onSaved(next);
      setSuccess(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar a chave.');
    } finally {
      setSaving(false);
    }
  }

  async function openPublicBrackets() {
    setPublicVisible(true);
    setPublicLoading(true);
    setError('');
    try {
      const result = await api.publicKnockoutBrackets();
      setPublicBrackets(result.brackets);
    } catch (caught) {
      setPublicVisible(false);
      setError(caught instanceof Error ? caught.message : 'Não foi possível abrir as chaves.');
    } finally {
      setPublicLoading(false);
    }
  }

  const fixturesByNumber = useMemo(
    () => new Map(board.knockout.fixtures.map((fixture) => [fixture.matchNumber, fixture])),
    [board.knockout.fixtures],
  );

  function focusStage(stage: KnockoutFixture['stage']) {
    const stageCenters: Record<KnockoutFixture['stage'], number> = {
      ROUND_OF_32: 4 + BRACKET_CARD_WIDTH / 2,
      ROUND_OF_16: 148 + BRACKET_CARD_WIDTH / 2,
      QUARTER_FINAL: 292 + BRACKET_CARD_WIDTH / 2,
      SEMI_FINAL: 436 + BRACKET_CARD_WIDTH / 2,
      THIRD_PLACE: 580 + BRACKET_CARD_WIDTH / 2,
      FINAL: 580 + BRACKET_CARD_WIDTH / 2,
    };
    const visibleWidth = Math.max(320, width - 70);
    setActiveStage(stage);
    bracketScrollRef.current?.scrollTo({
      x: Math.max(0, stageCenters[stage] - visibleWidth / 2),
      animated: true,
    });
  }

  return (
    <View style={styles.knockoutSection}>
      <View style={styles.knockoutHeading}>
        <View style={styles.knockoutInfoCard}>
          <Ionicons name="information-circle-outline" size={22} color="#b88700" />
          <Text style={styles.knockoutInfoText}>
            {board.knockout.generation.mode === 'PROVISIONAL'
              ? 'Simulação baseada nos seus palpites da fase de grupos. Os confrontos podem mudar com os resultados reais.'
              : 'Chave oficial formada pelos classificados da fase de grupos.'}
          </Text>
          <View style={styles.qualifierProgress}>
            <Text style={styles.qualifierProgressValue}>{classifiedSlots}/32</Text>
            <Text style={styles.qualifierProgressLabel}>vagas definidas</Text>
          </View>
        </View>
        <View style={styles.knockoutDeadlineCard}>
          <Ionicons name="time-outline" size={22} color={palette.greenDark} />
          <View style={styles.knockoutDeadlineCopy}>
            <Text style={styles.knockoutDeadlineTitle}>
              {canEdit ? 'Chave aberta para edição' : 'Chave fechada'}
            </Text>
            <Text style={styles.knockoutDeadlineText}>
              {board.knockout.generation.closesAt
                ? `Fecha em ${dateTime(board.knockout.generation.closesAt)}`
                : 'O prazo será definido ao fim da fase de grupos.'}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.bracketPanel}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.bracketStageTabs}
        >
          {bracketStageOrder.map((stage) => (
            <Pressable
              key={stage}
              onPress={() => focusStage(stage)}
              style={[
                styles.bracketStageTab,
                activeStage === stage && styles.bracketStageTabActive,
              ]}
            >
              <Text
                style={[
                  styles.bracketStageTabText,
                  activeStage === stage && styles.bracketStageTabTextActive,
                ]}
              >
                {stageLabels[stage]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.bracketHint}>
          <Ionicons name="checkmark-circle-outline" size={16} color={palette.greenDark} />
          <Text style={styles.bracketHintText}>
            {board.knockout.resolvedGroups.length
              ? `Grupos projetados: ${board.knockout.resolvedGroups.join(', ')}. Em empate, toque na seleção que avança.`
              : 'As seleções aparecerão conforme os grupos forem definidos por resultados e palpites.'}
          </Text>
        </View>
        <ScrollView
          ref={bracketScrollRef}
          horizontal
          showsHorizontalScrollIndicator={width < 1320}
          contentContainerStyle={styles.bracketViewportContent}
        >
          <View style={[styles.bracketCanvas, width < 760 && styles.bracketCanvasMobile]}>
            {bracketPairs.map((connector) => (
              <BracketPairConnector
                key={`${connector.sources[0]}-${connector.target}`}
                sources={connector.sources}
                target={connector.target}
                side={connector.side}
              />
            ))}
            <BracketFinalConnector from={101} side="right" />
            <BracketFinalConnector from={102} side="left" />

            {[
              { stage: 'ROUND_OF_32' as const, x: 4 },
              { stage: 'ROUND_OF_16' as const, x: 148 },
              { stage: 'QUARTER_FINAL' as const, x: 292 },
              { stage: 'SEMI_FINAL' as const, x: 436 },
              { stage: 'SEMI_FINAL' as const, x: 724 },
              { stage: 'QUARTER_FINAL' as const, x: 868 },
              { stage: 'ROUND_OF_16' as const, x: 1012 },
              { stage: 'ROUND_OF_32' as const, x: 1156 },
            ].map(({ stage, x }, index) => (
              <View key={`${stage}-${index}`} style={[styles.bracketColumnLabel, { left: x }]}>
                <Text style={styles.bracketColumnTitle}>{stageLabels[stage]}</Text>
                <Text style={styles.bracketColumnRange}>{bracketStageRanges[stage]}</Text>
              </View>
            ))}

            <View style={styles.bracketTrophy}>
              <View style={styles.bracketTrophyIcon}>
                <Ionicons name="trophy" size={24} color="#d9aa00" />
              </View>
              <Text style={styles.bracketTrophyTitle}>Final</Text>
              <Text style={styles.bracketTrophyDate}>{bracketStageRanges.FINAL}</Text>
            </View>
            <View style={styles.thirdPlaceLabel}>
              <Text style={styles.bracketColumnTitle}>Terceiro lugar</Text>
              <Text style={styles.bracketColumnRange}>{bracketStageRanges.THIRD_PLACE}</Text>
            </View>

            {board.knockout.fixtures.map((fixture) => {
              const position = bracketPositions.get(fixture.matchNumber);
              if (!position || !fixturesByNumber.has(fixture.matchNumber)) return null;
              return (
                <View
                  key={fixture.id}
                  style={[styles.knockoutCardPosition, { left: position.x, top: position.y }]}
                >
                  <KnockoutMatchCard
                    fixture={fixture}
                    teams={teams}
                    participants={participants.get(fixture.matchNumber)}
                    value={
                      draft[fixture.matchNumber] ?? { home: '', away: '', advancingTeamId: null }
                    }
                    open={canEdit}
                    onChangeScore={(side, value) => changeScore(fixture.matchNumber, side, value)}
                    onChoose={(teamId) =>
                      setDraft((current) => ({
                        ...current,
                        [fixture.matchNumber]: {
                          home: '',
                          away: '',
                          ...current[fixture.matchNumber],
                          advancingTeamId: teamId,
                        },
                      }))
                    }
                  />
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {board.knockout.generation.mode === 'OFFICIAL' && !board.knockout.generation.isOpen ? (
        <View style={styles.publicBracketAction}>
          <Pressable style={styles.publicBracketButton} onPress={openPublicBrackets}>
            <Ionicons name="people-outline" size={17} color={palette.white} />
            <Text style={styles.publicBracketButtonText}>Ver chaves dos participantes</Text>
          </Pressable>
        </View>
      ) : null}
      {canEdit && board.knockout.roundOf32.length ? (
        <View style={styles.knockoutFooter}>
          <Text style={styles.knockoutFooterText}>
            {complete
              ? 'Todos os 32 confrontos estão preenchidos.'
              : 'Preencha e propague toda a chave para liberar o envio.'}
          </Text>
          <Pressable
            disabled={!complete || saving}
            onPress={save}
            style={[styles.submitBracket, (!complete || saving) && styles.disabled]}
          >
            <Ionicons name="cloud-upload-outline" size={18} color={palette.shell} />
            <Text style={styles.submitBracketText}>
              {saving ? 'Salvando...' : 'Salvar chave completa'}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <SuccessModal
        visible={success}
        message="Sua chave completa foi salva em uma única operação."
        onClose={() => setSuccess(false)}
      />
      <PublicBracketsModal
        visible={publicVisible}
        brackets={publicBrackets}
        loading={publicLoading}
        onClose={() => setPublicVisible(false)}
      />
    </View>
  );
}

export function PredictionBoardScreen({
  currentUserId,
  refreshVersion,
}: {
  currentUserId: string;
  refreshVersion: number;
}) {
  const { width } = useWindowDimensions();
  const [view, setView] = useState<'groups' | 'knockout'>('groups');
  const [board, setBoard] = useState<PredictionBoard | null>(null);
  const [draft, setDraft] = useState<ScoreDraft>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingMatchId, setSavingMatchId] = useState<string | null>(null);
  const [publicMatch, setPublicMatch] = useState<PredictionBoardMatch | null>(null);
  const [success, setSuccess] = useState(false);

  const applyBoard = useCallback((next: PredictionBoard) => {
    setBoard(next);
    setDraft((current) => {
      const values = { ...current };
      for (const match of next.groups.flatMap((group) => group.matches)) {
        if (values[match.id]) continue;
        values[match.id] = {
          home: match.ownPrediction ? String(match.ownPrediction.predictedHomeScore) : '',
          away: match.ownPrediction ? String(match.ownPrediction.predictedAwayScore) : '',
        };
      }
      return values;
    });
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        applyBoard(await api.predictionBoard());
        setError('');
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Erro ao carregar palpites.');
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [applyBoard],
  );

  useEffect(() => {
    void load();
    const events = createPredictionBoardEvents(() => void load(true));
    const refreshTimer = setInterval(() => void load(true), 30_000);
    return () => {
      events.close();
      clearInterval(refreshTimer);
    };
  }, [load, refreshVersion]);

  async function saveMatch(match: PredictionBoardMatch) {
    const value = draft[match.id];
    if (!value || value.home === '' || value.away === '') return;
    setSavingMatchId(match.id);
    setError('');
    try {
      await api.savePredictions(match.matchDayId, [
        {
          matchId: match.id,
          predictedHomeScore: Number(value.home),
          predictedAwayScore: Number(value.away),
        },
      ]);
      await load(true);
      setSuccess(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar o palpite.');
    } finally {
      setSavingMatchId(null);
    }
  }

  if (loading) return <ActivityIndicator color={palette.green} style={{ marginTop: 60 }} />;
  if (!board)
    return <Text style={styles.error}>{error || 'Quadro de palpites indisponível.'}</Text>;

  return (
    <View style={styles.screen}>
      <View style={styles.boardHeader}>
        <View style={[styles.boardHeaderCopy, width < 760 && styles.boardHeaderCopyMobile]}>
          <Text style={styles.screenTitle}>
            {view === 'knockout'
              ? 'Eliminatórias'
              : competitionUiV2
                ? 'Palpites'
                : 'Palpites da Copa'}
          </Text>
          <Text style={styles.screenSubtitle}>
            {view === 'knockout'
              ? 'Monte todos os confrontos e salve a chave completa em uma única operação.'
              : competitionUiV2
                ? 'Agenda compacta para preencher os placares de cada dia.'
                : 'Placares e classificação projetada da fase de grupos.'}
          </Text>
        </View>
        <View style={[styles.phaseTabs, width < 760 && styles.phaseTabsMobile]}>
          <Pressable
            onPress={() => setView('groups')}
            style={[styles.phaseTab, view === 'groups' && styles.phaseTabActive]}
          >
            <Ionicons
              name="grid-outline"
              size={17}
              color={view === 'groups' ? palette.shell : palette.white}
            />
            <Text style={[styles.phaseTabText, view === 'groups' && styles.phaseTabTextActive]}>
              {competitionUiV2 ? 'Jogos por dia' : 'Fase de grupos'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setView('knockout')}
            style={[styles.phaseTab, view === 'knockout' && styles.phaseTabActive]}
          >
            <Ionicons
              name="git-network-outline"
              size={17}
              color={view === 'knockout' ? palette.shell : palette.white}
            />
            <Text style={[styles.phaseTabText, view === 'knockout' && styles.phaseTabTextActive]}>
              Eliminatórias
            </Text>
          </Pressable>
        </View>
      </View>

      {view === 'groups' && !competitionUiV2 ? (
        <View style={styles.rulesBar}>
          <View style={styles.deadlineRule}>
            <Ionicons name="time-outline" size={18} color={palette.yellow} />
            <Text style={styles.deadlineRuleText}>
              Cada partida fecha {board.predictionCloseMinutes} minutos antes do início.
            </Text>
          </View>
          {[
            ['7', 'placar exato'],
            ['3', 'resultado'],
            ['1', 'gols de um time'],
            ['0', 'erro'],
          ].map(([points, label]) => (
            <View key={points} style={styles.ruleCompact}>
              <Text style={styles.ruleCompactPoints}>{points}</Text>
              <Text style={styles.ruleCompactLabel}>{label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <SoftReveal key={view}>
        {view === 'groups' ? (
          competitionUiV2 ? (
            <DailyPredictionsV2 currentUserId={currentUserId} refreshVersion={refreshVersion} />
          ) : (
            <View style={[styles.groupsGrid, width < 760 && styles.groupsGridMobile]}>
              {board.groups.map((group) => (
                <GroupModule
                  key={group.group}
                  group={group}
                  draft={draft}
                  canPredict={board.canPredict}
                  savingMatchId={savingMatchId}
                  onChange={(matchId, side, value) =>
                    setDraft((current) => ({
                      ...current,
                      [matchId]: { home: '', away: '', ...current[matchId], [side]: value },
                    }))
                  }
                  onSave={saveMatch}
                  onOpenPublic={setPublicMatch}
                />
              ))}
            </View>
          )
        ) : (
          <KnockoutBoard key={board.knockout.generation.id} board={board} onSaved={applyBoard} />
        )}
      </SoftReveal>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PublicPredictionsModal
        match={publicMatch}
        currentUserId={currentUserId}
        onClose={() => setPublicMatch(null)}
      />
      <SuccessModal
        visible={success}
        message="Seu palpite foi salvo e a tabela do grupo foi atualizada."
        onClose={() => setSuccess(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: 16 },
  boardHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 14,
  },
  boardHeaderCopy: { flex: 1, minWidth: 0 },
  boardHeaderCopyMobile: { flexBasis: '100%', width: '100%' },
  screenTitle: { color: palette.white, fontSize: 26, fontWeight: '900' },
  screenSubtitle: { maxWidth: 680, color: '#a8bbb3', fontSize: 14, lineHeight: 20, marginTop: 3 },
  phaseTabs: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 8,
    backgroundColor: palette.shellSoft,
    borderWidth: 1,
    borderColor: '#315447',
  },
  phaseTabsMobile: { alignSelf: 'flex-start' },
  phaseTab: {
    minHeight: 40,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 6,
  },
  phaseTabActive: { backgroundColor: palette.yellow },
  phaseTabText: { color: palette.white, fontSize: 13, fontWeight: '800' },
  phaseTabTextActive: { color: palette.shell },
  rulesBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#315447',
  },
  deadlineRule: { flexDirection: 'row', alignItems: 'center', gap: 7, marginRight: 6 },
  deadlineRuleText: { color: palette.white, fontSize: 13, fontWeight: '800' },
  ruleCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    minHeight: 30,
    borderRadius: 6,
    backgroundColor: palette.shellSoft,
  },
  ruleCompactPoints: { color: palette.yellow, fontSize: 14, fontWeight: '900' },
  ruleCompactLabel: { color: '#c8d6d0', fontSize: 12, fontWeight: '700' },
  groupsGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 },
  groupsGridMobile: { gap: 10 },
  groupModule: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 360,
    minWidth: 320,
    maxWidth: 560,
    backgroundColor: palette.paper,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#cbd8d1',
  },
  groupHeader: {
    minHeight: 48,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.greenDark,
  },
  groupTitle: { color: palette.white, fontSize: 17, fontWeight: '900' },
  groupProgress: { color: '#d9eee4', fontSize: 11, fontWeight: '800' },
  groupMatches: { padding: 9, gap: 7 },
  groupMatchRow: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 6,
    padding: 8,
    gap: 7,
    backgroundColor: palette.paper,
  },
  groupMatchLive: { borderColor: palette.red, backgroundColor: '#fff7f6' },
  matchMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  matchTime: { color: palette.greenDark, fontSize: 12, fontWeight: '900' },
  matchState: {
    color: palette.muted,
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'right',
    flexShrink: 1,
  },
  matchTeamsAndScore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  matchTeams: { flex: 1, minWidth: 0, gap: 6 },
  teamLabel: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  teamLabelDense: { gap: 3 },
  teamName: { flexShrink: 1, color: palette.ink, fontSize: 14, fontWeight: '800' },
  teamNameCompact: { flexShrink: 1, color: palette.ink, fontSize: 12, fontWeight: '800' },
  teamNameDense: { flexShrink: 1, color: palette.ink, fontSize: 9, fontWeight: '900' },
  teamNameLight: { color: palette.white },
  flag: { borderRadius: 2, borderWidth: 1, borderColor: '#c7d1cc' },
  flagFallback: {
    borderRadius: 2,
    backgroundColor: '#dbe4df',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagFallbackText: { color: palette.ink, fontSize: 8, fontWeight: '900' },
  compactScoreInputs: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  compactScoreInput: {
    width: 36,
    height: 34,
    padding: 0,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#afbeb6',
    color: palette.ink,
    backgroundColor: palette.paperSoft,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '900',
    outlineStyle: 'none' as never,
  },
  compactScoreLocked: { backgroundColor: '#e1e8e4', color: palette.greenDark },
  scoreSeparator: { color: palette.muted, fontSize: 12, fontWeight: '900' },
  matchActions: { minHeight: 26, flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
  saveMatchButton: {
    minHeight: 28,
    paddingHorizontal: 9,
    borderRadius: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.green,
  },
  saveMatchText: { color: palette.white, fontSize: 11, fontWeight: '900' },
  publicButton: {
    minHeight: 28,
    paddingHorizontal: 8,
    borderRadius: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e4f1ea',
    borderWidth: 1,
    borderColor: '#b9d6c6',
  },
  publicButtonText: { color: palette.greenDark, fontSize: 11, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  standingsTable: { borderTopWidth: 1, borderTopColor: palette.line },
  standingsRow: {
    minHeight: 33,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e8eeeb',
    paddingHorizontal: 7,
  },
  standingsHeader: { minHeight: 28, backgroundColor: palette.paperSoft },
  standingCell: { color: palette.ink, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  positionCell: { width: 24 },
  standingTeamCell: { flex: 1, minWidth: 120 },
  statCell: { width: 28 },
  qualified: { color: palette.green, fontSize: 12, fontWeight: '900' },
  points: { color: palette.greenDark, fontWeight: '900' },
  knockoutSection: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f7f9f8',
    borderWidth: 1,
    borderColor: '#d8e0dc',
  },
  knockoutHeading: {
    padding: 9,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    justifyContent: 'flex-end',
    gap: 8,
    backgroundColor: palette.paper,
  },
  knockoutInfoCard: {
    flex: 1,
    minWidth: 300,
    maxWidth: 760,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#e7c85c',
    borderRadius: 7,
    backgroundColor: '#fffdf2',
  },
  knockoutInfoText: { flex: 1, color: '#34423c', fontSize: 11, lineHeight: 15, fontWeight: '700' },
  qualifierProgress: {
    minWidth: 70,
    alignItems: 'center',
    paddingLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: '#eadb9d',
  },
  qualifierProgressValue: { color: palette.greenDark, fontSize: 15, fontWeight: '900' },
  qualifierProgressLabel: { color: palette.muted, fontSize: 8, fontWeight: '800' },
  knockoutDeadlineCard: {
    minWidth: 250,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#d5dfda',
    borderRadius: 7,
    backgroundColor: palette.paper,
  },
  knockoutDeadlineCopy: { flex: 1, gap: 2 },
  knockoutDeadlineTitle: { color: palette.ink, fontSize: 12, fontWeight: '900' },
  knockoutDeadlineText: { color: palette.greenDark, fontSize: 11, fontWeight: '700' },
  knockoutSubtitle: { color: palette.muted, fontSize: 13, lineHeight: 19 },
  knockoutEmpty: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: palette.paper,
  },
  bracketPanel: {
    margin: 9,
    borderWidth: 1,
    borderColor: '#d9e0dd',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: palette.paper,
  },
  bracketStageTabs: { minWidth: '100%', padding: 7, gap: 0 },
  bracketStageTab: {
    minWidth: 130,
    minHeight: 32,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#d8e0dc',
    marginRight: -1,
    backgroundColor: palette.paper,
  },
  bracketStageTabActive: {
    zIndex: 1,
    borderColor: palette.green,
    backgroundColor: palette.greenDark,
  },
  bracketStageTabText: { color: '#34423c', fontSize: 10, fontWeight: '800' },
  bracketStageTabTextActive: { color: palette.white },
  bracketHint: {
    minHeight: 24,
    paddingHorizontal: 10,
    paddingBottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  bracketHintText: { flexShrink: 1, color: palette.muted, fontSize: 9, fontWeight: '700' },
  bracketViewportContent: { minWidth: '100%', justifyContent: 'center' },
  bracketCanvas: {
    position: 'relative',
    width: BRACKET_CANVAS_WIDTH,
    height: BRACKET_CANVAS_HEIGHT,
    backgroundColor: '#fbfcfb',
  },
  bracketCanvasMobile: { backgroundColor: palette.paper },
  bracketColumnLabel: {
    position: 'absolute',
    top: 4,
    width: BRACKET_CARD_WIDTH,
    alignItems: 'center',
    gap: 1,
  },
  bracketColumnTitle: {
    color: '#27352f',
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  bracketColumnRange: { color: palette.muted, fontSize: 7, fontWeight: '700' },
  bracketTrophy: {
    position: 'absolute',
    left: 580,
    top: 96,
    width: BRACKET_CARD_WIDTH,
    alignItems: 'center',
    gap: 2,
  },
  bracketTrophyIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff9dc',
    borderWidth: 1,
    borderColor: '#ead379',
  },
  bracketTrophyTitle: {
    color: palette.greenDark,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  bracketTrophyDate: { color: palette.green, fontSize: 8, fontWeight: '800' },
  thirdPlaceLabel: {
    position: 'absolute',
    left: 580,
    top: 366,
    width: BRACKET_CARD_WIDTH,
    alignItems: 'center',
    gap: 1,
  },
  bracketConnectorHorizontal: {
    position: 'absolute',
    height: 2,
    zIndex: 0,
    backgroundColor: '#2b825b',
  },
  bracketConnectorVertical: {
    position: 'absolute',
    width: 2,
    zIndex: 0,
    backgroundColor: '#2b825b',
  },
  knockoutCardPosition: {
    position: 'absolute',
    width: BRACKET_CARD_WIDTH,
    height: BRACKET_CARD_HEIGHT,
    zIndex: 2,
  },
  knockoutCard: {
    width: '100%',
    height: '100%',
    borderWidth: 1,
    borderColor: '#d4ddd8',
    borderRadius: 5,
    padding: 3,
    backgroundColor: palette.paper,
    gap: 2,
    shadowColor: '#132b21',
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  knockoutCardHeader: {
    height: 9,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 3,
  },
  knockoutMatchNumber: { color: palette.greenDark, fontSize: 7, fontWeight: '900' },
  knockoutDate: { color: palette.muted, fontSize: 6.5, fontWeight: '700' },
  knockoutTeamRow: {
    height: 16,
    borderRadius: 3,
    paddingLeft: 3,
    paddingRight: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
    backgroundColor: '#f3f7f5',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  knockoutTeamSelected: { borderColor: palette.green, backgroundColor: '#eaf6f0' },
  knockoutScoreArea: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  knockoutScoreInput: {
    width: 22,
    height: 15,
    padding: 0,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#cbd6d0',
    backgroundColor: palette.paper,
    color: palette.ink,
    textAlign: 'center',
    fontSize: 9,
    fontWeight: '900',
    outlineStyle: 'none' as never,
  },
  knockoutAdvanceMarker: { width: 10, height: 15, alignItems: 'center', justifyContent: 'center' },
  knockoutFooter: {
    padding: 9,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#d8e0dc',
    backgroundColor: palette.paper,
  },
  knockoutFooterText: {
    flex: 1,
    minWidth: 240,
    color: palette.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  submitBracket: {
    minHeight: 42,
    paddingHorizontal: 15,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: palette.yellow,
  },
  submitBracketText: { color: palette.shell, fontSize: 13, fontWeight: '900' },
  error: { color: '#ff9d94', fontSize: 13, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2, 9, 7, 0.82)',
  },
  publicModal: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '78%',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: palette.shellSoft,
    borderWidth: 1,
    borderColor: palette.bracketBorder,
  },
  bracketsModal: {
    width: '100%',
    maxWidth: 920,
    height: '82%',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: palette.shellSoft,
    borderWidth: 1,
    borderColor: palette.bracketBorder,
  },
  bracketsModalBody: { flex: 1 },
  modalHeader: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.bracketBorder,
  },
  modalTitle: { color: palette.white, fontSize: 18, fontWeight: '900' },
  modalSubtitle: { color: '#a8bbb3', fontSize: 13, marginTop: 2 },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bracketCard,
  },
  publicList: { flexGrow: 0 },
  publicListContent: { padding: 12, gap: 8 },
  publicPredictionRow: {
    minHeight: 46,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 6,
    backgroundColor: palette.bracketCard,
    borderWidth: 1,
    borderColor: palette.bracketBorder,
  },
  publicPredictionMine: { borderColor: palette.green },
  publicPredictionName: { flex: 1, color: palette.white, fontSize: 13, fontWeight: '800' },
  publicPredictionScore: { color: palette.yellow, fontSize: 16, fontWeight: '900' },
  bracketUserTabs: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  bracketUserTab: {
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bracketCard,
    borderWidth: 1,
    borderColor: palette.bracketBorder,
  },
  bracketUserTabActive: { borderColor: palette.yellow },
  bracketUserTabText: { color: palette.white, fontSize: 12, fontWeight: '800' },
  publicBracketPicks: { padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  publicBracketPick: {
    width: 200,
    minHeight: 82,
    padding: 9,
    borderRadius: 6,
    backgroundColor: palette.bracketCard,
    borderWidth: 1,
    borderColor: palette.bracketBorder,
    gap: 4,
  },
  publicBracketTeams: { color: palette.white, fontSize: 12, fontWeight: '800' },
  publicBracketWinner: { color: palette.yellow, fontSize: 10, fontWeight: '800' },
  publicBracketAction: { paddingHorizontal: 14, paddingBottom: 14, alignItems: 'flex-end' },
  publicBracketButton: {
    minHeight: 40,
    paddingHorizontal: 13,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: palette.green,
  },
  publicBracketButtonText: { color: palette.white, fontSize: 12, fontWeight: '900' },
  successModal: {
    width: '100%',
    maxWidth: 400,
    padding: 22,
    borderRadius: 8,
    alignItems: 'center',
    gap: 13,
    backgroundColor: palette.shellSoft,
    borderWidth: 1,
    borderColor: palette.bracketBorder,
  },
  successMark: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.green,
    borderWidth: 2,
    borderColor: palette.yellow,
  },
  successTitle: { color: palette.white, fontSize: 22, fontWeight: '900' },
  successMessage: { color: '#a8bbb3', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  primaryButton: {
    minWidth: 120,
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.green,
  },
  primaryButtonText: { color: palette.white, fontSize: 14, fontWeight: '900' },
});
