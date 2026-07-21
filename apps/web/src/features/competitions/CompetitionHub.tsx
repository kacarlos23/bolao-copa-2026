import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CompetitionDto } from '@bolao/shared';
import { useCompetition } from '../../app/CompetitionContext';
import { AsyncState } from '../../components/AsyncState';
import { normalizeCapabilities } from '../../app/CompetitionContext';
import { pathForCompetition } from '../../navigation/routes';
import { RouteLink } from '../../navigation/RouteLink';
import { theme } from '../../theme/tokens';

function competitionKind(item: CompetitionDto) {
  const capabilities = normalizeCapabilities(item.capabilities, null);
  if (capabilities.has('LEAGUE')) return 'Liga · pontos corridos';
  if (capabilities.has('GROUPS') && capabilities.has('KNOCKOUT')) return 'Grupos · mata-mata';
  if (capabilities.has('KNOCKOUT')) return 'Mata-mata';
  return 'Competição';
}

export function CompetitionHub({ onOpen }: { onOpen: (competition: CompetitionDto) => boolean }) {
  const context = useCompetition();
  const [openingId, setOpeningId] = useState('');

  function openCompetition(item: CompetitionDto) {
    setOpeningId(item.id);
    if (!onOpen(item)) setOpeningId('');
  }

  return (
    <View style={styles.page} accessibilityLabel="Central de competições">
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>CENTRAL ESPORTIVA</Text>
        <Text role="heading" aria-level={1} style={styles.title}>
          Competições
        </Text>
        <Text style={styles.subtitle}>
          Escolha um campeonato para ver somente os jogos, palpites, classificação e ranking daquele
          contexto.
        </Text>
      </View>

      <AsyncState
        status={
          context.error
            ? 'error'
            : context.loading && !context.competitions.length
              ? 'loading'
              : context.competitions.length
                ? 'success'
                : 'empty'
        }
        error={context.error}
        emptyTitle="Nenhuma competição publicada"
        emptyMessage="Quando uma temporada for liberada, ela aparecerá aqui."
        onRetry={context.retry}
        skeletonLines={3}
      >
        <View style={styles.list} role="list">
          {context.competitions.map((item) => {
            const selected = item.id === context.competition?.id;
            const legacy = item.capabilities?.workspace === 'WORLD_CUP_LEGACY';
            const kind = competitionKind(item);
            const accessibleLabel = [
              `${openingId === item.id ? 'Abrindo' : 'Abrir'} ${item.name}`,
              legacy ? 'área legada' : '',
              kind,
              selected ? 'competição atual' : '',
              selected && context.season ? context.season.name : '',
            ]
              .filter(Boolean)
              .join(', ');
            const rowContent = (
              <>
                <View
                  style={[styles.icon, legacy && styles.iconLegacy]}
                  accessibilityElementsHidden
                >
                  <Ionicons
                    name={legacy ? 'football-outline' : 'shield-outline'}
                    size={22}
                    color={legacy ? theme.color.gold : theme.color.accent}
                  />
                </View>
                <View style={styles.identity}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name}>{item.name}</Text>
                    {legacy ? <Text style={styles.legacy}>LEGADO</Text> : null}
                    {selected ? <Text style={styles.current}>ATUAL</Text> : null}
                  </View>
                  <Text style={styles.meta}>{kind}</Text>
                  {selected && context.season ? (
                    <Text style={styles.season}>{context.season.name}</Text>
                  ) : null}
                </View>
                <View style={styles.openAction}>
                  <Text style={styles.openText}>
                    {openingId === item.id ? 'Abrindo...' : 'Abrir'}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={theme.color.textMuted} />
                </View>
              </>
            );
            const rowStyle = ({ pressed }: { pressed: boolean }) => [
              styles.row,
              selected && styles.rowSelected,
              pressed && styles.rowPressed,
            ];
            return (
              <RouteLink
                key={item.id}
                href={pathForCompetition(item.slug)}
                accessibilityLabel={accessibleLabel}
                disabled={Boolean(openingId)}
                onActivate={() => openCompetition(item)}
                style={rowStyle}
              >
                {rowContent}
              </RouteLink>
            );
          })}
        </View>
      </AsyncState>

      <View style={styles.help}>
        <Ionicons name="information-circle-outline" size={20} color={theme.color.info} />
        <Text style={styles.helpText}>
          A Copa do Mundo 2026 permanece disponível como histórico legado. O nome e a navegação
          principal agora pertencem ao Bolão Sirel.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    gap: theme.space.xxl,
    marginHorizontal: 'auto',
    maxWidth: 980,
    paddingBottom: 56,
    width: '100%',
  },
  heading: { maxWidth: 680 },
  eyebrow: { color: theme.color.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.35 },
  title: {
    color: theme.color.text,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -0.7,
    marginTop: 5,
  },
  subtitle: { color: theme.color.textMuted, fontSize: 15, lineHeight: 23, marginTop: 8 },
  list: { borderTopColor: theme.color.borderMuted, borderTopWidth: 1 },
  row: {
    alignItems: 'center',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: theme.space.lg,
    minHeight: 92,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.md,
  },
  rowSelected: { backgroundColor: 'rgba(52, 209, 123, 0.06)' },
  rowPressed: { backgroundColor: 'rgba(114, 183, 242, 0.08)' },
  icon: {
    alignItems: 'center',
    backgroundColor: 'rgba(52, 209, 123, 0.1)',
    borderRadius: 14,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  iconLegacy: { backgroundColor: 'rgba(244, 214, 92, 0.1)' },
  identity: { flex: 1, minWidth: 0 },
  nameRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  name: { color: theme.color.text, fontSize: 16, fontWeight: '900' },
  legacy: {
    backgroundColor: 'rgba(244, 214, 92, 0.14)',
    borderRadius: theme.radius.pill,
    color: theme.color.gold,
    fontSize: 8,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  current: { color: theme.color.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  meta: { color: theme.color.textMuted, fontSize: 12, marginTop: 5 },
  season: { color: theme.color.info, fontSize: 11, fontWeight: '800', marginTop: 3 },
  openAction: { alignItems: 'center', flexDirection: 'row', gap: 4, minHeight: theme.touchTarget },
  openText: { color: theme.color.text, fontSize: 12, fontWeight: '900' },
  help: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(114, 183, 242, 0.07)',
    borderLeftColor: theme.color.info,
    borderLeftWidth: 3,
    flexDirection: 'row',
    gap: 10,
    padding: theme.space.lg,
  },
  helpText: { color: theme.color.textMuted, flex: 1, fontSize: 12, lineHeight: 19 },
});
