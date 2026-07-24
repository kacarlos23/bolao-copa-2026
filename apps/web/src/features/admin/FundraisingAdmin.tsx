import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, type AdminFundraisingOverview, type AdminMutationPreview } from '../../api';
import { errorMessage } from '../../services/api-client';
import { centsToBrlInput, formatBrlCents, parseBrlInputToCents } from '../../fundraising';
import { theme } from '../../theme/tokens';

export function FundraisingAdmin({
  seasonId,
  poolSeasonId,
}: {
  seasonId: string;
  poolSeasonId: string;
}) {
  const [overview, setOverview] = useState<AdminFundraisingOverview | null>(null);
  const [amount, setAmount] = useState('0,00');
  const [justification, setJustification] = useState(
    'Atualização do valor efetivamente arrecadado na ação entre amigos',
  );
  const [preview, setPreview] = useState<AdminMutationPreview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    if (!seasonId || !poolSeasonId) {
      setOverview(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.adminFundraising(seasonId, poolSeasonId);
      setOverview(result);
      setAmount(centsToBrlInput(result.fundraising.amountCents));
      setPreview(null);
      setConfirmation('');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [seasonId, poolSeasonId]);

  function validatedAmount() {
    const amountCents = parseBrlInputToCents(amount);
    if (amountCents == null) {
      setError('Informe um valor válido entre R$ 0,00 e R$ 1.000.000,00.');
      return null;
    }
    if (justification.trim().length < 10) {
      setError('A justificativa deve ter pelo menos 10 caracteres.');
      return null;
    }
    return amountCents;
  }

  async function createPreview() {
    const amountCents = validatedAmount();
    if (amountCents == null || !seasonId || !poolSeasonId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.previewFundraising({
        seasonId,
        poolSeasonId,
        amountCents,
        justification,
      });
      setPreview(result);
      setConfirmation('');
      setMessage('Prévia pronta. Digite a confirmação reforçada para salvar.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const amountCents = validatedAmount();
    if (amountCents == null || !preview || confirmation !== preview.confirmation) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.updateFundraising({
        seasonId,
        poolSeasonId,
        amountCents,
        justification,
        previewId: preview.previewId,
        confirmation,
      });
      setOverview((current) =>
        current ? { ...current, fundraising: result.fundraising } : current,
      );
      setAmount(centsToBrlInput(result.fundraising.amountCents));
      setPreview(null);
      setConfirmation('');
      setMessage('Valor arrecadado salvo com auditoria.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.module} accessibilityLabel="Ação entre amigos">
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>AÇÃO ENTRE AMIGOS</Text>
          <Text role="heading" aria-level={3} style={styles.title}>
            Valor arrecadado
          </Text>
        </View>
        {busy ? <ActivityIndicator color={theme.color.accent} /> : null}
      </View>
      <Text style={styles.current}>{formatBrlCents(overview?.fundraising.amountCents ?? 0)}</Text>
      <Text style={styles.copy}>Ação entre amigos para custear a viagem</Text>
      {overview ? (
        <Text style={styles.estimate}>
          Contribuição prevista: {overview.activeParticipants} participantes ativos ×{' '}
          {overview.eligibleMatches} jogos elegíveis × R$ 1,00 ={' '}
          {formatBrlCents(overview.estimatedContributionCents)}. Esta estimativa não substitui o
          valor confirmado.
        </Text>
      ) : null}
      <Text style={styles.label}>Valor arrecadado</Text>
      <TextInput
        accessibilityLabel="Valor arrecadado"
        value={amount}
        onChangeText={(value) => {
          setAmount(value);
          setPreview(null);
        }}
        keyboardType="decimal-pad"
        placeholder="0,00"
        placeholderTextColor={theme.color.textMuted}
        style={styles.input}
      />
      <Text style={styles.label}>Justificativa</Text>
      <TextInput
        accessibilityLabel="Justificativa do valor arrecadado"
        value={justification}
        onChangeText={(value) => {
          setJustification(value);
          setPreview(null);
        }}
        multiline
        style={styles.input}
      />
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy || !seasonId || !poolSeasonId}
          onPress={() => void createPreview()}
          style={[styles.button, (busy || !seasonId || !poolSeasonId) && styles.disabled]}
        >
          <Text style={styles.buttonText}>Gerar prévia</Text>
        </Pressable>
      </View>
      {preview ? (
        <View style={styles.confirm}>
          <Text style={styles.copy}>
            Digite exatamente: <Text style={styles.proof}>{preview.confirmation}</Text>
          </Text>
          <TextInput
            accessibilityLabel="Confirmação do valor arrecadado"
            value={confirmation}
            onChangeText={setConfirmation}
            autoCapitalize="characters"
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || confirmation !== preview.confirmation}
            onPress={() => void save()}
            style={[
              styles.button,
              styles.saveButton,
              (busy || confirmation !== preview.confirmation) && styles.disabled,
            ]}
          >
            <Text style={styles.saveText}>Salvar valor arrecadado</Text>
          </Pressable>
        </View>
      ) : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? (
        <Text role="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  module: {
    backgroundColor: '#08284b',
    borderColor: theme.color.gold,
    borderRadius: 13,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  kicker: { color: theme.color.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#f5f9ff', fontSize: 18, fontWeight: '900', marginTop: 3 },
  current: { color: theme.color.gold, fontSize: 30, fontWeight: '900' },
  copy: { color: '#b5c5d9', lineHeight: 20 },
  estimate: { color: '#8fa5bd', fontSize: 12, lineHeight: 18 },
  label: { color: '#f5f9ff', fontSize: 12, fontWeight: '800', marginTop: 4 },
  input: {
    backgroundColor: '#061d38',
    borderColor: '#315b83',
    borderRadius: 10,
    borderWidth: 1,
    color: '#f5f9ff',
    minHeight: 42,
    padding: 11,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderRadius: 9,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  buttonText: { color: theme.color.accentInk, fontWeight: '900' },
  saveButton: { backgroundColor: 'transparent', borderColor: theme.color.gold, borderWidth: 1 },
  saveText: { color: theme.color.gold, fontWeight: '900' },
  confirm: { borderTopColor: '#315b83', borderTopWidth: 1, gap: 8, paddingTop: 10 },
  proof: { color: theme.color.gold, fontFamily: 'monospace', fontWeight: '900' },
  disabled: { opacity: 0.45 },
  success: { color: '#69e7a4', fontWeight: '700' },
  error: { color: '#ff8878', fontWeight: '700' },
});
