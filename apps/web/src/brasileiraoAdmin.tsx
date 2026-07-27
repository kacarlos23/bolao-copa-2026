import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, type AdminMutationPreview, type CompetitionFeatureFlags } from './api';
import { normalizeCapabilities } from './app/CompetitionContext';
import { theme } from './theme/tokens';

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
  const [preview, setPreview] = useState<AdminMutationPreview | null>(null);

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

  const requestedFlags = {
    readEnabled: flags.readEnabled,
    writeEnabled: flags.writeEnabled,
    uiEnabled: flags.uiEnabled,
    syncEnabled: flags.syncEnabled,
    reason: 'Ensaio administrativo e rollback independente das flags',
  };

  async function previewSave() {
    if (!seasonId) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await api.previewCompetitionFeatures(seasonId, requestedFlags);
      setPreview(result);
      setMessage('Prévia pronta; revise a matriz e confirme a prova reforçada.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar a prévia.');
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!seasonId || !preview) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await api.updateCompetitionFeatures(seasonId, {
        ...requestedFlags,
        previewId: preview.previewId,
        confirmation: preview.confirmation,
      });
      setFlags(result.flags);
      setPreview(null);
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
        {loading ? <ActivityIndicator color={theme.color.accent} /> : null}
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
                accessibilityRole="switch"
                accessibilityState={{ checked: flags[key] }}
                onPress={() => {
                  setPreview(null);
                  setFlags((current) => ({ ...current, [key]: !current[key] }));
                }}
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
              onPress={() => void previewSave()}
              style={styles.primaryButton}
              disabled={loading}
            >
              <Text style={styles.primaryText}>Gerar prévia</Text>
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
                setPreview(null);
              }}
              style={styles.rollbackButton}
            >
              <Text style={styles.rollbackText}>Preparar rollback</Text>
            </Pressable>
          </View>
          {preview ? (
            <View style={styles.confirmation}>
              <Text style={styles.copy}>
                Confirmação reforçada: <Text style={styles.proof}>{preview.confirmation}</Text>
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void save()}
                style={styles.rollbackButton}
                disabled={loading}
              >
                <Text style={styles.rollbackText}>Aplicar estado revisado</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    gap: theme.space.md,
    padding: theme.space.lg,
  },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  kicker: { color: theme.color.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: theme.color.text, fontSize: 20, fontWeight: '900', marginTop: 3 },
  copy: { color: theme.color.textMuted, lineHeight: 20 },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flag: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 18,
    justifyContent: 'space-between',
    minWidth: 130,
    padding: 11,
  },
  flagEnabled: { backgroundColor: theme.color.accentMuted, borderColor: theme.color.accent },
  flagLabel: { color: theme.color.textMuted, fontWeight: '800' },
  flagState: { color: theme.color.textSubtle, fontSize: 11, fontWeight: '900' },
  flagLabelEnabled: { color: theme.color.accent },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  confirmation: { borderTopColor: theme.color.border, borderTopWidth: 1, gap: 8, paddingTop: 10 },
  proof: { color: theme.color.warning, fontFamily: 'monospace', fontWeight: '900' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  primaryText: { color: theme.color.accentInk, fontWeight: '900' },
  rollbackButton: {
    alignItems: 'center',
    backgroundColor: theme.color.warningMuted,
    borderColor: theme.color.warning,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  rollbackText: { color: theme.color.warning, fontWeight: '900' },
  success: { color: theme.color.success, fontWeight: '700' },
  error: { color: theme.color.danger, fontWeight: '700' },
});
