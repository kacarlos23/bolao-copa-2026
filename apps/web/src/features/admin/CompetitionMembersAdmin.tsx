import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, errorMessage, type User } from '../../api';
import { theme } from '../../theme/tokens';

type MembershipStatus = 'ACTIVE' | 'INACTIVE' | 'REMOVED';

export type ContributionRoundOption = {
  /** The season round order used by the contribution-account API. */
  order: number;
  name?: string;
};

export type ContributionAccountLifecycle = {
  startRound: number | null;
  endRound: number | null;
};

export type ContributionAccountPreview = {
  previewId: string;
  confirmation: string;
  expiresAt?: string | null;
};

export type ContributionAccountChange = {
  userId: string;
  startRound?: number;
  /** `null` explicitly reopens an account when activating a participant. */
  endRound?: number | null;
};

export type CompetitionMembersAdminProps = {
  poolSeasonId: string;
  /** Turns on the contribution-account guard around membership changes. */
  contributionsEnabled?: boolean;
  /** Eligible contribution rounds, identified by their season round order. */
  contributionRounds?: readonly ContributionRoundOption[];
  /** Current account lifecycle, keyed by participant user id. */
  contributionAccountsByUserId?: Readonly<
    Record<string, ContributionAccountLifecycle | undefined>
  >;
  /** Creates the reinforced-preview required before changing an account lifecycle. */
  onPreviewContributionAccount?: (
    input: ContributionAccountChange,
  ) => Promise<ContributionAccountPreview>;
  /** Confirms the previewed account lifecycle mutation. */
  onConfirmContributionAccount?: (
    input: ContributionAccountChange & { previewId: string; confirmation: string },
  ) => Promise<void>;
};

type PendingContributionMembershipChange = {
  userId: string;
  status: MembershipStatus;
  roundOrder: number | null;
  preview: ContributionAccountPreview | null;
  confirmation: string;
};

export function CompetitionMembersAdmin({
  poolSeasonId,
  contributionsEnabled = false,
  contributionRounds = [],
  contributionAccountsByUserId = {},
  onPreviewContributionAccount,
  onConfirmContributionAccount,
}: CompetitionMembersAdminProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [statuses, setStatuses] = useState<Record<string, MembershipStatus>>({});
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [pendingContributionChange, setPendingContributionChange] =
    useState<PendingContributionMembershipChange | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const sortedContributionRounds = useMemo(
    () => [...contributionRounds].sort((left, right) => left.order - right.order),
    [contributionRounds],
  );
  const contributionLifecycleAvailable =
    contributionsEnabled &&
    sortedContributionRounds.length > 0 &&
    onPreviewContributionAccount != null &&
    onConfirmContributionAccount != null;

  async function load() {
    if (!poolSeasonId) return;
    setError('');
    try {
      const [userResult, memberResult] = await Promise.all([
        api.adminUsers(),
        api.adminPoolSeasonMembers(poolSeasonId),
      ]);
      setUsers(userResult.users);
      setStatuses(Object.fromEntries(memberResult.members.map((item) => [item.userId, item.status])));
      setNicknames(Object.fromEntries(userResult.users.map((user) => [user.id, user.nickname])));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  useEffect(() => {
    void load();
    setPendingContributionChange(null);
  }, [poolSeasonId]);

  function participationMessage(status: MembershipStatus) {
    return status === 'ACTIVE' ? 'Usuário incluído na competição.' : 'Participação atualizada.';
  }

  async function persistParticipation(userId: string, status: MembershipStatus) {
    await api.setAdminPoolSeasonMemberStatus(poolSeasonId, userId, status);
    setStatuses((current) => ({ ...current, [userId]: status }));
  }

  async function setParticipation(userId: string, status: MembershipStatus) {
    setBusyId(`${userId}:membership`);
    setError('');
    setMessage('');
    try {
      await persistParticipation(userId, status);
      setMessage(participationMessage(status));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyId('');
    }
  }

  function beginParticipationChange(userId: string, status: MembershipStatus) {
    if (!contributionsEnabled) {
      void setParticipation(userId, status);
      return;
    }
    if (!contributionLifecycleAvailable) {
      setError(
        'O controle de contribuições está ativo, mas a configuração de contas não está disponível.',
      );
      return;
    }
    setError('');
    setMessage('');
    setPendingContributionChange({
      userId,
      status,
      roundOrder: null,
      preview: null,
      confirmation: '',
    });
  }

  function contributionChangeInput(
    change: PendingContributionMembershipChange,
  ): ContributionAccountChange | null {
    if (change.roundOrder == null) return null;
    return change.status === 'ACTIVE'
      ? { userId: change.userId, startRound: change.roundOrder, endRound: null }
      : { userId: change.userId, endRound: change.roundOrder };
  }

  function eligibleLifecycleRounds(change: PendingContributionMembershipChange) {
    if (change.status === 'ACTIVE') return sortedContributionRounds;
    const startRound = contributionAccountsByUserId[change.userId]?.startRound;
    return startRound == null
      ? sortedContributionRounds
      : sortedContributionRounds.filter((round) => round.order >= startRound);
  }

  async function previewContributionAccountChange() {
    const change = pendingContributionChange;
    const input = change ? contributionChangeInput(change) : null;
    if (!change || !input || !onPreviewContributionAccount) return;
    setBusyId(`${change.userId}:contribution-preview`);
    setError('');
    setMessage('');
    try {
      const preview = await onPreviewContributionAccount(input);
      setPendingContributionChange((current) =>
        current != null &&
        current.userId === change.userId &&
        current.status === change.status &&
        current.roundOrder === change.roundOrder
          ? { ...current, preview, confirmation: '' }
          : current,
      );
      setMessage('Prévia pronta. Digite a confirmação reforçada para concluir a alteração.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyId('');
    }
  }

  async function confirmContributionAccountChange() {
    const change = pendingContributionChange;
    const input = change ? contributionChangeInput(change) : null;
    if (
      !change ||
      !input ||
      !change.preview ||
      change.confirmation !== change.preview.confirmation ||
      !onConfirmContributionAccount
    ) {
      return;
    }
    setBusyId(`${change.userId}:contribution-confirm`);
    setError('');
    setMessage('');
    try {
      await onConfirmContributionAccount({
        ...input,
        previewId: change.preview.previewId,
        confirmation: change.confirmation,
      });
      await persistParticipation(change.userId, change.status);
      setPendingContributionChange(null);
      setMessage(`${participationMessage(change.status)} Conta de contribuições atualizada.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyId('');
    }
  }

  async function saveNickname(user: User) {
    const nickname = nicknames[user.id]?.trim() ?? '';
    if (nickname.length < 2) {
      setError('O nickname precisa ter ao menos 2 caracteres.');
      return;
    }
    setBusyId(`${user.id}:nickname`);
    setError('');
    try {
      await api.updateAdminUserNickname(user.id, nickname);
      setMessage('Nickname atualizado.');
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyId('');
    }
  }

  async function resetPassword(user: User) {
    const password = passwords[user.id] ?? '';
    if (password.length < 6) {
      setError('A nova senha precisa ter ao menos 6 caracteres.');
      return;
    }
    setBusyId(`${user.id}:password`);
    setError('');
    try {
      await api.resetAdminUserPassword(user.id, password);
      setPasswords((current) => ({ ...current, [user.id]: '' }));
      setMessage('Senha redefinida; as sessões do usuário foram revogadas.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyId('');
    }
  }

  return (
    <View style={styles.shell}>
      <Text style={styles.title}>Participantes da competição</Text>
      <Text style={styles.copy}>
        Criar conta não inclui ninguém automaticamente. Inclua, inative ou remova cada pessoa somente nesta competição.
      </Text>
      {contributionsEnabled ? (
        <Text style={styles.contributionCopy}>
          Ao alterar a participação, defina e confirme o período de cobrança por rodada antes de salvar.
        </Text>
      ) : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {error ? <Text role="alert" style={styles.error}>{error}</Text> : null}
      {users.map((user) => {
        const status = statuses[user.id] ?? 'REMOVED';
        const account = contributionAccountsByUserId[user.id];
        const pendingForUser =
          pendingContributionChange?.userId === user.id ? pendingContributionChange : null;
        const lifecycleRounds = pendingForUser ? eligibleLifecycleRounds(pendingForUser) : [];
        return (
          <View key={user.id} style={styles.user}>
            <View style={styles.userTop}>
              <Text style={styles.name}>{user.nickname}</Text>
              <Text style={styles.status}>
                {status === 'ACTIVE' ? 'Participando' : status === 'INACTIVE' ? 'Inativo' : 'Fora'}
              </Text>
            </View>
            <Text style={styles.meta}>{user.username}</Text>
            {contributionsEnabled ? (
              <Text style={styles.contributionStatus}>
                {account?.startRound == null
                  ? 'Conta de contribuições ainda não configurada.'
                  : `Cobrança: rodada ${account.startRound}${
                      account.endRound == null ? ' em diante' : ` até a rodada ${account.endRound}`
                    }.`}
              </Text>
            ) : null}
            <View style={styles.row}>
              <TextInput
                value={nicknames[user.id] ?? ''}
                onChangeText={(value) => setNicknames((current) => ({ ...current, [user.id]: value }))}
                style={styles.input}
                placeholder="Nickname"
                placeholderTextColor={theme.color.textMuted}
              />
              <Action
                label="Salvar nome"
                onPress={() => void saveNickname(user)}
                disabled={Boolean(busyId) || pendingContributionChange != null}
              />
            </View>
            <View style={styles.row}>
              <TextInput
                secureTextEntry
                value={passwords[user.id] ?? ''}
                onChangeText={(value) => setPasswords((current) => ({ ...current, [user.id]: value }))}
                style={styles.input}
                placeholder="Nova senha"
                placeholderTextColor={theme.color.textMuted}
              />
              <Action
                label="Redefinir senha"
                onPress={() => void resetPassword(user)}
                disabled={Boolean(busyId) || pendingContributionChange != null}
              />
            </View>
            <View style={styles.actions}>
              <Action
                label="Incluir / ativar"
                onPress={() => beginParticipationChange(user.id, 'ACTIVE')}
                disabled={Boolean(busyId) || pendingContributionChange != null || status === 'ACTIVE'}
              />
              <Action
                label="Inativar"
                onPress={() => beginParticipationChange(user.id, 'INACTIVE')}
                disabled={Boolean(busyId) || pendingContributionChange != null || status !== 'ACTIVE'}
              />
              <Action
                label="Remover"
                danger
                onPress={() => beginParticipationChange(user.id, 'REMOVED')}
                disabled={Boolean(busyId) || pendingContributionChange != null || status === 'REMOVED'}
              />
            </View>
            {pendingForUser ? (
              <ContributionLifecycleConfirmation
                change={pendingForUser}
                rounds={lifecycleRounds}
                busy={Boolean(busyId)}
                onSelectRound={(roundOrder) =>
                  setPendingContributionChange((current) =>
                    current == null
                      ? current
                      : { ...current, roundOrder, preview: null, confirmation: '' },
                  )
                }
                onPreview={() => void previewContributionAccountChange()}
                onConfirmationChange={(confirmation) =>
                  setPendingContributionChange((current) =>
                    current == null ? current : { ...current, confirmation },
                  )
                }
                onConfirm={() => void confirmContributionAccountChange()}
                onCancel={() => setPendingContributionChange(null)}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function ContributionLifecycleConfirmation({
  change,
  rounds,
  busy,
  onSelectRound,
  onPreview,
  onConfirmationChange,
  onConfirm,
  onCancel,
}: {
  change: PendingContributionMembershipChange;
  rounds: readonly ContributionRoundOption[];
  busy: boolean;
  onSelectRound: (roundOrder: number) => void;
  onPreview: () => void;
  onConfirmationChange: (confirmation: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isActivation = change.status === 'ACTIVE';
  const label = isActivation ? 'Primeira rodada cobrada' : 'Última rodada cobrada';
  const selectionMissing = change.roundOrder == null;
  return (
    <View style={styles.lifecycle} accessibilityLabel="Configuração de contribuições">
      <Text style={styles.lifecycleTitle}>{label}</Text>
      <Text style={styles.lifecycleCopy}>
        {isActivation
          ? 'Escolha a primeira rodada que este participante deverá contribuir.'
          : 'Escolha a última rodada que este participante deverá contribuir antes de sair da competição.'}
      </Text>
      <View style={styles.roundChoices}>
        {rounds.map((round) => {
          const selected = round.order === change.roundOrder;
          return (
            <Pressable
              key={round.order}
              accessibilityRole="button"
              accessibilityLabel={`Rodada ${round.order}`}
              accessibilityState={{ selected, disabled: busy }}
              disabled={busy}
              onPress={() => onSelectRound(round.order)}
              style={[styles.roundChoice, selected && styles.roundChoiceSelected, busy && styles.disabled]}
            >
              <Text style={[styles.roundChoiceText, selected && styles.roundChoiceTextSelected]}>
                {round.name ?? `Rodada ${round.order}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {rounds.length === 0 ? (
        <Text role="alert" style={styles.error}>
          Não há rodadas elegíveis para configurar esta conta.
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Action label="Cancelar" onPress={onCancel} disabled={busy} secondary />
        <Action
          label="Revisar alteração"
          onPress={onPreview}
          disabled={busy || selectionMissing || rounds.length === 0}
        />
      </View>
      {change.preview ? (
        <View style={styles.confirm}>
          <Text style={styles.lifecycleCopy}>
            Digite exatamente: <Text style={styles.proof}>{change.preview.confirmation}</Text>
          </Text>
          <TextInput
            accessibilityLabel="Confirmação da conta de contribuições"
            value={change.confirmation}
            onChangeText={onConfirmationChange}
            autoCapitalize="characters"
            style={styles.input}
          />
          <Action
            label="Confirmar e salvar participação"
            onPress={onConfirm}
            disabled={busy || change.confirmation !== change.preview.confirmation}
          />
        </View>
      ) : null}
    </View>
  );
}

function Action({
  label,
  onPress,
  disabled,
  danger,
  secondary,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, danger && styles.danger, secondary && styles.secondary, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: 10,
    marginTop: 18,
    padding: 16,
  },
  title: { color: theme.color.text, fontSize: 18, fontWeight: '900' },
  copy: { color: theme.color.textMuted, lineHeight: 20 },
  contributionCopy: { color: theme.color.gold, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  user: { borderTopColor: theme.color.borderMuted, borderTopWidth: 1, gap: 8, paddingTop: 12 },
  userTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  name: { color: theme.color.text, fontSize: 16, fontWeight: '800' },
  meta: { color: theme.color.textMuted, fontSize: 12 },
  status: { color: theme.color.accent, fontSize: 12, fontWeight: '800' },
  contributionStatus: { color: theme.color.textSubtle, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderRadius: 8,
    borderWidth: 1,
    color: theme.color.text,
    flex: 1,
    minWidth: 170,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { backgroundColor: theme.color.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 },
  danger: { backgroundColor: '#c73c49' },
  secondary: { backgroundColor: 'transparent', borderColor: theme.color.borderStrong, borderWidth: 1 },
  secondaryText: { color: theme.color.text },
  disabled: { opacity: 0.45 },
  buttonText: { color: theme.color.accentInk, fontSize: 12, fontWeight: '800' },
  message: { color: theme.color.accent, fontWeight: '700' },
  error: { color: '#f07078', fontWeight: '700' },
  lifecycle: {
    backgroundColor: theme.color.canvas,
    borderColor: theme.color.gold,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    gap: theme.space.sm,
    marginTop: theme.space.xs,
    padding: theme.space.md,
  },
  lifecycleTitle: { color: theme.color.gold, fontSize: 13, fontWeight: '900' },
  lifecycleCopy: { color: theme.color.textMuted, fontSize: 12, lineHeight: 18 },
  roundChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs },
  roundChoice: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
  },
  roundChoiceSelected: { backgroundColor: theme.color.accentMuted, borderColor: theme.color.accent },
  roundChoiceText: { color: theme.color.textMuted, fontSize: 12, fontWeight: '800' },
  roundChoiceTextSelected: { color: theme.color.accent },
  confirm: { borderTopColor: theme.color.border, borderTopWidth: 1, gap: theme.space.sm, paddingTop: theme.space.md },
  proof: { color: theme.color.gold, fontFamily: 'monospace', fontWeight: '900' },
});
