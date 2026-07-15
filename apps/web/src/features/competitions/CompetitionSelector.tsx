import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CompetitionDto, SeasonDto } from '@bolao/shared';
import { useCompetition } from '../../app/CompetitionContext';
import { AsyncState } from '../../components/AsyncState';
import { theme } from '../../theme/tokens';

export function CompetitionSelector({
  canLeave = () => true,
  onCompetitionChange,
  onSeasonChange,
}: {
  canLeave?: () => boolean;
  onCompetitionChange?: (competition: CompetitionDto) => void;
  onSeasonChange?: (season: SeasonDto) => void;
}) {
  const context = useCompetition();

  function confirmLeave() {
    if (canLeave()) return true;
    if (typeof window === 'undefined') return false;
    return window.confirm('Há alterações não salvas. Deseja trocar de competição e manter o rascunho neste navegador?');
  }

  return (
    <View style={styles.shell} accessibilityLabel="Competição e temporada">
      <View style={styles.heading}>
        <View>
          <Text style={styles.eyebrow}>CONTEXTO DO BOLÃO</Text>
          <Text style={styles.title}>{context.season?.name ?? 'Escolha uma temporada'}</Text>
        </View>
        <Text style={styles.capabilities}>
          {[...context.capabilities].join(' · ') || 'Carregando formato'}
        </Text>
      </View>
      <AsyncState status={context.error ? 'error' : context.loading ? 'loading' : 'success'} error={context.error} onRetry={context.retry}>
        <ScrollView
          horizontal
          accessibilityRole="tablist"
          contentContainerStyle={styles.rail}
          showsHorizontalScrollIndicator={false}
        >
          {context.competitions.map((item) => {
            const selected = item.id === context.competition?.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => {
                  if (confirmLeave()) {
                    onCompetitionChange?.(item);
                    void context.selectCompetition(item.id);
                  }
                }}
                style={[styles.tab, selected && styles.tabSelected]}
              >
                <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{item.name}</Text>
              </Pressable>
            );
          })}
          {context.seasons.length > 1
            ? context.seasons.map((item) => {
                const selected = item.id === context.season?.id;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      if (!confirmLeave()) return;
                      context.selectSeason(item.id);
                      onSeasonChange?.(item);
                    }}
                    style={[styles.season, selected && styles.seasonSelected]}
                  >
                    <Text style={styles.seasonText}>{item.year ?? item.name}</Text>
                  </Pressable>
                );
              })
            : null}
        </ScrollView>
      </AsyncState>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    gap: theme.space.sm,
    marginHorizontal: 'auto',
    maxWidth: 1440,
    paddingHorizontal: theme.space.xl,
    paddingVertical: theme.space.md,
    width: '100%',
  },
  heading: { alignItems: 'flex-end', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  eyebrow: { color: theme.color.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: theme.color.text, fontSize: 16, fontWeight: '900', marginTop: 2 },
  capabilities: { color: theme.color.textMuted, fontSize: 10, fontWeight: '800' },
  rail: { alignItems: 'center', gap: theme.space.sm },
  tab: {
    borderColor: theme.color.border,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  tabSelected: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  tabText: { color: theme.color.textMuted, fontWeight: '800' },
  tabTextSelected: { color: theme.color.accentInk },
  season: { justifyContent: 'center', minHeight: theme.touchTarget, paddingHorizontal: 10 },
  seasonSelected: { borderBottomColor: theme.color.gold, borderBottomWidth: 2 },
  seasonText: { color: theme.color.text, fontWeight: '800' },
});
