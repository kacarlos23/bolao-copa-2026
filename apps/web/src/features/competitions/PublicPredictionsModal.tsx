import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { MatchDto, PublicMatchPredictionDto, ScoreType } from '@bolao/shared';
import { TeamBadge } from '../../components/TeamBadge';
import { theme } from '../../theme/tokens';
import { predictionPresentation } from './publicPredictionsPresentation';

function officialScore(match: MatchDto) {
  const home =
    match.status === 'FINISHED' ? (match.finalHomeScore ?? match.homeScore) : match.homeScore;
  const away =
    match.status === 'FINISHED' ? (match.finalAwayScore ?? match.awayScore) : match.awayScore;
  return home == null || away == null ? null : `${home} × ${away}`;
}

export function PublicPredictionsModal({
  match,
  predictions,
  currentUserId,
  loading,
  error,
  onClose,
}: {
  match: MatchDto | null;
  predictions: PublicMatchPredictionDto[];
  currentUserId: string;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const score = match ? officialScore(match) : null;
  return (
    <Modal transparent animationType="fade" visible={Boolean(match)} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={styles.card}
          accessibilityViewIsModal
          accessibilityLabel="Palpites dos participantes"
        >
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text role="heading" aria-level={2} style={styles.title}>
                Palpites dos participantes
              </Text>
              <Text style={styles.subtitle}>Liberados após o encerramento do prazo</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar modal de palpites"
              onPress={onClose}
              style={styles.closeButton}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          {match ? (
            <View style={styles.matchup}>
              <View style={styles.team}>
                <TeamBadge team={match.homeTeam} kind="crest" size={34} />
                <Text style={styles.teamName} numberOfLines={2}>
                  {match.homeTeam.name}
                </Text>
              </View>
              <View style={styles.scoreBlock}>
                <Text style={styles.score}>{score ?? '×'}</Text>
                <Text style={styles.scoreStatus}>
                  {score
                    ? match.status === 'LIVE'
                      ? 'AO VIVO'
                      : 'PLACAR OFICIAL'
                    : 'AGUARDANDO PLACAR'}
                </Text>
              </View>
              <View style={styles.team}>
                <TeamBadge team={match.awayTeam} kind="crest" size={34} />
                <Text style={styles.teamName} numberOfLines={2}>
                  {match.awayTeam.name}
                </Text>
              </View>
            </View>
          ) : null}

          <View style={styles.legend} accessibilityLabel="Legenda dos palpites">
            {(Object.keys(predictionPresentation) as ScoreType[]).map((type) => {
              const presentation = predictionPresentation[type];
              return (
                <View key={type} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: presentation.borderColor }]} />
                  <Text style={styles.legendText}>{presentation.label}</Text>
                </View>
              );
            })}
          </View>

          {loading ? <ActivityIndicator color={theme.color.accent} style={styles.loading} /> : null}
          {!loading && error ? <Text style={styles.error}>{error}</Text> : null}
          {!loading && !error ? (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {predictions.map((prediction) => {
                const presentation = prediction.scoreType
                  ? predictionPresentation[prediction.scoreType]
                  : null;
                return (
                  <View
                    key={prediction.id}
                    style={[
                      styles.prediction,
                      presentation && {
                        backgroundColor: presentation.backgroundColor,
                        borderColor: presentation.borderColor,
                      },
                    ]}
                    accessibilityLabel={`${prediction.user.nickname}, ${prediction.predictedHomeScore} a ${prediction.predictedAwayScore}${presentation ? `, ${presentation.label}` : ''}`}
                  >
                    <View style={styles.participant}>
                      <Text style={styles.nickname} numberOfLines={1}>
                        {prediction.user.nickname}
                      </Text>
                      {prediction.userId === currentUserId ? (
                        <Text style={styles.you}>VOCÊ</Text>
                      ) : null}
                    </View>
                    <Text style={styles.predictionScore}>
                      {prediction.predictedHomeScore} × {prediction.predictedAwayScore}
                    </Text>
                    <Text style={styles.category}>{presentation?.shortLabel ?? 'Aguardando'}</Text>
                  </View>
                );
              })}
              {!predictions.length ? (
                <Text style={styles.empty}>Nenhum palpite enviado para esta partida.</Text>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 8, 28, 0.78)',
    flex: 1,
    justifyContent: 'center',
    padding: theme.space.lg,
  },
  card: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    maxHeight: '88%',
    maxWidth: 720,
    padding: theme.space.lg,
    width: '100%',
  },
  header: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  headerCopy: { flex: 1, paddingRight: theme.space.md },
  title: { color: theme.color.text, fontSize: 21, fontWeight: '900' },
  subtitle: { color: theme.color.textMuted, fontSize: 12, marginTop: 4 },
  closeButton: {
    alignItems: 'center',
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    height: theme.touchTarget,
    justifyContent: 'center',
    width: theme.touchTarget,
  },
  closeText: { color: theme.color.text, fontSize: 28, lineHeight: 30 },
  matchup: {
    alignItems: 'center',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: theme.space.md,
    justifyContent: 'space-between',
    paddingVertical: theme.space.lg,
  },
  team: { alignItems: 'center', flex: 1, gap: 6 },
  teamName: { color: theme.color.text, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  scoreBlock: { alignItems: 'center', minWidth: 104 },
  score: { color: theme.color.text, fontSize: 24, fontWeight: '900' },
  scoreStatus: {
    color: theme.color.textMuted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.6,
    marginTop: 3,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.md,
    paddingVertical: theme.space.md,
  },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  legendDot: { borderRadius: 999, height: 9, width: 9 },
  legendText: { color: theme.color.textMuted, fontSize: 10, fontWeight: '700' },
  loading: { marginVertical: theme.space.xl },
  error: { color: theme.color.danger, fontWeight: '700', paddingVertical: theme.space.lg },
  list: { maxHeight: 410 },
  listContent: { gap: theme.space.sm, paddingBottom: theme.space.xs },
  prediction: {
    alignItems: 'center',
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: theme.space.md,
    minHeight: 58,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  participant: { flex: 1, minWidth: 0 },
  nickname: { color: theme.color.text, fontSize: 13, fontWeight: '900' },
  you: {
    color: theme.color.gold,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginTop: 3,
  },
  predictionScore: {
    color: theme.color.text,
    fontSize: 17,
    fontWeight: '900',
    minWidth: 62,
    textAlign: 'center',
  },
  category: {
    color: theme.color.text,
    fontSize: 10,
    fontWeight: '800',
    minWidth: 66,
    textAlign: 'right',
  },
  empty: { color: theme.color.textMuted, paddingVertical: theme.space.xl, textAlign: 'center' },
});
