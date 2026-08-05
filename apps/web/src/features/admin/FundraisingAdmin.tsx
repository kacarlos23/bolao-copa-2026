import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { calculateFundraisingPrizes } from '@bolao/shared';
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
  const draftAmountCents =
    parseBrlInputToCents(amount) ?? overview?.fundraising.amountCents ?? 0;
  const prizes = calculateFundraisingPrizes(draftAmountCents);

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
      setMessage('Valor arrecadado salvo com auditoria e premiação recalculada.');
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
      <Text style={styles.copy}>Premiação em dinheiro para os três primeiros colocados.</Text>
      <View style={styles.prizes} accessibilityLabel="Premiação prevista do pódio">
        <Text style={styles.prizesTitle}>Premiação do pódio</Text>
        {prizes.map((prize) => (
          <View key={prize.place} style={styles.prizeRow}>
            <Text style={styles.prizeLabel}>{prize.place}º lugar · {prize.percentage}%</Text>
            <Text style={styles.prizeValue}>{formatBrlCents(prize.amountCents)}</Text>
          </View>
        ))}
        <Text style={styles.prizeNote}>Valores truncados em centavos, sem arredondamento.</Text>
      </View>
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
          <Text style={styles.buttonText}>Revisar valor</Text>
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
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.gold,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.space.sm,
    padding: theme.space.lg,
  },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  kicker: { color: theme.color.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: theme.color.text, fontSize: 18, fontWeight: '900', marginTop: 3 },
  current: { color: theme.color.gold, fontSize: 30, fontWeight: '900' },
  copy: { color: theme.color.textMuted, lineHeight: 20 },
  prizes: {
    backgroundColor: theme.color.canvas,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    gap: theme.space.xs,
    padding: theme.space.md,
  },
  prizesTitle: { color: theme.color.gold, fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  prizeRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  prizeLabel: { color: theme.color.textMuted, fontSize: 13, fontWeight: '800' },
  prizeValue: { color: theme.color.text, fontSize: 15, fontWeight: '900' },
  prizeNote: { color: theme.color.textSubtle, fontSize: 11, lineHeight: 16, marginTop: theme.space.xs },
  estimate: { color: theme.color.textSubtle, fontSize: 12, lineHeight: 18 },
  label: { color: theme.color.text, fontSize: 12, fontWeight: '800', marginTop: 4 },
  input: {
    backgroundColor: theme.color.canvas,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    color: theme.color.text,
    minHeight: theme.touchTarget,
    outlineColor: theme.color.focus,
    padding: theme.space.md,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.sm,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  buttonText: { color: theme.color.accentInk, fontWeight: '900' },
  saveButton: { backgroundColor: 'transparent', borderColor: theme.color.gold, borderWidth: 1 },
  saveText: { color: theme.color.gold, fontWeight: '900' },
  confirm: {
    borderTopColor: theme.color.border,
    borderTopWidth: 1,
    gap: theme.space.sm,
    paddingTop: theme.space.md,
  },
  proof: { color: theme.color.gold, fontFamily: 'monospace', fontWeight: '900' },
  disabled: { opacity: 0.45 },
  success: { color: theme.color.success, fontWeight: '700' },
  error: { color: theme.color.danger, fontWeight: '700' },
});
