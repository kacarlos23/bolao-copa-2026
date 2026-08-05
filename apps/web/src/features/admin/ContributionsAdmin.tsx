import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { centsToBrlInput, formatBrlCents, parseBrlInputToCents } from '../../fundraising';
import { errorMessage } from '../../services/api-client';
import { theme } from '../../theme/tokens';

export type ContributionMutationAction = 'PAYMENT' | 'VOID' | 'ACCOUNT';

export type ContributionTotals = {
  paidCents: number;
  dueCents: number;
  outstandingCents: number;
  advanceCents: number;
};

export type ContributionAdminRound = {
  roundId: string;
  order: number;
  name: string;
  startsAt: string | null;
  hasStarted: boolean;
};

export type ContributionAdminParticipant = {
  userId: string;
  nickname: string;
  avatarUrl?: string | null;
  contributionConfigured?: boolean;
  contributionStartRound: number | null;
  contributionEndRound: number | null;
  paymentCents: number;
  dueCents: number;
  outstandingCents: number;
  advanceCents: number;
  selectedRoundPaymentCents?: number | null;
  selectedRoundOutstandingCents?: number | null;
};

export type ContributionAdminTransaction = {
  id: string;
  userId: string;
  roundId: string;
  kind?: 'PAYMENT' | 'VOID' | string;
  amountCents: number;
  createdAt?: string;
  voidsTransactionId?: string | null;
};

export type ContributionsAdminOverview = {
  poolSeasonId: string;
  amountPerRoundCents: number;
  defaultStartRound: number;
  dueThroughRound: number | null;
  totals: ContributionTotals;
  participants: ContributionAdminParticipant[];
  rounds?: ContributionAdminRound[];
  selectedRoundId?: string | null;
  transactions?: ContributionAdminTransaction[];
};

export type ContributionPaymentDraft = {
  userId: string;
  roundId: string;
  amountCents: number;
};

export type ContributionMutationDraft =
  | {
      action: 'PAYMENT';
      userId: string;
      roundId: string;
      amountCents: number;
      justification: string;
    }
  | {
      action: 'VOID';
      transactionId: string;
      justification: string;
    }
  | {
      action: 'ACCOUNT';
      userId: string;
      startRound: number;
      endRound: number | null;
      justification: string;
    };

export type ContributionMutationPreview = {
  previewId: string;
  confirmation: string;
  affectedCount?: number;
  expiresAt?: string | null;
  preview?: unknown;
};

export type ContributionMutationConfirmation = ContributionMutationDraft & {
  previewId: string;
  confirmation: string;
};

export type ContributionsAdminProps = {
  overview: ContributionsAdminOverview | null;
  /** Allows the host to keep the selected round in sync with its request query. */
  selectedRoundId?: string | null;
  isLoading?: boolean;
  loadError?: string | null;
  onRoundChange?: (roundId: string) => void;
  onRecordPayment?: (input: ContributionPaymentDraft) => Promise<unknown>;
  onPreview?: (input: ContributionMutationDraft) => Promise<ContributionMutationPreview>;
  onConfirm?: (input: ContributionMutationConfirmation) => Promise<unknown>;
  onRefresh?: () => Promise<void> | void;
};

type AccountEdit = { startRound: string; endRound: string };
type PendingPreview = { draft: ContributionMutationDraft; response: ContributionMutationPreview };

function roundLabel(round: ContributionAdminRound) {
  return round.name.trim() || `Rodada ${round.order}`;
}

function participantRoundIsEligible(participant: ContributionAdminParticipant, roundOrder: number) {
  return (
    participant.contributionStartRound != null &&
    roundOrder >= participant.contributionStartRound &&
    (participant.contributionEndRound == null || roundOrder <= participant.contributionEndRound)
  );
}

function actionTitle(draft: ContributionMutationDraft, overview: ContributionsAdminOverview) {
  if (draft.action === 'PAYMENT') {
    const participant = overview.participants.find((item) => item.userId === draft.userId);
    const round = overview.rounds?.find((item) => item.roundId === draft.roundId);
    return `Registrar ${formatBrlCents(draft.amountCents)} para ${participant?.nickname ?? 'participante'} em ${
      round ? roundLabel(round) : 'uma rodada'
    }`;
  }
  if (draft.action === 'VOID') return 'Estornar o lançamento selecionado';
  const participant = overview.participants.find((item) => item.userId === draft.userId);
  return `Atualizar a faixa de cobrança de ${participant?.nickname ?? 'participante'}`;
}

function completionMessage(action: ContributionMutationAction) {
  return (
    {
      PAYMENT: 'Pagamento registrado com auditoria.',
      VOID: 'Lançamento estornado com auditoria.',
      ACCOUNT: 'Faixa de cobrança atualizada com auditoria.',
    } as const
  )[action];
}

export function ContributionsAdmin({
  overview,
  selectedRoundId,
  isLoading = false,
  loadError = null,
  onRoundChange,
  onRecordPayment,
  onPreview,
  onConfirm,
  onRefresh,
}: ContributionsAdminProps) {
  const [uncontrolledRoundId, setUncontrolledRoundId] = useState<string | null>(null);
  const [paymentInputs, setPaymentInputs] = useState<Record<string, string>>({});
  const [accountEdits, setAccountEdits] = useState<Record<string, AccountEdit>>({});
  const [openAccountId, setOpenAccountId] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [localError, setLocalError] = useState('');

  const rounds = useMemo(
    () => [...(overview?.rounds ?? [])].sort((left, right) => left.order - right.order),
    [overview?.rounds],
  );
  const activeRoundId =
    selectedRoundId ??
    overview?.selectedRoundId ??
    uncontrolledRoundId ??
    rounds.find((round) => round.order === overview?.dueThroughRound)?.roundId ??
    rounds[0]?.roundId ??
    null;
  const selectedRound = rounds.find((round) => round.roundId === activeRoundId) ?? null;
  const paymentMutationsReady = Boolean(onRecordPayment);
  const protectedMutationsReady = Boolean(onPreview && onConfirm);
  const error = localError || loadError || '';

  const voidedTransactionIds = useMemo(
    () =>
      new Set(
        (overview?.transactions ?? [])
          .filter((transaction) => transaction.kind === 'VOID' && transaction.voidsTransactionId)
          .map((transaction) => transaction.voidsTransactionId as string),
      ),
    [overview?.transactions],
  );

  function selectRound(roundId: string) {
    setPendingPreview(null);
    setConfirmation('');
    setMessage('');
    setLocalError('');
    if (onRoundChange) {
      onRoundChange(roundId);
      return;
    }
    setUncontrolledRoundId(roundId);
  }

  function defaultPaymentInput(participant: ContributionAdminParticipant, outstandingCents: number) {
    return paymentInputs[participant.userId] ?? centsToBrlInput(outstandingCents);
  }

  async function createPreview(draft: ContributionMutationDraft) {
    if (!protectedMutationsReady || !onPreview) {
      setLocalError('A integração de contribuições ainda não está disponível neste painel.');
      return;
    }
    setBusy(true);
    setLocalError('');
    setMessage('');
    try {
      const response = await onPreview(draft);
      setPendingPreview({ draft, response });
      setConfirmation('');
      setMessage('Prévia pronta. Revise a operação e digite a confirmação reforçada.');
    } catch (cause) {
      setLocalError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function confirmPreview() {
    if (!pendingPreview || !onConfirm || confirmation !== pendingPreview.response.confirmation) return;
    setBusy(true);
    setLocalError('');
    setMessage('');
    try {
      await onConfirm({
        ...pendingPreview.draft,
        previewId: pendingPreview.response.previewId,
        confirmation,
      });
      await onRefresh?.();
      setMessage(completionMessage(pendingPreview.draft.action));
      setPendingPreview(null);
      setConfirmation('');
      setPaymentInputs({});
      setOpenAccountId(null);
    } catch (cause) {
      setLocalError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function recordPayment(
    participant: ContributionAdminParticipant,
    amountCents: number,
    outstandingCents: number,
  ) {
    if (!paymentMutationsReady || !onRecordPayment) {
      setLocalError('A integração de pagamentos de contribuição ainda não está disponível neste painel.');
      return;
    }
    if (!selectedRound) return;
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > outstandingCents) {
      setLocalError(
        `Informe um valor entre R$ 0,01 e ${formatBrlCents(outstandingCents)} para esta rodada.`,
      );
      return;
    }
    setBusy(true);
    setLocalError('');
    setMessage('');
    try {
      await onRecordPayment({
        userId: participant.userId,
        roundId: selectedRound.roundId,
        amountCents,
      });
      await onRefresh?.();
      setMessage('Pagamento registrado.');
      setPaymentInputs({});
    } catch (cause) {
      setLocalError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function requestAccountChange(participant: ContributionAdminParticipant) {
    const edit = accountEdits[participant.userId] ?? {
      startRound: String(participant.contributionStartRound ?? overview?.defaultStartRound ?? ''),
      endRound: participant.contributionEndRound == null ? '' : String(participant.contributionEndRound),
    };
    const startRound = Number(edit.startRound);
    const endRound = edit.endRound.trim() === '' ? null : Number(edit.endRound);
    const validRoundOrders = new Set(rounds.map((round) => round.order));
    if (!Number.isInteger(startRound) || !validRoundOrders.has(startRound)) {
      setLocalError('Escolha uma rodada inicial disponível para a cobrança.');
      return;
    }
    if (
      endRound != null &&
      (!Number.isInteger(endRound) || !validRoundOrders.has(endRound) || endRound < startRound)
    ) {
      setLocalError('A rodada final deve ser igual ou posterior à rodada inicial.');
      return;
    }
    void createPreview({
      action: 'ACCOUNT',
      userId: participant.userId,
      startRound,
      endRound,
      justification: 'Faixa de cobrança atualizada pelo administrador.',
    });
  }

  if (!overview) {
    return (
      <View style={styles.module} accessibilityLabel="Contribuições por rodada">
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>CONTRIBUIÇÕES</Text>
            <Text role="heading" aria-level={3} style={styles.title}>
              Contribuições por rodada
            </Text>
          </View>
          {isLoading ? <ActivityIndicator color={theme.color.accent} /> : null}
        </View>
        <Text style={styles.copy}>
          {error || 'Selecione uma competição para acompanhar as contribuições dos participantes.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.module} accessibilityLabel="Contribuições por rodada">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>CONTRIBUIÇÕES</Text>
          <Text role="heading" aria-level={3} style={styles.title}>
            Contribuições por rodada
          </Text>
          <Text style={styles.copy}>
            {formatBrlCents(overview.amountPerRoundCents)} por participante em cada rodada, a partir da rodada{' '}
            {overview.defaultStartRound}. Este controle não altera o valor arrecadado manualmente.
          </Text>
        </View>
        {isLoading || busy ? <ActivityIndicator color={theme.color.accent} /> : null}
      </View>

      <View style={styles.summary} accessibilityLabel="Resumo das contribuições">
        <SummaryMetric label="Pago" value={formatBrlCents(overview.totals.paidCents)} />
        <SummaryMetric label="Devido até agora" value={formatBrlCents(overview.totals.dueCents)} />
        <SummaryMetric label="Em aberto" tone="danger" value={formatBrlCents(overview.totals.outstandingCents)} />
        <SummaryMetric label="Antecipado" tone="accent" value={formatBrlCents(overview.totals.advanceCents)} />
      </View>

      <View style={styles.roundSection}>
        <Text style={styles.sectionLabel}>Rodada para lançar</Text>
        <View style={styles.roundRail} accessibilityLabel="Seletor de rodada">
          {rounds.map((round) => {
            const isActive = round.roundId === activeRoundId;
            return (
              <Pressable
                key={round.roundId}
                accessibilityRole="button"
                accessibilityLabel={`Selecionar ${roundLabel(round)}`}
                disabled={busy || isLoading}
                onPress={() => selectRound(round.roundId)}
                style={[styles.roundChip, isActive && styles.roundChipActive, (busy || isLoading) && styles.disabled]}
              >
                <Text style={[styles.roundChipText, isActive && styles.roundChipTextActive]}>
                  {round.order}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {selectedRound ? (
          <Text style={styles.roundContext}>
            {roundLabel(selectedRound)} · {selectedRound.hasStarted ? 'rodada já iniciada' : 'pagamentos antecipados permitidos'}
          </Text>
        ) : (
          <Text style={styles.roundContext}>Nenhuma rodada disponível para lançamento.</Text>
        )}
      </View>

      <View style={styles.participantList}>
        <View style={styles.listHeader}>
          <Text style={styles.sectionLabel}>Participantes</Text>
          <Text style={styles.listHint}>Lançamentos parciais não podem ultrapassar o valor da rodada.</Text>
        </View>
        {overview.participants.map((participant) => {
          const eligible = selectedRound ? participantRoundIsEligible(participant, selectedRound.order) : false;
          const activeRoundPayments = (overview.transactions ?? []).filter(
            (transaction) =>
              transaction.kind === 'PAYMENT' &&
              transaction.userId === participant.userId &&
              transaction.roundId === selectedRound?.roundId &&
              !voidedTransactionIds.has(transaction.id),
          );
          const paidCents = Math.max(
            0,
            activeRoundPayments.length
              ? activeRoundPayments.reduce((total, transaction) => total + transaction.amountCents, 0)
              : (participant.selectedRoundPaymentCents ?? 0),
          );
          const outstandingCents = Math.max(0, overview.amountPerRoundCents - paidCents);
          const activePayment = activeRoundPayments.at(-1);
          const accountEdit = accountEdits[participant.userId] ?? {
            startRound: String(participant.contributionStartRound ?? overview.defaultStartRound),
            endRound: participant.contributionEndRound == null ? '' : String(participant.contributionEndRound),
          };
          return (
            <View key={participant.userId} style={styles.participant}>
              <View style={styles.participantTop}>
                <View style={styles.participantIdentity}>
                  <Text style={styles.participantName}>{participant.nickname}</Text>
                  <Text style={styles.participantSchedule}>
                    {participant.contributionConfigured === false
                      ? 'Conta de cobrança ainda não configurada.'
                      : `Cobrança: rodada ${participant.contributionStartRound ?? overview.defaultStartRound}${
                          participant.contributionEndRound == null
                            ? ' em diante'
                            : ` até a rodada ${participant.contributionEndRound}`
                        }`}
                  </Text>
                </View>
                <View style={styles.roundStatus}>
                  <Text style={styles.roundStatusLabel}>{eligible ? 'Pagamento nesta rodada' : 'Sem cobrança nesta rodada'}</Text>
                  <Text style={[styles.roundStatusValue, !eligible && styles.roundStatusMuted]}>
                    {eligible ? `${formatBrlCents(paidCents)} de ${formatBrlCents(overview.amountPerRoundCents)}` : '—'}
                  </Text>
                </View>
              </View>

              <View style={styles.participantTotals}>
                <InlineMetric label="Pago" value={formatBrlCents(participant.paymentCents)} />
                <InlineMetric label="Em aberto" value={formatBrlCents(participant.outstandingCents)} />
                <InlineMetric label="Antecipado" value={formatBrlCents(participant.advanceCents)} />
              </View>

              {eligible ? (
                <>
                  <Text style={styles.remaining}>
                    {outstandingCents > 0
                      ? `Faltam ${formatBrlCents(outstandingCents)} nesta rodada.`
                      : 'Rodada quitada.'}
                  </Text>
                  <View style={styles.paymentActions}>
                    <TextInput
                      accessibilityLabel={`Valor para ${participant.nickname} na ${selectedRound ? roundLabel(selectedRound) : 'rodada'}`}
                      value={defaultPaymentInput(participant, outstandingCents)}
                      onChangeText={(value) => {
                        setPaymentInputs((current) => ({ ...current, [participant.userId]: value }));
                        setPendingPreview(null);
                        setConfirmation('');
                      }}
                      keyboardType="decimal-pad"
                      placeholder="0,00"
                      placeholderTextColor={theme.color.textMuted}
                      style={[styles.input, styles.paymentInput]}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Registrar pagamento parcial de ${participant.nickname}`}
                      disabled={busy || isLoading || !paymentMutationsReady || outstandingCents <= 0 || !selectedRound}
                      onPress={() => {
                        const amountCents = parseBrlInputToCents(defaultPaymentInput(participant, outstandingCents));
                        void recordPayment(participant, amountCents ?? -1, outstandingCents);
                      }}
                      style={[styles.button, styles.secondaryButton, (busy || isLoading || !paymentMutationsReady || outstandingCents <= 0 || !selectedRound) && styles.disabled]}
                    >
                      <Text style={styles.secondaryButtonText}>Registrar parcial</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Quitar ${participant.nickname}`}
                      disabled={busy || isLoading || !paymentMutationsReady || outstandingCents <= 0 || !selectedRound}
                      onPress={() => void recordPayment(participant, outstandingCents, outstandingCents)}
                      style={[styles.button, (busy || isLoading || !paymentMutationsReady || outstandingCents <= 0 || !selectedRound) && styles.disabled]}
                    >
                      <Text style={styles.buttonText}>Quitar {formatBrlCents(outstandingCents)}</Text>
                    </Pressable>
                    {activePayment ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Estornar pagamento de ${participant.nickname}`}
                        disabled={busy || isLoading || !protectedMutationsReady}
                        onPress={() =>
                          void createPreview({
                            action: 'VOID',
                            transactionId: activePayment.id,
                            justification: 'Estorno de contribuição registrado pelo administrador.',
                          })
                        }
                        style={[styles.button, styles.voidButton, (busy || isLoading || !protectedMutationsReady) && styles.disabled]}
                      >
                        <Text style={styles.voidButtonText}>Estornar lançamento</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </>
              ) : (
                <Text style={styles.noCharge}>A faixa de cobrança deste participante não inclui a rodada selecionada.</Text>
              )}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Ajustar faixa de cobrança de ${participant.nickname}`}
                disabled={busy || isLoading || !protectedMutationsReady}
                onPress={() => setOpenAccountId((current) => (current === participant.userId ? null : participant.userId))}
                style={[styles.accountToggle, (busy || isLoading || !protectedMutationsReady) && styles.disabled]}
              >
                <Text style={styles.accountToggleText}>
                  {openAccountId === participant.userId ? 'Fechar ajuste de cobrança' : 'Ajustar cobrança'}
                </Text>
              </Pressable>

              {openAccountId === participant.userId ? (
                <View style={styles.accountEditor}>
                  <Text style={styles.accountTitle}>Faixa cobrada</Text>
                  <View style={styles.accountInputs}>
                    <View style={styles.accountField}>
                      <Text style={styles.label}>Rodada inicial</Text>
                      <TextInput
                        accessibilityLabel={`Rodada inicial de ${participant.nickname}`}
                        value={accountEdit.startRound}
                        onChangeText={(value) =>
                          setAccountEdits((current) => ({
                            ...current,
                            [participant.userId]: { ...accountEdit, startRound: value },
                          }))
                        }
                        keyboardType="number-pad"
                        style={styles.input}
                      />
                    </View>
                    <View style={styles.accountField}>
                      <Text style={styles.label}>Rodada final (opcional)</Text>
                      <TextInput
                        accessibilityLabel={`Rodada final de ${participant.nickname}`}
                        value={accountEdit.endRound}
                        onChangeText={(value) =>
                          setAccountEdits((current) => ({
                            ...current,
                            [participant.userId]: { ...accountEdit, endRound: value },
                          }))
                        }
                        keyboardType="number-pad"
                        placeholder="Sem término"
                        placeholderTextColor={theme.color.textMuted}
                        style={styles.input}
                      />
                    </View>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy || isLoading || !protectedMutationsReady}
                    onPress={() => requestAccountChange(participant)}
                    style={[styles.button, styles.accountSave, (busy || isLoading || !protectedMutationsReady) && styles.disabled]}
                  >
                    <Text style={styles.buttonText}>Revisar faixa de cobrança</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
        {!overview.participants.length ? (
          <Text style={styles.empty}>Nenhum participante ativo possui uma conta de contribuição nesta competição.</Text>
        ) : null}
      </View>

      {pendingPreview ? (
        <View style={styles.confirm} accessibilityLabel="Confirmação da contribuição">
          <Text style={styles.confirmTitle}>Confirmar alteração</Text>
          <Text style={styles.copy}>{actionTitle(pendingPreview.draft, overview)}</Text>
          <Text style={styles.copy}>
            Digite exatamente: <Text style={styles.proof}>{pendingPreview.response.confirmation}</Text>
          </Text>
          <TextInput
            accessibilityLabel="Confirmação da alteração de contribuição"
            value={confirmation}
            onChangeText={setConfirmation}
            autoCapitalize="characters"
            style={styles.input}
          />
          <View style={styles.confirmActions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setPendingPreview(null);
                setConfirmation('');
                setMessage('Prévia cancelada. Nenhuma alteração foi salva.');
              }}
              style={[styles.button, styles.secondaryButton, busy && styles.disabled]}
            >
              <Text style={styles.secondaryButtonText}>Cancelar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy || confirmation !== pendingPreview.response.confirmation}
              onPress={() => void confirmPreview()}
              style={[styles.button, (busy || confirmation !== pendingPreview.response.confirmation) && styles.disabled]}
            >
              <Text style={styles.buttonText}>Confirmar alteração</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? (
        <Text role="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {!paymentMutationsReady && !protectedMutationsReady ? (
        <Text style={styles.integrationNote}>As ações ficam disponíveis quando a integração administrativa for carregada.</Text>
      ) : null}
    </View>
  );
}

function SummaryMetric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' | 'accent' }) {
  return (
    <View style={styles.summaryMetric}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, tone === 'danger' && styles.summaryValueDanger, tone === 'accent' && styles.summaryValueAccent]}>{value}</Text>
    </View>
  );
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.inlineMetric}>
      <Text style={styles.inlineMetricLabel}>{label}</Text>
      <Text style={styles.inlineMetricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  module: {
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.accent,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.space.lg,
    marginTop: theme.space.lg,
    padding: theme.space.lg,
  },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: theme.space.md, justifyContent: 'space-between' },
  headerCopy: { flex: 1, gap: theme.space.xs },
  kicker: { color: theme.color.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: theme.color.text, fontSize: 20, fontWeight: '900' },
  copy: { color: theme.color.textMuted, fontSize: 13, lineHeight: 20 },
  summary: { borderColor: theme.color.borderMuted, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden' },
  summaryMetric: { borderColor: theme.color.borderMuted, borderRightWidth: 1, flex: 1, gap: theme.space.xs, minWidth: 145, padding: theme.space.md },
  summaryLabel: { color: theme.color.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  summaryValue: { color: theme.color.text, fontSize: 20, fontWeight: '900' },
  summaryValueDanger: { color: theme.color.danger },
  summaryValueAccent: { color: theme.color.accent },
  roundSection: { gap: theme.space.sm },
  sectionLabel: { color: theme.color.text, fontSize: 13, fontWeight: '900' },
  roundRail: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs },
  roundChip: { alignItems: 'center', borderColor: theme.color.borderStrong, borderRadius: theme.radius.pill, borderWidth: 1, justifyContent: 'center', minHeight: 36, minWidth: 42, paddingHorizontal: theme.space.sm },
  roundChipActive: { backgroundColor: theme.color.accentMuted, borderColor: theme.color.accent },
  roundChipText: { color: theme.color.textMuted, fontSize: 12, fontWeight: '900' },
  roundChipTextActive: { color: theme.color.accent },
  roundContext: { color: theme.color.textSubtle, fontSize: 12 },
  label: { color: theme.color.text, fontSize: 12, fontWeight: '800' },
  input: { backgroundColor: theme.color.canvas, borderColor: theme.color.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.color.text, minHeight: theme.touchTarget, outlineColor: theme.color.focus, paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm },
  participantList: { borderTopColor: theme.color.borderMuted, borderTopWidth: 1, gap: 0, paddingTop: theme.space.md },
  listHeader: { gap: theme.space.xs, marginBottom: theme.space.sm },
  listHint: { color: theme.color.textSubtle, fontSize: 11, lineHeight: 16 },
  participant: { borderBottomColor: theme.color.borderMuted, borderBottomWidth: 1, gap: theme.space.sm, paddingVertical: theme.space.md },
  participantTop: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, justifyContent: 'space-between' },
  participantIdentity: { flex: 1, minWidth: 160 },
  participantName: { color: theme.color.text, fontSize: 16, fontWeight: '900' },
  participantSchedule: { color: theme.color.textSubtle, fontSize: 11, marginTop: 3 },
  roundStatus: { alignItems: 'flex-end', gap: 2, minWidth: 150 },
  roundStatusLabel: { color: theme.color.textMuted, fontSize: 10, fontWeight: '800' },
  roundStatusValue: { color: theme.color.accent, fontSize: 13, fontWeight: '900' },
  roundStatusMuted: { color: theme.color.textSubtle },
  participantTotals: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  inlineMetric: { backgroundColor: theme.color.canvas, borderRadius: theme.radius.xs, gap: 2, minWidth: 92, paddingHorizontal: theme.space.sm, paddingVertical: theme.space.xs },
  inlineMetricLabel: { color: theme.color.textSubtle, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  inlineMetricValue: { color: theme.color.text, fontSize: 12, fontWeight: '900' },
  remaining: { color: theme.color.textMuted, fontSize: 12 },
  noCharge: { color: theme.color.textSubtle, fontSize: 12, lineHeight: 18 },
  paymentActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  paymentInput: { flexGrow: 1, minWidth: 118, width: 118 },
  button: { alignItems: 'center', backgroundColor: theme.color.accent, borderRadius: theme.radius.sm, justifyContent: 'center', minHeight: theme.touchTarget, paddingHorizontal: theme.space.md, paddingVertical: 10 },
  buttonText: { color: theme.color.accentInk, fontSize: 12, fontWeight: '900' },
  secondaryButton: { backgroundColor: 'transparent', borderColor: theme.color.borderStrong, borderWidth: 1 },
  secondaryButtonText: { color: theme.color.text, fontSize: 12, fontWeight: '900' },
  voidButton: { backgroundColor: 'transparent', borderColor: theme.color.danger, borderWidth: 1 },
  voidButtonText: { color: theme.color.danger, fontSize: 12, fontWeight: '900' },
  accountToggle: { alignSelf: 'flex-start', minHeight: 34, paddingVertical: theme.space.xs },
  accountToggleText: { color: theme.color.info, fontSize: 12, fontWeight: '900' },
  accountEditor: { backgroundColor: theme.color.canvas, borderColor: theme.color.border, borderRadius: theme.radius.sm, borderWidth: 1, gap: theme.space.sm, padding: theme.space.md },
  accountTitle: { color: theme.color.text, fontSize: 13, fontWeight: '900' },
  accountInputs: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  accountField: { flex: 1, gap: theme.space.xs, minWidth: 155 },
  accountSave: { alignSelf: 'flex-start' },
  confirm: { backgroundColor: theme.color.canvas, borderColor: theme.color.gold, borderRadius: theme.radius.sm, borderWidth: 1, gap: theme.space.sm, padding: theme.space.md },
  confirmTitle: { color: theme.color.gold, fontSize: 15, fontWeight: '900' },
  proof: { color: theme.color.gold, fontFamily: 'monospace', fontWeight: '900' },
  confirmActions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  success: { color: theme.color.success, fontSize: 13, fontWeight: '800' },
  error: { color: theme.color.danger, fontSize: 13, fontWeight: '800' },
  empty: { color: theme.color.textMuted, fontSize: 13, lineHeight: 20, paddingVertical: theme.space.md },
  integrationNote: { color: theme.color.textSubtle, fontSize: 11, lineHeight: 16 },
  disabled: { opacity: 0.45 },
});
