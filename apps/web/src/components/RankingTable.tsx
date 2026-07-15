import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { RankingRowDto } from '@bolao/shared';
import { theme } from '../theme/tokens';

export const rankingTieBreakers = [
  'Mais pontos',
  'Mais placares exatos',
  'Mais resultados corretos',
  'Mais gols de um time',
  'Menos erros',
  'Posição compartilhada se todos os critérios empatarem',
] as const;

export function movementLabel(delta: number | null | undefined) {
  if (delta == null) return 'Sem comparação anterior';
  if (delta > 0) return `Subiu ${delta} ${delta === 1 ? 'posição' : 'posições'}`;
  if (delta < 0) return `Caiu ${Math.abs(delta)} ${delta === -1 ? 'posição' : 'posições'}`;
  return 'Manteve a posição';
}

export function RankingTable({
  ranking,
  currentUserId,
  previousRanks = new Map(),
  roundRanking = [],
}: {
  ranking: RankingRowDto[];
  currentUserId: string;
  previousRanks?: ReadonlyMap<string, number>;
  roundRanking?: RankingRowDto[];
}) {
  const { width } = useWindowDimensions();
  const compact = width < 768;
  const current = ranking.find((row) => row.userId === currentUserId);
  const currentIndex = current ? ranking.findIndex((row) => row.userId === current.userId) : -1;
  const rival = currentIndex > 0 ? ranking[currentIndex - 1] : null;
  const distance = current && rival ? Math.max(0, rival.points - current.points) : 0;
  const roundLeader = roundRanking[0];
  const currentRound = roundRanking.find((row) => row.userId === currentUserId);
  const previousCurrentRank = current ? previousRanks.get(current.userId) : undefined;
  const movement = current && previousCurrentRank != null ? previousCurrentRank - current.rank : null;

  return (
    <View style={styles.section} accessibilityLabel="Ranking do bolão">
      {current ? (
        <View style={styles.currentSummary} accessibilityRole="summary">
          <View>
            <Text style={styles.eyebrow}>SUA POSIÇÃO</Text>
            <Text style={styles.currentPosition}>#{current.rank} · {current.points} pts</Text>
          </View>
          <View style={styles.summaryDetails}>
            <Text style={styles.summaryText}>{movementLabel(movement)}</Text>
            <Text style={styles.summaryText}>
              {rival ? `${distance} pts para ${rival.nickname}` : 'Você está na liderança'}
            </Text>
            <Text style={styles.summaryText}>
              {currentRound ? `${currentRound.points} pts na rodada` : 'Sem pontos na rodada'}
            </Text>
          </View>
        </View>
      ) : null}

      {roundLeader ? (
        <Text style={styles.roundLeader} accessibilityLabel={`Líder da rodada: ${roundLeader.nickname}, ${roundLeader.points} pontos`}>
          Líder da rodada {roundRanking.some((row) => row.hasLiveData) ? '· provisório' : '· consolidado'} · {roundLeader.nickname} · {roundLeader.points} pts
        </Text>
      ) : null}

      {compact ? (
        <View style={styles.mobileList} accessibilityRole="list">
          {ranking.map((row) => {
            const mine = row.userId === currentUserId;
            const previousRank = previousRanks.get(row.userId);
            const delta = previousRank == null ? null : previousRank - row.rank;
            return (
              <View
                key={row.userId}
                accessibilityRole="listitem"
                style={[styles.mobileRow, mine && styles.mine]}
                accessibilityLabel={`${row.rank}º, ${row.nickname}, ${row.points} pontos, ${movementLabel(delta)}`}
              >
                <Text style={styles.rank}>#{row.rank}</Text>
                <View style={styles.person}>
                  <Text style={styles.name}>{row.nickname}{mine ? ' · Você' : ''}</Text>
                  <Text style={styles.movement}>{movementLabel(delta)}</Text>
                </View>
                <Text style={styles.points}>{row.points} pts</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <ScrollView horizontal contentContainerStyle={styles.tableScroller}>
          <View style={styles.table} accessibilityRole="list">
            <View style={[styles.row, styles.header]} accessibilityRole="listitem">
              <Text style={[styles.cell, styles.position]}>#</Text>
              <Text style={[styles.cell, styles.player]}>Participante</Text>
              <Text style={styles.cell}>Mov.</Text>
              <Text style={styles.cell}>Rodada</Text>
              <Text style={styles.cell}>Exatos</Text>
              <Text style={styles.cell}>Resultados</Text>
              <Text style={[styles.cell, styles.points]}>Pontos</Text>
            </View>
            {ranking.map((row) => {
              const mine = row.userId === currentUserId;
              const previousRank = previousRanks.get(row.userId);
              const delta = previousRank == null ? null : previousRank - row.rank;
              const round = roundRanking.find((item) => item.userId === row.userId);
              return (
                <View key={row.userId} accessibilityRole="listitem" style={[styles.row, mine && styles.mine]}>
                  <Text style={[styles.cell, styles.position]}>{row.rank}</Text>
                  <Text style={[styles.cell, styles.player, styles.stickyPlayer]}>{row.nickname}{mine ? ' · Você' : ''}</Text>
                  <Text style={styles.cell}>{delta > 0 ? `↑ ${delta}` : delta < 0 ? `↓ ${Math.abs(delta)}` : '—'}</Text>
                  <Text style={styles.cell}>{round?.points ?? '—'}</Text>
                  <Text style={styles.cell}>{row.exactScores}</Text>
                  <Text style={styles.cell}>{row.resultHits}</Text>
                  <Text style={[styles.cell, styles.points]}>{row.points}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      <View style={styles.criteria}>
        <Text style={styles.criteriaTitle}>Critérios de desempate</Text>
        <Text style={styles.criteriaText}>{rankingTieBreakers.join(' → ')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.space.md },
  currentSummary: {
    alignItems: 'center',
    backgroundColor: 'rgba(52, 209, 123, 0.10)',
    borderLeftColor: theme.color.accent,
    borderLeftWidth: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.lg,
    justifyContent: 'space-between',
    padding: theme.space.lg,
  },
  eyebrow: { color: theme.color.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  currentPosition: { color: theme.color.text, fontSize: 22, fontWeight: '900', marginTop: 2 },
  summaryDetails: { alignItems: 'flex-end', gap: 3 },
  summaryText: { color: theme.color.textMuted, fontSize: 12, fontWeight: '700' },
  roundLeader: { color: theme.color.gold, fontWeight: '900' },
  tableScroller: { minWidth: '100%' },
  table: { minWidth: 800, width: '100%' },
  row: {
    alignItems: 'center',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 52,
  },
  header: { backgroundColor: theme.color.surface, minHeight: theme.touchTarget },
  cell: { color: theme.color.textMuted, fontSize: 12, paddingHorizontal: 8, textAlign: 'right', width: 90 },
  position: { color: theme.color.accent, fontWeight: '900', textAlign: 'center', width: 46 },
  player: { color: theme.color.text, flex: 1, fontWeight: '800', minWidth: 190, textAlign: 'left' },
  stickyPlayer: { backgroundColor: theme.color.canvas },
  points: { color: theme.color.gold, fontWeight: '900' },
  mine: { backgroundColor: 'rgba(52, 209, 123, 0.12)' },
  mobileList: { gap: 1 },
  mobileRow: {
    alignItems: 'center',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: theme.space.sm,
    minHeight: 62,
    paddingHorizontal: theme.space.sm,
  },
  rank: { color: theme.color.accent, fontWeight: '900', width: 38 },
  person: { flex: 1 },
  name: { color: theme.color.text, fontWeight: '800' },
  movement: { color: theme.color.textMuted, fontSize: 11, marginTop: 2 },
  criteria: { borderTopColor: theme.color.borderMuted, borderTopWidth: 1, gap: 4, paddingTop: theme.space.md },
  criteriaTitle: { color: theme.color.text, fontSize: 12, fontWeight: '900' },
  criteriaText: { color: theme.color.textMuted, fontSize: 11, lineHeight: 17 },
});
