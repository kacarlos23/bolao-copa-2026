import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, type CompetitionFeatureFlags } from './api';
import { normalizeCapabilities } from './app/CompetitionContext';

const emptyFlags: CompetitionFeatureFlags = {
  readEnabled: false,
  writeEnabled: false,
  uiEnabled: false,
  syncEnabled: false,
  reason: 'Canário administrativo inicial',
  updatedAt: new Date(0).toISOString(),
  updatedById: null,
};

export function BrasileiraoCanaryAdmin() {
  const [seasonId, setSeasonId] = useState('');
  const [flags, setFlags] = useState(emptyFlags);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const competitions = await api.competitions();
      const competition = competitions.competitions.find((item) =>
        normalizeCapabilities(item.capabilities, null).has('LEAGUE'),
      );
      const seasons = competition ? await api.competitionSeasons(competition.slug) : null;
      const season =
        seasons?.seasons.find((item) => item.status === 'ACTIVE') ?? seasons?.seasons[0];
      if (!season) {
        setSeasonId('');
        return;
      }
      setSeasonId(season.id);
      setFlags((await api.competitionFeatures(season.id)).flags);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o canário.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function prepare() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await api.prepareBrasileirao2026();
      setSeasonId(result.seasonId);
      setMessage(`Temporada preparada a partir da rodada ${result.startsAtRound}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A preparação oficial falhou.');
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!seasonId) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await api.updateCompetitionFeatures(seasonId, {
        readEnabled: flags.readEnabled,
        writeEnabled: flags.writeEnabled,
        uiEnabled: flags.uiEnabled,
        syncEnabled: flags.syncEnabled,
        reason: 'Ensaio administrativo e rollback independente das flags',
      });
      setFlags(result.flags);
      setMessage('Flags salvas com auditoria.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar as flags.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.panel} accessibilityLabel="Canário Brasileirão 2026">
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>BRASILEIRÃO 2026</Text>
          <Text style={styles.title}>Canário e rollback</Text>
        </View>
        {loading ? <ActivityIndicator color="#34d17b" /> : null}
      </View>
      <Text style={styles.copy}>
        A preparação consulta a CBF antes de escrever. Leitura, palpites e UI são liberados de forma
        independente.
      </Text>
      {!seasonId ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void prepare()}
          style={styles.primaryButton}
          disabled={loading}
        >
          <Text style={styles.primaryText}>Preparar com fonte oficial</Text>
        </Pressable>
      ) : (
        <>
          <View style={styles.flags}>
            {(
              [
                ['readEnabled', 'Leitura'],
                ['writeEnabled', 'Palpites'],
                ['uiEnabled', 'UI pública'],
                ['syncEnabled', 'Sincronização'],
              ] as const
            ).map(([key, label]) => (
              <Pressable
                key={key}
                accessibilityLabel={`Flag ${label}`}
                accessibilityRole="button"
                onPress={() => setFlags((current) => ({ ...current, [key]: !current[key] }))}
                style={[styles.flag, flags[key] && styles.flagEnabled]}
              >
                <Text style={[styles.flagLabel, flags[key] && styles.flagLabelEnabled]}>
                  {label}
                </Text>
                <Text style={[styles.flagState, flags[key] && styles.flagLabelEnabled]}>
                  {flags[key] ? 'ON' : 'OFF'}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void save()}
              style={styles.primaryButton}
              disabled={loading}
            >
              <Text style={styles.primaryText}>Salvar flags</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setFlags((current) => ({
                  ...current,
                  readEnabled: false,
                  writeEnabled: false,
                  uiEnabled: false,
                  syncEnabled: false,
                }));
              }}
              style={styles.rollbackButton}
            >
              <Text style={styles.rollbackText}>Preparar rollback</Text>
            </Pressable>
          </View>
        </>
      )}
      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'rgba(2, 36, 76, 0.78)',
    borderColor: 'rgba(83, 142, 195, 0.4)',
    borderRadius: 18,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  kicker: { color: '#58e09a', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#f5f9ff', fontSize: 20, fontWeight: '900', marginTop: 3 },
  copy: { color: '#b5c5d9', lineHeight: 20 },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flag: {
    backgroundColor: '#102d51',
    borderColor: '#3d6289',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 18,
    justifyContent: 'space-between',
    minWidth: 130,
    padding: 11,
  },
  flagEnabled: { backgroundColor: 'rgba(52, 209, 123, 0.14)', borderColor: '#34d17b' },
  flagLabel: { color: '#b5c5d9', fontWeight: '800' },
  flagState: { color: '#8198b4', fontSize: 11, fontWeight: '900' },
  flagLabelEnabled: { color: '#69e7a4' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#34d17b',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  primaryText: { color: '#031c27', fontWeight: '900' },
  rollbackButton: {
    alignItems: 'center',
    borderColor: '#f0ba55',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  rollbackText: { color: '#f0c773', fontWeight: '900' },
  success: { color: '#69e7a4', fontWeight: '700' },
  error: { color: '#ff8878', fontWeight: '700' },
});
