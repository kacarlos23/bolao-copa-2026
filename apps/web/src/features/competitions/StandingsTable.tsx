import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StandingRowDto } from '@bolao/shared';
import { TeamBadge } from '../../components/TeamBadge';
import { RouteLink } from '../../navigation/RouteLink';
import { pathForCompetitionTeam } from '../../navigation/routes';
import { theme } from '../../theme/tokens';

const columns = [
  ['points', 'PTS', 'Pontos', (row: StandingRowDto) => row.points, true], ['played', 'J', 'Jogos', (row: StandingRowDto) => row.played], ['wins', 'V', 'Vitórias', (row: StandingRowDto) => row.wins], ['draws', 'E', 'Empates', (row: StandingRowDto) => row.draws], ['losses', 'D', 'Derrotas', (row: StandingRowDto) => row.losses], ['goalsFor', 'GP', 'Gols pró', (row: StandingRowDto) => row.goalsFor], ['goalsAgainst', 'GC', 'Gols contra', (row: StandingRowDto) => row.goalsAgainst], ['goalDifference', 'SG', 'Saldo de gols', (row: StandingRowDto) => row.goalDifference], ['yellowCards', 'CA', 'Cartões amarelos', (row: StandingRowDto) => row.yellowCards], ['redCards', 'CV', 'Cartões vermelhos', (row: StandingRowDto) => row.redCards], ['percentage', '%', 'Aproveitamento', (row: StandingRowDto) => row.played ? Math.round(row.points / (row.played * 3) * 100) : 0],
] as const;

type Zone = 'LIBERTADORES' | 'PRE_LIBERTADORES' | 'SUDAMERICANA' | 'RELEGATION';
const labels: Record<Zone, string> = { LIBERTADORES: 'Libertadores', PRE_LIBERTADORES: 'Pré-Libertadores', SUDAMERICANA: 'Sul-Americana', RELEGATION: 'Rebaixamento' };
const resultLabel = { W: 'Vitória', D: 'Empate', L: 'Derrota' } as const;
const sticky = Platform.OS === 'web' ? ({ position: 'sticky' } as never) : {};

function zone(overallRank: number): Zone | null {
  if (overallRank <= 4) return 'LIBERTADORES';
  if (overallRank <= 6) return 'PRE_LIBERTADORES';
  if (overallRank <= 12) return 'SUDAMERICANA';
  return overallRank >= 17 ? 'RELEGATION' : null;
}

export function StandingsTable({ rows, competitionSlug, onOpenTeam }: { rows: StandingRowDto[]; competitionSlug: string; onOpenTeam?: (teamId: string) => void }) {
  return <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.scroller} accessibilityLabel="Classificação esportiva. Deslize horizontalmente para ver todas as estatísticas.">
    <View style={styles.table} accessibilityRole="summary">
      <View style={[styles.row, styles.header]} accessibilityRole="header">
        <View style={[styles.club, styles.clubHeader]}><Text style={styles.headerText}>Classificação</Text></View>
        {columns.map(([key, label, title, , points]) => <Text key={key} accessibilityLabel={title} style={[styles.stat, styles.headerText, points && styles.points]}>{label}</Text>)}
        <Text accessibilityLabel="Resultados recentes" style={[styles.formCell, styles.headerText]}>Recentes</Text><Text accessibilityLabel="Próximo adversário" style={[styles.nextCell, styles.headerText]}>Próx.</Text>
      </View>
      {rows.map((row, index) => {
        const currentZone = zone(row.overallRank ?? row.rank); const previousZone = index ? zone(rows[index - 1].overallRank ?? rows[index - 1].rank) : null;
        const club = <><Text style={styles.position}>{row.rank}</Text><TeamBadge team={row.team} kind="crest" size={30} /><Text numberOfLines={1} style={styles.clubName}>{row.team.name}</Text></>;
        const clubStyle = [styles.club, row.rank % 2 === 0 && styles.clubEven, currentZone && styles[currentZone]];
        return <View key={`${row.group}:${row.team.id}`}>
          {currentZone && currentZone !== previousZone ? <View style={[styles.zoneLabel, styles[currentZone]]}><Text style={[styles.zoneLabelText, styles[`${currentZone}Text`]]}>{labels[currentZone]} · posição geral</Text></View> : null}
          <View style={[styles.row, row.rank % 2 === 0 && styles.even]} accessibilityLabel={`${row.rank}º, ${row.team.name}, ${row.points} pontos`}>
            {onOpenTeam ? <RouteLink href={pathForCompetitionTeam(competitionSlug, row.team.id)} accessibilityLabel={`Abrir perfil de ${row.team.name}`} onActivate={() => onOpenTeam(row.team.id)} style={clubStyle}>{club}</RouteLink> : <View style={clubStyle}>{club}</View>}
            {columns.map(([key, , title, value, points]) => <Text key={key} accessibilityLabel={title} style={[styles.stat, points && styles.points]}>{value(row)}</Text>)}
            <View style={styles.formCell}>{row.lastFive.length ? <View style={styles.form}>{row.lastFive.map((result, formIndex) => <Text key={`${result}-${formIndex}`} accessibilityLabel={resultLabel[result]} style={[styles.dot, result === 'W' ? styles.win : result === 'D' ? styles.draw : styles.loss]}>{result}</Text>)}</View> : <Text style={styles.neutral}>—</Text>}</View>
            <View style={styles.nextCell}>{row.nextOpponent ? <View accessibilityLabel={`Próximo adversário: ${row.nextOpponent.name}`}><TeamBadge team={row.nextOpponent} kind="crest" size={28} /></View> : <Text style={styles.neutral}>—</Text>}</View>
          </View>
        </View>;
      })}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { maxWidth: '100%' }, scroller: { minWidth: '100%' }, table: { minWidth: 1040, paddingBottom: 2, width: '100%' }, row: { alignItems: 'center', backgroundColor: theme.color.canvas, flexDirection: 'row', minHeight: 56 }, even: { backgroundColor: theme.color.surface }, header: { backgroundColor: theme.color.surfaceRaised, minHeight: 46 },
  club: { ...sticky, alignItems: 'center', backgroundColor: theme.color.canvas, borderLeftWidth: 3, flexDirection: 'row', gap: 8, left: 0, minWidth: 176, paddingHorizontal: 10, width: 176, zIndex: 3 }, clubEven: { backgroundColor: theme.color.surface }, clubHeader: { backgroundColor: theme.color.surfaceRaised, borderLeftColor: 'transparent', zIndex: 5 }, position: { color: theme.color.accent, fontSize: 12, fontWeight: '900', textAlign: 'center', width: 20 }, clubName: { color: theme.color.text, flex: 1, fontSize: 12, fontWeight: '800' },
  stat: { color: theme.color.textMuted, fontSize: 12, fontWeight: '800', textAlign: 'center', width: 50 }, points: { color: theme.color.accent, fontWeight: '900' }, headerText: { color: theme.color.textMuted, fontSize: 10, fontWeight: '900' }, formCell: { alignItems: 'center', justifyContent: 'center', width: 118 }, form: { flexDirection: 'row', gap: 4 }, dot: { borderRadius: 10, color: '#061923', fontSize: 9, fontWeight: '900', height: 19, lineHeight: 19, overflow: 'hidden', textAlign: 'center', width: 19 }, win: { backgroundColor: theme.color.success }, draw: { backgroundColor: '#9aabba' }, loss: { backgroundColor: theme.color.danger }, nextCell: { alignItems: 'center', justifyContent: 'center', width: 58 }, neutral: { color: theme.color.textMuted, fontWeight: '800' },
  zoneLabel: { borderLeftWidth: 3, justifyContent: 'flex-end', minHeight: 28, paddingBottom: 4, paddingLeft: 10 }, zoneLabelText: { fontSize: 10, fontWeight: '900' }, LIBERTADORES: { borderLeftColor: theme.color.accent }, PRE_LIBERTADORES: { borderLeftColor: theme.color.gold }, SUDAMERICANA: { borderLeftColor: theme.color.info }, RELEGATION: { borderLeftColor: theme.color.danger }, LIBERTADORESText: { color: theme.color.accent }, PRE_LIBERTADORESText: { color: theme.color.gold }, SUDAMERICANAText: { color: theme.color.info }, RELEGATIONText: { color: theme.color.danger },
});
