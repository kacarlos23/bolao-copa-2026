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
import { SoftReveal, usePrefersReducedMotion } from './motion';
import { ScoreInput } from './components/ScoreInput';
import { draftStorageKey } from './services/drafts';

const competitionUiV2 = process.env.EXPO_PUBLIC_COMPETITION_UI_V2 === '1';

const palette = {
  shell: '#00143a',
  shellSoft: 'rgba(2, 30, 76, 0.78)',
  bracket: 'rgba(1, 18, 55, 0.88)',
  bracketCard: 'rgba(2, 31, 78, 0.82)',
  bracketBorder: 'rgba(98, 144, 210, 0.42)',
  paper: 'rgba(2, 30, 76, 0.78)',
  paperSoft: 'rgba(2, 44, 96, 0.82)',
  ink: '#f8fbff',
  muted: '#b8c6dd',
  line: 'rgba(98, 144, 210, 0.42)',
  green: '#21d66f',
  greenDark: '#008a4f',
  yellow: '#ffd315',
  red: '#ff6b59',
  white: '#f7fbf8',
};

type ScoreDraft = Record<string, { home: string; away: string }>;
type KnockoutDraft = Record<number, { home: string; away: string; advancingTeamId: string | null }>;
type FilledKnockoutPick = {
  fixture: KnockoutFixture;
  matchNumber: number;
  homeTeamId: string;
  awayTeamId: string;
  predictedHomeScore: number;
  predictedAwayScore: number;
  advancingTeamId: string;
};

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
  const reducedMotion = usePrefersReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return progress.setValue(0);
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

function SimulationMatchRow({
  match,
  draft,
  canEdit,
  onChange,
}: {
  match: PredictionBoardMatch;
  draft: ScoreDraft;
  canEdit: boolean;
  onChange: (matchId: string, side: 'home' | 'away', value: string) => void;
}) {
  const value = draft[match.id] ?? { home: '', away: '' };
  const lockedByReality = match.status === 'LIVE' || match.status === 'FINISHED';
  const locked = lockedByReality || !canEdit;
  const official = scoreForMatch(match, draft);
  const displayHome = lockedByReality ? String(official?.home ?? '-') : value.home;
  const displayAway = lockedByReality ? String(official?.away ?? '-') : value.away;

  return (
    <View style={[styles.simMatchRow, locked && styles.simMatchLocked]}>
      <View style={styles.simMatchTeams}>
        <TeamLabel team={match.homeTeam} compact tone="light" />
        <TeamLabel team={match.awayTeam} compact tone="light" />
      </View>
      <View style={styles.compactScoreInputs}>
        <TextInput
          editable={!locked}
          keyboardType="number-pad"
          maxLength={2}
          value={displayHome}
          onChangeText={(text) => onChange(match.id, 'home', text.replace(/\D/g, ''))}
          style={[
            styles.compactScoreInput,
            styles.simScoreInput,
            locked && styles.simScoreLocked,
          ]}
        />
        <Text style={styles.scoreSeparator}>x</Text>
        <TextInput
          editable={!locked}
          keyboardType="number-pad"
          maxLength={2}
          value={displayAway}
          onChangeText={(text) => onChange(match.id, 'away', text.replace(/\D/g, ''))}
          style={[
            styles.compactScoreInput,
            styles.simScoreInput,
            locked && styles.simScoreLocked,
          ]}
        />
      </View>
      <Text style={styles.simMatchState}>
        {lockedByReality
          ? match.status === 'LIVE'
            ? 'Ao vivo'
            : 'Real'
          : !canEdit
            ? 'Fechado'
            : shortTime(match.startsAt)}
      </Text>
    </View>
  );
}

function GroupSimulationPanel({
  groups,
  draft,
  canEdit,
  onChange,
}: {
  groups: PredictionBoardGroup[];
  draft: ScoreDraft;
  canEdit: boolean;
  onChange: (matchId: string, side: 'home' | 'away', value: string) => void;
}) {
  return (
    <View style={styles.simulatorPanel}>
      <View style={styles.simulatorHeader}>
        <View>
          <Text style={styles.simulatorTitle}>Simulador da fase de grupos</Text>
          <Text style={styles.simulatorSubtitle}>
            Ajuste apenas os jogos em aberto. Resultados ao vivo ou finalizados entram como reais.
          </Text>
        </View>
        <View style={styles.simulatorBadge}>
          <Ionicons name="git-branch-outline" size={16} color="#5ee8a0" />
          <Text style={styles.simulatorBadgeText}>nao altera palpites regulares</Text>
        </View>
      </View>
      <View style={styles.simulatorGrid}>
        {groups.map((group) => {
          const standings = projectedRows(group, draft);
          return (
            <View key={group.group} style={styles.simGroupCard}>
              <View style={styles.simGroupHeader}>
                <Text style={styles.simGroupTitle}>Grupo {group.group}</Text>
                <Text style={styles.simGroupMeta}>
                  {group.matches.filter((match) => match.status !== 'SCHEDULED').length}/6 reais
                </Text>
              </View>
              <View style={styles.simMatchList}>
                {group.matches.map((match) => (
                  <SimulationMatchRow
                    key={match.id}
                    match={match}
                    draft={draft}
                    canEdit={canEdit}
                    onChange={onChange}
                  />
                ))}
              </View>
              <View style={styles.simStandings}>
                {standings.slice(0, 3).map((row) => (
                  <View key={row.team.id} style={styles.simStandingRow}>
                    <Text style={styles.simStandingRank}>{row.rank}</Text>
                    <TeamLabel team={row.team} compact tone="light" />
                    <Text style={styles.simStandingPoints}>{row.points}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function KnockoutGuide() {
  return (
    <View style={styles.knockoutGuide}>
      {[
        ['1', 'A base vem dos seus palpites da fase de grupos e dos resultados reais que ja entrarem.'],
        ['2', 'Use o simulador para testar os jogos ainda em aberto sem trocar seus palpites oficiais.'],
        ['3', 'Preencha a chave ate final e terceiro lugar; em empate, toque na selecao que avanca.'],
        ['4', 'Salve a chave parcial ou completa. Confronto exato vale 15 pts; uma selecao correta vale 7 pts.'],
      ].map(([step, text]) => (
        <View key={step} style={styles.guideStep}>
          <Text style={styles.guideStepNumber}>{step}</Text>
          <Text style={styles.guideStepText}>{text}</Text>
        </View>
      ))}
    </View>
  );
}

const stageLabels: Record<KnockoutFixture['stage'], string> = {
  ROUND_OF_32: '16 avos',
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

const BRACKET_X_SCALE = 1.2;
const BRACKET_CARD_WIDTH = 158;
const BRACKET_CARD_HEIGHT = 74;
const BRACKET_CANVAS_WIDTH = 1550;
const BRACKET_CANVAS_HEIGHT = 730;

type BracketPosition = { x: number; y: number };

const bracketPositions = new Map<number, BracketPosition>();
const bracketX = (value: number) => Math.round(value * BRACKET_X_SCALE);

function assignBracketPositions(numbers: number[], x: number, firstY: number, gap: number) {
  numbers.forEach((number, index) =>
    bracketPositions.set(number, { x: bracketX(x), y: firstY + index * gap }),
  );
}

assignBracketPositions([74, 77, 73, 75, 83, 84, 81, 82], 4, 36, 84);
assignBracketPositions([89, 90, 93, 94], 148, 78, 168);
assignBracketPositions([97, 98], 292, 162, 336);
assignBracketPositions([101], 436, 330, 0);
assignBracketPositions([104], 580, 248, 0);
assignBracketPositions([103], 580, 470, 0);
assignBracketPositions([102], 724, 330, 0);
assignBracketPositions([99, 100], 868, 162, 336);
assignBracketPositions([91, 92, 95, 96], 1012, 78, 168);
assignBracketPositions([76, 78, 79, 80, 86, 88, 85, 87], 1156, 36, 84);

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
  const advancing = resolvedAdvancingTeam(draft[sourceNumber], previous);
  if (!previous?.homeTeamId || !previous.awayTeamId || !advancing) return null;
  if (source.startsWith('W')) return advancing;
  return advancing === previous.homeTeamId ? previous.awayTeamId : previous.homeTeamId;
}

function resolvedAdvancingTeam(
  value: KnockoutDraft[number] | undefined,
  participants?: { homeTeamId: string | null; awayTeamId: string | null },
) {
  if (
    !value ||
    !participants?.homeTeamId ||
    !participants.awayTeamId ||
    value.home === '' ||
    value.away === ''
  ) {
    return null;
  }
  if (value.home !== value.away) {
    return Number(value.home) > Number(value.away)
      ? participants.homeTeamId
      : participants.awayTeamId;
  }
  return value.advancingTeamId &&
    [participants.homeTeamId, participants.awayTeamId].includes(value.advancingTeamId)
    ? value.advancingTeamId
    : null;
}

function knockoutFixtureIsEditable(fixture: KnockoutFixture) {
  return fixture.status === 'SCHEDULED' && new Date(fixture.startsAt).getTime() > Date.now();
}

function knockoutTeamKey(team?: Team | null) {
  if (!team?.name) return null;
  return `name:${team.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()}`;
}

function knockoutActualWinnerId(fixture: KnockoutFixture) {
  if (fixture.winnerTeam?.id) return fixture.winnerTeam.id;
  const homeScore = fixture.finalHomeScore ?? fixture.homeScore;
  const awayScore = fixture.finalAwayScore ?? fixture.awayScore;
  if (homeScore == null || awayScore == null || homeScore === awayScore) return null;
  return homeScore > awayScore ? fixture.homeTeam?.id ?? null : fixture.awayTeam?.id ?? null;
}

function knockoutStageWinnerIds(fixtures: KnockoutFixture[]) {
  const ids = new Map<KnockoutFixture['stage'], Set<string>>();
  for (const fixture of fixtures) {
    if (fixture.status !== 'FINISHED') continue;
    const winnerId = knockoutActualWinnerId(fixture);
    if (!winnerId) continue;
    const current = ids.get(fixture.stage) ?? new Set<string>();
    current.add(winnerId);
    const winnerTeam =
      fixture.winnerTeam ??
      (winnerId === fixture.homeTeam?.id
        ? fixture.homeTeam
        : winnerId === fixture.awayTeam?.id
          ? fixture.awayTeam
          : null);
    const winnerKey = knockoutTeamKey(winnerTeam);
    if (winnerKey) current.add(winnerKey);
    ids.set(fixture.stage, current);
  }
  return ids;
}

function knockoutPickTone(
  fixture: KnockoutFixture,
  value: KnockoutDraft[number],
  winnersByStage?: Map<KnockoutFixture['stage'], Set<string>>,
  teamsById?: Map<string, Team>,
) {
  if (fixture.status !== 'FINISHED' || !value?.advancingTeamId) return null;
  const actualWinnerId = knockoutActualWinnerId(fixture);
  const advancingKey = knockoutTeamKey(teamsById?.get(value.advancingTeamId));
  const stageWinners = winnersByStage?.get(fixture.stage);
  if (
    actualWinnerId === value.advancingTeamId ||
    stageWinners?.has(value.advancingTeamId) ||
    (advancingKey && stageWinners?.has(advancingKey))
  ) {
    return 'correct';
  }
  if (!actualWinnerId && !stageWinners?.size) return null;
  return 'wrong';
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
    if (fixture.homeTeam?.id && fixture.awayTeam?.id) {
      participants.set(fixture.matchNumber, {
        homeTeamId: fixture.homeTeam.id,
        awayTeamId: fixture.awayTeam.id,
      });
      continue;
    }
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
  winnersByStage,
  onChangeScore,
  onChoose,
}: {
  fixture: KnockoutFixture;
  teams: Map<string, Team>;
  participants?: { homeTeamId: string | null; awayTeamId: string | null };
  value: KnockoutDraft[number];
  open: boolean;
  winnersByStage?: Map<KnockoutFixture['stage'], Set<string>>;
  onChangeScore: (side: 'home' | 'away', value: string) => void;
  onChoose: (teamId: string) => void;
}) {
  const homeTeam = participants?.homeTeamId ? teams.get(participants.homeTeamId) : null;
  const awayTeam = participants?.awayTeamId ? teams.get(participants.awayTeamId) : null;
  const matchupReady = Boolean(participants?.homeTeamId && participants.awayTeamId);
  const tied = value.home !== '' && value.home === value.away;
  const advancingMissing = tied && !value.advancingTeamId;
  const tone = knockoutPickTone(fixture, value, winnersByStage, teams);
  return (
    <View
      style={[
        styles.knockoutCard,
        !open && styles.knockoutCardLocked,
      ]}
    >
      <View style={styles.knockoutCardHeader}>
        <Text style={styles.knockoutMatchNumber}>Jogo {fixture.matchNumber}</Text>
        <Text style={styles.knockoutDate}>{compactDateTime(fixture.startsAt)}</Text>
      </View>
      <View
        style={[
          styles.knockoutScorePairBox,
          tone === 'correct' && styles.knockoutScorePairCorrect,
          tone === 'wrong' && styles.knockoutScorePairWrong,
        ]}
      >
      {[
        { team: homeTeam, side: 'home' as const },
        { team: awayTeam, side: 'away' as const },
      ].map(({ team, side }) => {
        const teamId = side === 'home' ? participants?.homeTeamId : participants?.awayTeamId;
        const selected = teamId && value.advancingTeamId === teamId;
        return (
          <View
            key={side}
            style={[styles.knockoutTeamRow, selected && tied && styles.knockoutTeamSelected]}
          >
            <TeamLabel team={team} dense tone="light" />
            <View style={styles.knockoutScoreArea}>
              <ScoreInput
                editable={open && matchupReady}
                teamName={team?.name ?? 'Time a definir'}
                side={side}
                showLabel={false}
                compact
                value={side === 'home' ? value.home : value.away}
                error={advancingMissing && side === 'away' ? 'Escolha quem avança' : undefined}
                onChange={(text) => onChangeScore(side, text)}
              />
              <View style={styles.knockoutAdvanceMarker}>
                {selected ? (
                  <Ionicons name="checkmark-circle" size={10} color="#6cffb1" />
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
      </View>
      {tied ? (
        <View style={styles.penaltyAdvanceRow}>
          <Text style={styles.penaltyAdvanceLabel}>Pênaltis</Text>
          {[
            { team: homeTeam, teamId: participants?.homeTeamId },
            { team: awayTeam, teamId: participants?.awayTeamId },
          ].map(({ team, teamId }) => {
            const selected = teamId && value.advancingTeamId === teamId;
            return (
              <Pressable
                key={teamId ?? team?.name ?? 'empty'}
                accessibilityRole="radio"
                accessibilityState={{ selected: Boolean(selected), disabled: !open || !matchupReady || !teamId }}
                accessibilityLabel={`${team?.name ?? 'Time a definir'} avança nos pênaltis`}
                disabled={!open || !matchupReady || !teamId}
                onPress={() => teamId && onChoose(teamId)}
                style={[styles.penaltyAdvanceButton, selected && styles.penaltyAdvanceButtonActive]}
              >
                <Text style={styles.penaltyAdvanceButtonText} numberOfLines={1}>
                  {team?.code ?? team?.name ?? '--'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
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
  const publicWinnersByStage = useMemo(
    () => knockoutStageWinnerIds(selected?.picks.map((pick) => pick.fixture) ?? []),
    [selected?.picks],
  );
  const publicTeamsById = useMemo(() => {
    const entries =
      selected?.picks.flatMap((pick) => [
        [pick.homeTeam.id, pick.homeTeam] as const,
        [pick.awayTeam.id, pick.awayTeam] as const,
        [pick.advancingTeam.id, pick.advancingTeam] as const,
        ...(pick.fixture.homeTeam ? ([[pick.fixture.homeTeam.id, pick.fixture.homeTeam] as const] as const) : []),
        ...(pick.fixture.awayTeam ? ([[pick.fixture.awayTeam.id, pick.fixture.awayTeam] as const] as const) : []),
        ...(pick.fixture.winnerTeam
          ? ([[pick.fixture.winnerTeam.id, pick.fixture.winnerTeam] as const] as const)
          : []),
      ]) ?? [];
    return new Map(entries);
  }, [selected?.picks]);
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
                {selected?.picks.map((pick) => {
                  const tone = knockoutPickTone(
                    pick.fixture,
                    {
                      home: String(pick.predictedHomeScore),
                      away: String(pick.predictedAwayScore),
                      advancingTeamId: pick.advancingTeam.id,
                    },
                    publicWinnersByStage,
                    publicTeamsById,
                  );
                  return (
                    <View
                      key={pick.id}
                      style={[
                        styles.publicBracketPick,
                        tone === 'correct' && styles.publicBracketPickCorrect,
                        tone === 'wrong' && styles.publicBracketPickWrong,
                      ]}
                    >
                      <Text style={styles.knockoutMatchNumber}>Jogo {pick.fixture.matchNumber}</Text>
                      <Text style={styles.publicBracketTeams} numberOfLines={1}>
                        {pick.homeTeam.name} {pick.predictedHomeScore} x {pick.predictedAwayScore}{' '}
                        {pick.awayTeam.name}
                      </Text>
                      <Text style={styles.publicBracketWinner}>
                        Avança: {pick.advancingTeam.name}
                      </Text>
                    </View>
                  );
                }) ?? <Text style={styles.modalSubtitle}>Nenhuma chave publicada.</Text>}
              </ScrollView>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function drawCanvasRoundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke?: string,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 2;
    context.stroke();
  }
}

function drawFitCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  weight: string,
  color: string,
) {
  let fontSize = size;
  do {
    context.font = `${weight} ${fontSize}px Arial, sans-serif`;
    if (context.measureText(text).width <= maxWidth || fontSize <= 14) break;
    fontSize -= 1;
  } while (fontSize > 14);
  context.fillStyle = color;
  context.fillText(text, x, y);
}

function teamName(teams: Map<string, Team>, teamId: string) {
  return teams.get(teamId)?.name ?? 'A definir';
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Nao foi possivel gerar a imagem do chaveamento.'));
    }, 'image/png');
  });
}

async function createBracketShareImage(picks: FilledKnockoutPick[], teams: Map<string, Team>) {
  if (typeof document === 'undefined') {
    throw new Error('Compartilhamento de imagem disponivel apenas no navegador.');
  }

  const grouped = bracketStageOrder
    .map((stage) => ({
      stage,
      picks: picks
        .filter((pick) => pick.fixture.stage === stage)
        .sort((left, right) => left.matchNumber - right.matchNumber),
    }))
    .filter((group) => group.picks.length);
  const width = 1080;
  const height = Math.max(
    640,
    190 + grouped.length * 46 + picks.length * 70 + 86,
  );
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Nao foi possivel preparar a imagem do chaveamento.');

  context.textBaseline = 'top';
  context.fillStyle = palette.shell;
  context.fillRect(0, 0, width, height);
  drawCanvasRoundRect(context, 48, 40, 984, 110, 22, palette.shellSoft, palette.bracketBorder);
  context.fillStyle = palette.yellow;
  context.font = '900 22px Arial, sans-serif';
  context.fillText('BOLAO COPA 2026', 78, 65);
  context.fillStyle = palette.white;
  context.font = '900 42px Arial, sans-serif';
  context.fillText('Meu chaveamento palpitado', 78, 94);
  context.fillStyle = '#b7c6bf';
  context.font = '800 19px Arial, sans-serif';
  context.fillText(
    `${picks.length}/32 jogos preenchidos - gerado em ${dateTime(new Date().toISOString())}`,
    78,
    134,
  );

  let y = 182;
  grouped.forEach((group) => {
    context.fillStyle = palette.yellow;
    context.font = '900 22px Arial, sans-serif';
    context.fillText(stageLabels[group.stage], 60, y);
    context.fillStyle = '#b7c6bf';
    context.font = '800 16px Arial, sans-serif';
    context.fillText(`${group.picks.length} jogo(s)`, 244, y + 4);
    y += 34;

    group.picks.forEach((pick) => {
      const homeName = teamName(teams, pick.homeTeamId);
      const awayName = teamName(teams, pick.awayTeamId);
      const winnerName = teamName(teams, pick.advancingTeamId);
      drawCanvasRoundRect(context, 56, y, 968, 58, 14, palette.bracketCard, palette.bracketBorder);
      drawCanvasRoundRect(context, 76, y + 13, 76, 32, 10, '#0c1d18', '#224739');
      context.fillStyle = palette.yellow;
      context.font = '900 16px Arial, sans-serif';
      context.fillText(`Jogo ${pick.matchNumber}`, 88, y + 21);
      drawFitCanvasText(
        context,
        `${homeName} ${pick.predictedHomeScore} x ${pick.predictedAwayScore} ${awayName}`,
        176,
        y + 15,
        600,
        24,
        '900',
        palette.white,
      );
      drawFitCanvasText(
        context,
        `Avanca: ${winnerName}`,
        176,
        y + 39,
        600,
        16,
        '800',
        '#b7c6bf',
      );
      drawCanvasRoundRect(context, 814, y + 14, 182, 30, 15, palette.green, undefined);
      drawFitCanvasText(context, stageLabels[pick.fixture.stage], 838, y + 21, 134, 14, '900', palette.white);
      y += 70;
    });
    y += 12;
  });

  context.fillStyle = '#b7c6bf';
  context.font = '800 17px Arial, sans-serif';
  context.fillText('Compartilhe a imagem e acompanhe as eliminatorias no ranking.', 60, height - 58);
  return canvasToPngBlob(canvas);
}

function downloadBlob(blob: Blob, fileName: string) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function KnockoutBoard({
  board,
  groupScores,
  onSaved,
  currentUserId,
}: {
  board: PredictionBoard;
  groupScores: Array<{
    matchId: string;
    predictedHomeScore: number;
    predictedAwayScore: number;
  }>;
  onSaved: (next: PredictionBoard) => void;
  currentUserId: string;
}) {
  const { width } = useWindowDimensions();
  const bracketScrollRef = useRef<ScrollView>(null);
  const legacyDraftKey = `bolao-knockout-draft-v1:${board.knockout.generation.id}`;
  const draftKey = draftStorageKey(
    currentUserId,
    'pool-season-bolao-do-trabalho-world-cup-2026',
    `knockout:${board.knockout.generation.id}`,
  );
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
        const stored = JSON.parse(
          window.localStorage.getItem(draftKey)
            ?? window.localStorage.getItem(legacyDraftKey)
            ?? '{}',
        ) as KnockoutDraft;
        if (Object.keys(stored).length) return stored;
      } catch {
        // Ignore corrupted local drafts and fall back to an empty bracket.
      }
    }
    return {};
  });
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'clean' | 'dirty' | 'saving' | 'saved' | 'failed'>('clean');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const partialConfirmation = useRef(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [shareReady, setShareReady] = useState(Boolean(board.knockout.savedBracket?.picks.length));
  const [shareBusy, setShareBusy] = useState(false);
  const [savedPickCount, setSavedPickCount] = useState(board.knockout.savedBracket?.picks.length ?? 0);
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
  const winnersByStage = useMemo(
    () => knockoutStageWinnerIds(board.knockout.fixtures),
    [board.knockout.fixtures],
  );
  const classifiedSlots = useMemo(
    () =>
      board.knockout.roundOf32.reduce(
        (total, matchup) =>
          total + Number(Boolean(matchup.homeTeamId)) + Number(Boolean(matchup.awayTeamId)),
        0,
      ),
    [board.knockout.roundOf32],
  );
  const editableFixtures = useMemo(
    () => board.knockout.fixtures.filter((fixture) => knockoutFixtureIsEditable(fixture)),
    [board.knockout.fixtures],
  );
  const canEdit = board.canPredict && editableFixtures.length > 0;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (saveState === 'dirty' || saveState === 'failed') {
      window.localStorage.setItem(draftKey, JSON.stringify(draft));
      window.localStorage.removeItem(legacyDraftKey);
    }
  }, [draft, draftKey, legacyDraftKey, saveState]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      if (saveState !== 'dirty' && saveState !== 'failed') return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  useEffect(() => {
    const savedCount = board.knockout.savedBracket?.picks.length ?? 0;
    if (savedCount) {
      setShareReady(true);
      setSavedPickCount(savedCount);
    }
  }, [board.knockout.savedBracket?.picks.length]);

  function changeScore(matchNumber: number, side: 'home' | 'away', text: string) {
    setSaveState('dirty');
    partialConfirmation.current = false;
    setDraft((current) => {
      const next = { ...current };
      const matchParticipants = participants.get(matchNumber);
      const previous = next[matchNumber];
      const value = {
        home: previous?.home ?? '',
        away: previous?.away ?? '',
        advancingTeamId: previous?.advancingTeamId ?? null,
        [side]: text,
      };
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
      return next;
    });
  }

  function chooseAdvancingTeam(matchNumber: number, teamId: string) {
    setSaveState('dirty');
    partialConfirmation.current = false;
    setDraft((current) => {
      return {
        ...current,
        [matchNumber]: {
          home: current[matchNumber]?.home ?? '',
          away: current[matchNumber]?.away ?? '',
          advancingTeamId: teamId,
        },
      };
    });
  }

  const filledPicks = useMemo(
    () =>
      board.knockout.fixtures.flatMap((fixture) => {
        const value = draft[fixture.matchNumber];
        const matchup = participants.get(fixture.matchNumber);
        const advancingTeamId = resolvedAdvancingTeam(value, matchup);
        if (
          !matchup?.homeTeamId ||
          !matchup.awayTeamId ||
          !value ||
          value.home === '' ||
          value.away === '' ||
          !advancingTeamId
        ) {
          return [];
        }
        return [
          {
            fixture,
            matchNumber: fixture.matchNumber,
            homeTeamId: matchup.homeTeamId,
            awayTeamId: matchup.awayTeamId,
            predictedHomeScore: Number(value.home),
            predictedAwayScore: Number(value.away),
            advancingTeamId,
          },
        ];
      }),
    [board.knockout.fixtures, draft, participants],
  );
  const complete = filledPicks.length === board.knockout.fixtures.length;
  const editableMatchNumbers = useMemo(
    () => new Set(editableFixtures.map((fixture) => fixture.matchNumber)),
    [editableFixtures],
  );
  const editableFilledPicks = useMemo(
    () => filledPicks.filter((pick) => editableMatchNumbers.has(pick.matchNumber)),
    [editableMatchNumbers, filledPicks],
  );
  const missingEditableCount = editableFixtures.length - editableFilledPicks.length;

  async function save() {
    if (!editableFilledPicks.length) {
      setError('Preencha pelo menos um confronto futuro para salvar a chave.');
      return;
    }
    if (missingEditableCount > 0 && !partialConfirmation.current) {
      partialConfirmation.current = true;
      setError(
        `Resumo antes de enviar: ${editableFilledPicks.length} jogo(s) preenchido(s) e ${missingEditableCount} pendente(s). Revise e pressione Salvar novamente para confirmar o envio parcial.`,
      );
      return;
    }

    setSaving(true);
    setSaveState('saving');
    setError('');
    try {
      const next = await api.saveKnockoutBracket(
        editableFilledPicks.map((pick) => ({
          matchNumber: pick.matchNumber,
          predictedHomeScore: pick.predictedHomeScore,
          predictedAwayScore: pick.predictedAwayScore,
          advancingTeamId: pick.advancingTeamId,
        })),
        groupScores,
      );
      if (typeof window !== 'undefined') window.localStorage.removeItem(draftKey);
      onSaved(next);
      setSavedPickCount(next.knockout.savedBracket?.picks.length ?? filledPicks.length);
      setShareReady(true);
      setSuccess(true);
      setSaveState('saved');
      setSavedAt(new Date().toISOString());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar a chave.');
      setSaveState('failed');
    } finally {
      setSaving(false);
    }
  }

  async function shareBracketImage() {
    if (!filledPicks.length) {
      setError('Preencha pelo menos um confronto para gerar a imagem do chaveamento.');
      return;
    }
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      setError('Compartilhamento de imagem disponivel apenas no navegador.');
      return;
    }

    setShareBusy(true);
    setError('');
    try {
      const blob = await createBracketShareImage(filledPicks, teams);
      const fileName = `chaveamento-bolao-${new Date().toISOString().slice(0, 10)}.png`;
      const shareText = `Meu chaveamento palpitado no Bolao Copa 2026: ${filledPicks.length}/32 jogos preenchidos.`;
      const shareNavigator = navigator as Navigator & {
        canShare?: (data: { files?: File[]; text?: string; title?: string }) => boolean;
        share?: (data: { files?: File[]; text?: string; title?: string }) => Promise<void>;
      };

      if (typeof File !== 'undefined') {
        const file = new File([blob], fileName, { type: 'image/png' });
        if (shareNavigator.share && shareNavigator.canShare?.({ files: [file] })) {
          await shareNavigator.share({
            files: [file],
            title: 'Meu chaveamento - Bolao Copa 2026',
            text: shareText,
          });
          return;
        }
      }

      downloadBlob(blob, fileName);
      window.open(
        `https://wa.me/?text=${encodeURIComponent(`${shareText} Imagem baixada; anexe o PNG no WhatsApp.`)}`,
        '_blank',
        'noopener,noreferrer',
      );
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Nao foi possivel compartilhar a imagem.');
    } finally {
      setShareBusy(false);
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
      ROUND_OF_32: bracketX(4) + BRACKET_CARD_WIDTH / 2,
      ROUND_OF_16: bracketX(148) + BRACKET_CARD_WIDTH / 2,
      QUARTER_FINAL: bracketX(292) + BRACKET_CARD_WIDTH / 2,
      SEMI_FINAL: bracketX(436) + BRACKET_CARD_WIDTH / 2,
      THIRD_PLACE: bracketX(580) + BRACKET_CARD_WIDTH / 2,
      FINAL: bracketX(580) + BRACKET_CARD_WIDTH / 2,
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
          <Ionicons name="time-outline" size={22} color="#5ee8a0" />
          <View style={styles.knockoutDeadlineCopy}>
            <Text style={styles.knockoutDeadlineTitle}>
              {canEdit ? 'Jogos futuros abertos para edição' : 'Sem jogos futuros abertos'}
            </Text>
            <Text style={styles.knockoutDeadlineText}>
              {canEdit
                ? `${editableFixtures.length} jogo(s) ainda podem receber palpite.`
                : 'Jogos iniciados ou encerrados ficam bloqueados.'}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.bracketPanel}>
        <ScrollView
          horizontal
          accessibilityRole="tablist"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.bracketStageTabs}
        >
          {bracketStageOrder.map((stage) => (
            <Pressable
              key={stage}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeStage === stage }}
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
          <Ionicons name="checkmark-circle-outline" size={16} color="#5ee8a0" />
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
              { stage: 'ROUND_OF_32' as const, x: bracketX(4) },
              { stage: 'ROUND_OF_16' as const, x: bracketX(148) },
              { stage: 'QUARTER_FINAL' as const, x: bracketX(292) },
              { stage: 'SEMI_FINAL' as const, x: bracketX(436) },
              { stage: 'SEMI_FINAL' as const, x: bracketX(724) },
              { stage: 'QUARTER_FINAL' as const, x: bracketX(868) },
              { stage: 'ROUND_OF_16' as const, x: bracketX(1012) },
              { stage: 'ROUND_OF_32' as const, x: bracketX(1156) },
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
                    open={board.canPredict && knockoutFixtureIsEditable(fixture)}
                    winnersByStage={winnersByStage}
                    onChangeScore={(side, value) => changeScore(fixture.matchNumber, side, value)}
                    onChoose={(teamId) => chooseAdvancingTeam(fixture.matchNumber, teamId)}
                  />
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {board.knockout.generation.mode === 'OFFICIAL' && !canEdit ? (
        <View style={styles.publicBracketAction}>
          <Pressable style={styles.publicBracketButton} onPress={openPublicBrackets}>
            <Ionicons name="people-outline" size={17} color={palette.white} />
            <Text style={styles.publicBracketButtonText}>Ver chaves dos participantes</Text>
          </Pressable>
        </View>
      ) : null}
      {canEdit && board.knockout.roundOf32.length ? (
        <View style={styles.knockoutFooter}>
          <Text style={styles.knockoutFooterText} accessibilityLiveRegion="polite">
            {complete
              ? 'Todos os 32 confrontos estão preenchidos.'
              : editableFilledPicks.length
                ? `${editableFilledPicks.length}/${editableFixtures.length} jogo(s) futuro(s) preenchido(s). Jogos iniciados ou encerrados ficam preservados.`
                : 'Preencha pelo menos um confronto futuro para salvar a chave.'}
            {saveState === 'dirty'
              ? ' · Não salvo'
              : saveState === 'saving'
                ? ' · Salvando'
                : saveState === 'failed'
                  ? ' · Falhou — tentar novamente'
                  : saveState === 'saved' && savedAt
                    ? ` · Salvo às ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(savedAt))}`
                    : ''}
          </Text>
          <View style={styles.knockoutFooterActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !editableFilledPicks.length || saving }}
              disabled={!editableFilledPicks.length || saving}
              onPress={save}
              style={[
                styles.submitBracket,
                (!editableFilledPicks.length || saving) && styles.disabled,
              ]}
            >
              <Ionicons name="cloud-upload-outline" size={18} color={palette.shell} />
              <Text style={styles.submitBracketText}>
                {saving ? 'Salvando...' : complete ? 'Salvar chave completa' : 'Salvar chave parcial'}
              </Text>
            </Pressable>
            {shareReady && filledPicks.length ? (
              <Pressable
                disabled={shareBusy}
                onPress={shareBracketImage}
                style={[styles.shareBracketButton, shareBusy && styles.disabled]}
              >
                <Ionicons name="logo-whatsapp" size={18} color={palette.shell} />
                <Text style={styles.shareBracketButtonText}>
                  {shareBusy ? 'Gerando...' : 'Compartilhar no WhatsApp'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      <SuccessModal
        visible={success}
        message={
          savedPickCount === board.knockout.fixtures.length
            ? 'Sua chave completa foi salva em uma unica operacao.'
            : `Sua chave parcial foi salva com ${savedPickCount} jogo(s).`
        }
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
  initialView = 'groups',
  standaloneKnockout = false,
}: {
  currentUserId: string;
  refreshVersion: number;
  initialView?: 'groups' | 'knockout';
  standaloneKnockout?: boolean;
}) {
  const { width } = useWindowDimensions();
  const previewRequestRef = useRef(0);
  const [view, setView] = useState<'groups' | 'knockout'>(initialView);
  const [board, setBoard] = useState<PredictionBoard | null>(null);
  const [draft, setDraft] = useState<ScoreDraft>({});
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
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
        const savedScore = standaloneKnockout
          ? match.simulationScore ?? match.ownPrediction
          : match.ownPrediction;
        values[match.id] = {
          home: savedScore ? String(savedScore.predictedHomeScore) : '',
          away: savedScore ? String(savedScore.predictedAwayScore) : '',
        };
      }
      return values;
    });
  }, [standaloneKnockout]);

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

  const groupScorePayload = useMemo(() => {
    if (!board) return [];
    return board.groups
      .flatMap((group) => group.matches)
      .flatMap((match) => {
        const value = draft[match.id];
        if (!value || value.home === '' || value.away === '') return [];
        return [
          {
            matchId: match.id,
            predictedHomeScore: Number(value.home),
            predictedAwayScore: Number(value.away),
          },
        ];
      });
  }, [board, draft]);

  const groupScoreSignature = useMemo(
    () =>
      groupScorePayload
        .map(
          (score) =>
            `${score.matchId}:${score.predictedHomeScore}:${score.predictedAwayScore}`,
        )
        .join('|'),
    [groupScorePayload],
  );
  const simulationOpen = Boolean(board?.canPredict && board.knockout.generation.isOpen);

  useEffect(() => {
    if (!standaloneKnockout || !simulationOpen || loading) return undefined;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    const timer = setTimeout(() => {
      setPreviewing(true);
      api
        .savePredictionBoardSimulation(groupScorePayload)
        .then((next) => {
          if (previewRequestRef.current !== requestId) return;
          applyBoard(next);
          setError('');
        })
        .catch((caught) => {
          if (previewRequestRef.current !== requestId) return;
          setError(caught instanceof Error ? caught.message : 'Erro ao atualizar a simulacao.');
        })
        .finally(() => {
          if (previewRequestRef.current === requestId) setPreviewing(false);
        });
    }, 450);

    return () => clearTimeout(timer);
  }, [
    applyBoard,
    groupScoreSignature,
    loading,
    simulationOpen,
    standaloneKnockout,
  ]);

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

  const knockoutKey = board.knockout.generation.id;

  return (
    <View style={[styles.screen, standaloneKnockout && styles.knockoutStandaloneShell]}>
      <View style={styles.boardHeader}>
        <View style={[styles.boardHeaderCopy, width < 760 && styles.boardHeaderCopyMobile]}>
          <Text style={styles.screenTitle}>
            {standaloneKnockout
              ? 'Eliminatorias'
              : view === 'knockout'
              ? 'Eliminatórias'
              : competitionUiV2
                ? 'Palpites'
                : 'Palpites da Copa'}
          </Text>
          <Text style={styles.screenSubtitle}>
            {standaloneKnockout
              ? 'Simule os jogos em aberto, confira o chaveamento projetado e salve sua previsao das eliminatorias.'
              : view === 'knockout'
              ? 'Monte todos os confrontos e salve a chave completa em uma única operação.'
              : competitionUiV2
                ? 'Agenda compacta para preencher os placares de cada dia.'
                : 'Placares e classificação projetada da fase de grupos.'}
          </Text>
        </View>
        {!standaloneKnockout ? (
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
        ) : null}
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
            ['15', 'placar exato'],
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

      {standaloneKnockout ? (
        <>
          <KnockoutGuide />
        </>
      ) : null}

      <SoftReveal key={standaloneKnockout ? 'knockout-page' : view}>
        {standaloneKnockout ? (
          <KnockoutBoard
            key={knockoutKey}
            board={board}
            groupScores={groupScorePayload}
            onSaved={applyBoard}
            currentUserId={currentUserId}
          />
        ) : view === 'groups' ? (
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
          <KnockoutBoard
            key={knockoutKey}
            board={board}
            groupScores={groupScorePayload}
            onSaved={applyBoard}
            currentUserId={currentUserId}
          />
        )}
      </SoftReveal>

      {standaloneKnockout ? (
        <>
          <GroupSimulationPanel
            groups={board.groups}
            draft={draft}
            canEdit={simulationOpen}
            onChange={(matchId, side, value) =>
              setDraft((current) => ({
                ...current,
                [matchId]: { home: '', away: '', ...current[matchId], [side]: value },
              }))
            }
          />
          <View style={styles.previewStatusBar}>
            <Ionicons name="sync-outline" size={15} color="#5ee8a0" />
            <Text style={styles.previewStatusText}>
              {previewing
                ? 'Salvando simulacao...'
                : simulationOpen
                  ? 'Chave sincronizada com a simulacao salva.'
                  : 'Simulacao fechada para alteracoes.'}
            </Text>
          </View>
        </>
      ) : null}

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
  knockoutStandaloneShell: {
    width: '100%',
    maxWidth: 1280,
    alignSelf: 'center',
    borderColor: palette.bracketBorder,
    borderWidth: 1,
    borderRadius: 13,
    backgroundImage:
      'linear-gradient(145deg, rgba(3, 39, 94, 0.72), rgba(0, 26, 70, 0.82) 62%, rgba(0, 73, 64, 0.22))' as never,
    boxShadow: '0 22px 70px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.08)' as never,
    padding: 18,
  },
  boardHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 14,
  },
  boardHeaderCopy: { flex: 1, minWidth: 0 },
  boardHeaderCopyMobile: { flexBasis: '100%', width: '100%' },
  screenTitle: {
    color: palette.white,
    fontSize: 30,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  screenSubtitle: { maxWidth: 680, color: palette.muted, fontSize: 14, lineHeight: 20, marginTop: 3 },
  phaseTabs: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 8,
    backgroundColor: palette.shellSoft,
    borderWidth: 1,
    borderColor: palette.bracketBorder,
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
  phaseTabActive: {
    backgroundColor: palette.yellow,
    boxShadow: '0 8px 22px rgba(255, 211, 21, 0.22)' as never,
  },
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
  knockoutGuide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    padding: 12,
    borderRadius: 15,
    backgroundImage:
      'linear-gradient(145deg, rgba(2, 48, 95, 0.92), rgba(0, 23, 64, 0.92))' as never,
    borderWidth: 1,
    borderColor: palette.bracketBorder,
  },
  guideStep: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 240,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(1, 24, 64, 0.82)' as never,
    borderWidth: 1,
    borderColor: palette.bracketBorder,
  },
  guideStepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    textAlign: 'center',
    lineHeight: 28,
    color: palette.shell,
    backgroundColor: palette.yellow,
    fontSize: 13,
    fontWeight: '900',
  },
  guideStepText: { flex: 1, color: '#bed7ce', fontSize: 12, lineHeight: 17, fontWeight: '700' },
  simulatorPanel: {
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: 'rgba(1, 18, 55, 0.84)' as never,
    borderWidth: 1,
    borderColor: palette.bracketBorder,
  },
  simulatorHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.bracketBorder,
    backgroundColor: 'rgba(1, 18, 55, 0.86)' as never,
  },
  simulatorTitle: { color: palette.white, fontSize: 18, fontWeight: '900' },
  simulatorSubtitle: { color: '#9bb9ac', fontSize: 12, lineHeight: 17, marginTop: 2 },
  simulatorBadge: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(5, 28, 62, 0.78)' as never,
    borderWidth: 1,
    borderColor: 'rgba(98, 164, 255, 0.24)' as never,
  },
  simulatorBadgeText: {
    color: '#6cffb1',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  simulatorGrid: { padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  simGroupCard: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 300,
    minWidth: 280,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundImage:
      'linear-gradient(180deg, rgba(3, 58, 101, 0.78), rgba(1, 24, 64, 0.9))' as never,
    borderWidth: 1,
    borderColor: palette.bracketBorder,
  },
  simGroupHeader: {
    minHeight: 38,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(4, 76, 112, 0.62)' as never,
    borderBottomWidth: 1,
    borderBottomColor: palette.bracketBorder,
  },
  simGroupTitle: { color: palette.white, fontSize: 14, fontWeight: '900' },
  simGroupMeta: { color: '#8ff5be', fontSize: 10, fontWeight: '800' },
  simMatchList: { padding: 8, gap: 6 },
  simMatchRow: {
    minHeight: 42,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(1, 24, 64, 0.82)' as never,
    borderWidth: 1,
    borderColor: palette.bracketBorder,
  },
  simMatchLocked: {
    backgroundColor: 'rgba(5, 35, 82, 0.78)' as never,
    borderColor: 'rgba(98, 164, 255, 0.22)' as never,
  },
  simMatchTeams: { flex: 1, minWidth: 0, gap: 4 },
  simMatchState: {
    minWidth: 48,
    color: '#5ee8a0',
    fontSize: 10,
    fontWeight: '900',
    textAlign: 'right',
  },
  simStandings: {
    padding: 8,
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: palette.bracketBorder,
    backgroundColor: 'rgba(1, 18, 55, 0.86)' as never,
  },
  simStandingRow: { minHeight: 22, flexDirection: 'row', alignItems: 'center', gap: 7 },
  simStandingRank: { width: 18, color: palette.yellow, fontSize: 12, fontWeight: '900' },
  simStandingPoints: {
    marginLeft: 'auto',
    color: palette.yellow,
    fontSize: 12,
    fontWeight: '900',
  },
  previewStatusBar: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(5, 28, 62, 0.78)' as never,
    borderWidth: 1,
    borderColor: 'rgba(98, 164, 255, 0.24)' as never,
  },
  previewStatusText: { color: '#6cffb1', fontSize: 12, fontWeight: '800' },
  groupsGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 },
  groupsGridMobile: { gap: 10 },
  groupModule: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 360,
    minWidth: 320,
    maxWidth: 560,
    backgroundColor: palette.paper,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.bracketBorder,
    boxShadow: '0 12px 36px rgba(0,0,0,0.22)' as never,
  },
  groupHeader: {
    minHeight: 48,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(4, 76, 112, 0.62)' as never,
  },
  groupTitle: { color: palette.white, fontSize: 17, fontWeight: '900' },
  groupProgress: { color: '#d9eee4', fontSize: 11, fontWeight: '800' },
  groupMatches: { padding: 9, gap: 7 },
  groupMatchRow: {
    borderWidth: 1,
    borderColor: palette.bracketBorder,
    borderRadius: 6,
    padding: 8,
    gap: 7,
    backgroundColor: palette.paper,
  },
  groupMatchLive: { borderColor: palette.red, backgroundColor: 'rgba(255,107,89,0.12)' as never },
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
    borderColor: palette.bracketBorder,
    color: palette.ink,
    backgroundColor: 'rgba(1, 18, 55, 0.78)' as never,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '900',
    outlineStyle: 'none' as never,
  },
  compactScoreLocked: { backgroundColor: 'rgba(2, 44, 96, 0.65)' as never, color: palette.muted },
  simScoreInput: {
    borderColor: 'rgba(98, 164, 255, 0.28)' as never,
    color: palette.white,
    backgroundColor: 'rgba(5, 28, 62, 0.82)' as never,
  },
  simScoreLocked: {
    borderColor: 'rgba(98, 164, 255, 0.22)' as never,
    color: '#5ee8a0',
    backgroundColor: 'rgba(5, 35, 82, 0.78)' as never,
  },
  scoreSeparator: { color: '#9bb9ac', fontSize: 12, fontWeight: '900' },
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
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: 'rgba(1, 18, 55, 0.84)' as never,
    borderWidth: 1,
    borderColor: palette.bracketBorder,
  },
  knockoutHeading: {
    padding: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    justifyContent: 'flex-end',
    gap: 10,
    backgroundColor: 'rgba(1, 18, 55, 0.86)' as never,
    borderBottomWidth: 1,
    borderBottomColor: palette.bracketBorder,
  },
  knockoutInfoCard: {
    flex: 1,
    minWidth: 300,
    maxWidth: 760,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#9d842e',
    borderRadius: 12,
    backgroundImage:
      'linear-gradient(135deg, rgba(227,185,68,0.12), rgba(16,47,38,0.92))' as never,
  },
  knockoutInfoText: { flex: 1, color: '#bed7ce', fontSize: 11, lineHeight: 15, fontWeight: '700' },
  qualifierProgress: {
    minWidth: 70,
    alignItems: 'center',
    paddingLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(240,199,53,0.35)',
  },
  qualifierProgressValue: { color: '#6cffb1', fontSize: 15, fontWeight: '900' },
  qualifierProgressLabel: { color: '#9bb9ac', fontSize: 8, fontWeight: '800' },
  knockoutDeadlineCard: {
    minWidth: 250,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(98, 164, 255, 0.24)' as never,
    borderRadius: 12,
    backgroundColor: 'rgba(2, 44, 96, 0.76)' as never,
  },
  knockoutDeadlineCopy: { flex: 1, gap: 2 },
  knockoutDeadlineTitle: { color: palette.white, fontSize: 12, fontWeight: '900' },
  knockoutDeadlineText: { color: '#6cffb1', fontSize: 11, fontWeight: '700' },
  knockoutSubtitle: { color: palette.muted, fontSize: 13, lineHeight: 19 },
  knockoutEmpty: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: 'rgba(3, 20, 46, 0.76)' as never,
  },
  bracketPanel: {
    margin: 12,
    borderWidth: 1,
    borderColor: palette.bracketBorder,
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: 'rgba(1, 18, 55, 0.86)' as never,
  },
  bracketStageTabs: {
    minWidth: '100%',
    padding: 7,
    gap: 0,
    backgroundColor: 'rgba(1, 18, 55, 0.86)' as never,
  },
  bracketStageTab: {
    minWidth: 130,
    minHeight: 32,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1e4a3e',
    marginRight: -1,
    backgroundColor: 'rgba(1, 18, 55, 0.76)' as never,
  },
  bracketStageTabActive: {
    zIndex: 1,
    borderColor: palette.yellow,
    backgroundColor: palette.yellow,
    boxShadow: '0 8px 20px rgba(255,211,21,0.22)' as never,
  },
  bracketStageTabText: { color: '#bbd7cb', fontSize: 10, fontWeight: '900' },
  bracketStageTabTextActive: { color: palette.shell },
  bracketHint: {
    minHeight: 24,
    paddingHorizontal: 10,
    paddingBottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(1, 18, 55, 0.86)' as never,
  },
  bracketHintText: { flexShrink: 1, color: '#9bb9ac', fontSize: 9, fontWeight: '700' },
  bracketViewportContent: { minWidth: '100%', justifyContent: 'center' },
  bracketCanvas: {
    position: 'relative',
    width: BRACKET_CANVAS_WIDTH,
    height: BRACKET_CANVAS_HEIGHT,
    backgroundColor: 'rgba(1, 18, 55, 0.86)' as never,
  },
  bracketCanvasMobile: { backgroundColor: 'rgba(1, 18, 55, 0.86)' as never },
  bracketColumnLabel: {
    position: 'absolute',
    top: 4,
    width: BRACKET_CARD_WIDTH,
    alignItems: 'center',
    gap: 1,
  },
  bracketColumnTitle: {
    color: palette.white,
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  bracketColumnRange: { color: '#9bb9ac', fontSize: 7, fontWeight: '700' },
  bracketTrophy: {
    position: 'absolute',
    left: bracketX(580),
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
    backgroundColor: 'rgba(2, 44, 96, 0.78)' as never,
    borderWidth: 1,
    borderColor: '#9d842e',
  },
  bracketTrophyTitle: {
    color: palette.yellow,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  bracketTrophyDate: { color: '#6cffb1', fontSize: 8, fontWeight: '800' },
  thirdPlaceLabel: {
    position: 'absolute',
    left: bracketX(580),
    top: 366,
    width: BRACKET_CARD_WIDTH,
    alignItems: 'center',
    gap: 1,
  },
  bracketConnectorHorizontal: {
    position: 'absolute',
    height: 2,
    zIndex: 0,
    backgroundColor: '#2ed085',
  },
  bracketConnectorVertical: {
    position: 'absolute',
    width: 2,
    zIndex: 0,
    backgroundColor: '#2ed085',
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
    borderColor: '#1b4338',
    borderRadius: 5,
    padding: 3,
    backgroundColor: 'rgba(1, 24, 64, 0.86)' as never,
    gap: 2,
    shadowColor: '#132b21',
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  knockoutCardLocked: {
    opacity: 0.82,
  },
  knockoutCardHeader: {
    height: 9,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 3,
  },
  knockoutMatchNumber: { color: '#6cffb1', fontSize: 7, fontWeight: '900' },
  knockoutDate: { color: '#9bb9ac', fontSize: 6.5, fontWeight: '700' },
  knockoutTeamRow: {
    height: 16,
    borderRadius: 3,
    paddingLeft: 3,
    paddingRight: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
    backgroundColor: 'rgba(2, 35, 83, 0.84)' as never,
    borderWidth: 1,
    borderColor: '#143a2f',
  },
  knockoutTeamSelected: { borderColor: '#2ed085', backgroundColor: 'rgba(46,208,133,0.18)' as never },
  knockoutScorePairBox: {
    gap: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'transparent',
    padding: 1,
  },
  knockoutScorePairCorrect: {
    borderColor: '#21d66f',
    backgroundColor: 'rgba(33, 214, 111, 0.12)' as never,
  },
  knockoutScorePairWrong: {
    borderColor: '#ff6b59',
    backgroundColor: 'rgba(255, 107, 89, 0.12)' as never,
  },
  knockoutScoreArea: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  knockoutScoreInput: {
    width: 22,
    height: 15,
    padding: 0,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(98, 164, 255, 0.28)' as never,
    backgroundColor: 'rgba(5, 28, 62, 0.82)' as never,
    color: palette.white,
    textAlign: 'center',
    fontSize: 9,
    fontWeight: '900',
    outlineStyle: 'none' as never,
  },
  knockoutScoreInputCorrect: {
    borderColor: '#21d66f',
    backgroundColor: 'rgba(8, 74, 51, 0.92)' as never,
  },
  knockoutScoreInputWrong: {
    borderColor: '#ff6b59',
    backgroundColor: 'rgba(90, 27, 32, 0.92)' as never,
  },
  knockoutScoreInputLocked: {
    opacity: 0.74,
    backgroundColor: 'rgba(7, 20, 48, 0.9)' as never,
  },
  knockoutAdvanceMarker: { width: 10, height: 15, alignItems: 'center', justifyContent: 'center' },
  penaltyAdvanceRow: {
    minHeight: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  penaltyAdvanceLabel: {
    width: 40,
    color: '#9bb9ac',
    fontSize: 7,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  penaltyAdvanceButton: {
    flex: 1,
    minWidth: 0,
    height: 17,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(98, 164, 255, 0.24)' as never,
    backgroundColor: 'rgba(5, 28, 62, 0.82)' as never,
  },
  penaltyAdvanceButtonActive: {
    borderColor: '#21d66f',
    backgroundColor: 'rgba(46, 208, 133, 0.28)' as never,
  },
  penaltyAdvanceButtonText: {
    color: palette.white,
    fontSize: 8,
    fontWeight: '900',
  },
  knockoutFooter: {
    padding: 9,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(98, 164, 255, 0.24)' as never,
    backgroundColor: 'rgba(3, 20, 46, 0.76)' as never,
  },
  knockoutFooterText: {
    flex: 1,
    minWidth: 240,
    color: '#9bb9ac',
    fontSize: 12,
    fontWeight: '700',
  },
  knockoutFooterActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
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
  shareBracketButton: {
    minHeight: 42,
    paddingHorizontal: 15,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#25d366',
  },
  shareBracketButtonText: { color: palette.shell, fontSize: 13, fontWeight: '900' },
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
  publicBracketPickCorrect: {
    borderColor: '#21d66f',
    backgroundColor: 'rgba(8, 74, 51, 0.74)' as never,
  },
  publicBracketPickWrong: {
    borderColor: '#ff6b59',
    backgroundColor: 'rgba(90, 27, 32, 0.74)' as never,
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
