import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { PredictionSubmissionParticipantDto } from '@bolao/shared';
import { UserAvatar } from '../../components/UserAvatar';
import { theme } from '../../theme/tokens';

function ParticipantGroup({
  title,
  participants,
  currentUserId,
  saved,
}: {
  title: string;
  participants: PredictionSubmissionParticipantDto[];
  currentUserId: string;
  saved: boolean;
}) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <Text role="heading" aria-level={3} style={styles.groupTitle}>
          {title}
        </Text>
        <Text style={[styles.groupCount, saved && styles.groupCountSaved]}>
          {participants.length}
        </Text>
      </View>
      {participants.length ? (
        participants.map((participant) => (
          <View
            key={participant.userId}
            style={styles.participantRow}
            accessibilityLabel={`${participant.nickname}, ${
              saved ? 'palpites salvos' : 'falta palpitar'
            }`}
          >
            <UserAvatar
              nickname={participant.nickname}
              avatarUrl={participant.avatarUrl}
              size={38}
            />
            <View style={styles.participantIdentity}>
              <Text style={styles.nickname} numberOfLines={1}>
                {participant.nickname}
              </Text>
              {participant.userId === currentUserId ? <Text style={styles.you}>VOCÊ</Text> : null}
            </View>
            <View style={styles.status}>
              <View style={[styles.statusDot, saved && styles.statusDotSaved]} />
              <Text style={[styles.statusText, saved && styles.statusTextSaved]}>
                {saved ? 'Salvos' : 'Falta palpitar'}
              </Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.emptyGroup}>
          {saved ? 'Ninguém concluiu os palpites ainda.' : 'Todo mundo já salvou os palpites.'}
        </Text>
      )}
    </View>
  );
}

export function PredictionSubmissionStatusModal({
  visible,
  matchTitle,
  requiredPredictions,
  participants,
  currentUserId,
  loading,
  error,
  onRefresh,
  onClose,
}: {
  visible: boolean;
  matchTitle: string;
  requiredPredictions: number;
  participants: PredictionSubmissionParticipantDto[];
  currentUserId: string;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const pending = participants.filter((participant) => !participant.hasSavedPredictions);
  const saved = participants.filter((participant) => participant.hasSavedPredictions);

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          role="dialog"
          aria-modal
          accessibilityViewIsModal
          accessibilityLabel="Situação dos palpites dos participantes"
          style={styles.modal}
        >
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text role="heading" aria-level={2} style={styles.title}>
                Quem falta palpitar
              </Text>
              <Text style={styles.subtitle}>{matchTitle} · situação por participante</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Atualizar situação dos palpites"
                disabled={loading}
                onPress={onRefresh}
                style={[styles.refreshButton, loading && styles.disabled]}
              >
                <Text style={styles.refreshText}>Atualizar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fechar situação dos palpites"
                onPress={onClose}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.privacyNote}>
            <Text style={styles.privacyTitle}>Somente a situação de envio fica visível.</Text>
            <Text style={styles.privacyText}>
              Os placares de cada pessoa continuam privados até o encerramento do prazo.
            </Text>
          </View>

          {loading ? <ActivityIndicator color={theme.color.accent} style={styles.loading} /> : null}
          {!loading && error ? (
            <View style={styles.errorBlock}>
              <Text style={styles.error}>{error}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tentar carregar situação novamente"
                onPress={onRefresh}
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>Tentar novamente</Text>
              </Pressable>
            </View>
          ) : null}
          {!loading && !error && requiredPredictions === 0 ? (
            <Text style={styles.empty}>
              O prazo desta partida terminou ou ela não está aberta para palpites.
            </Text>
          ) : null}
          {!loading && !error && requiredPredictions > 0 ? (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              <ParticipantGroup
                title="Falta palpitar"
                participants={pending}
                currentUserId={currentUserId}
                saved={false}
              />
              <ParticipantGroup
                title="Palpites salvos"
                participants={saved}
                currentUserId={currentUserId}
                saved
              />
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: theme.color.overlay,
    flex: 1,
    justifyContent: 'center',
    padding: theme.space.lg,
  },
  modal: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    maxHeight: '88%',
    maxWidth: 680,
    padding: theme.space.lg,
    width: '100%',
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: theme.space.md,
    justifyContent: 'space-between',
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: theme.color.text, fontSize: 21, fontWeight: '900' },
  subtitle: { color: theme.color.textMuted, fontSize: 12, marginTop: 4 },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: theme.space.sm },
  refreshButton: {
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
  },
  refreshText: { color: theme.color.text, fontSize: 11, fontWeight: '900' },
  closeButton: {
    alignItems: 'center',
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    height: theme.touchTarget,
    justifyContent: 'center',
    width: theme.touchTarget,
  },
  closeText: { color: theme.color.text, fontSize: 28, lineHeight: 30 },
  privacyNote: {
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    borderTopColor: theme.color.borderMuted,
    borderTopWidth: 1,
    marginTop: theme.space.lg,
    paddingVertical: theme.space.md,
  },
  privacyTitle: { color: theme.color.accent, fontSize: 11, fontWeight: '900' },
  privacyText: { color: theme.color.textMuted, fontSize: 11, lineHeight: 17, marginTop: 3 },
  loading: { marginVertical: theme.space.xxl },
  errorBlock: { alignItems: 'flex-start', gap: theme.space.md, paddingVertical: theme.space.xl },
  error: { color: theme.color.danger, fontSize: 12, fontWeight: '700' },
  retryButton: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.sm,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  retryText: { color: theme.color.accentInk, fontSize: 11, fontWeight: '900' },
  list: { maxHeight: 480 },
  listContent: { gap: theme.space.lg, paddingTop: theme.space.md },
  group: { gap: 0 },
  groupHeader: {
    alignItems: 'center',
    borderBottomColor: theme.color.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: theme.space.sm,
  },
  groupTitle: {
    color: theme.color.text,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  groupCount: {
    backgroundColor: theme.color.warningMuted,
    borderRadius: theme.radius.pill,
    color: theme.color.warning,
    fontSize: 10,
    fontWeight: '900',
    minWidth: 28,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    textAlign: 'center',
  },
  groupCountSaved: {
    backgroundColor: theme.color.successMuted,
    color: theme.color.success,
  },
  participantRow: {
    alignItems: 'center',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: theme.space.md,
    minHeight: 60,
    paddingVertical: theme.space.sm,
  },
  participantIdentity: { flex: 1, minWidth: 0 },
  nickname: { color: theme.color.text, fontSize: 13, fontWeight: '900' },
  you: {
    color: theme.color.gold,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginTop: 3,
  },
  status: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  statusDot: {
    backgroundColor: theme.color.warning,
    borderRadius: theme.radius.pill,
    height: 7,
    width: 7,
  },
  statusDotSaved: { backgroundColor: theme.color.success },
  statusText: { color: theme.color.warning, fontSize: 10, fontWeight: '900' },
  statusTextSaved: { color: theme.color.success },
  emptyGroup: {
    color: theme.color.textMuted,
    fontSize: 11,
    paddingVertical: theme.space.lg,
  },
  empty: {
    color: theme.color.textMuted,
    paddingVertical: theme.space.xxl,
    textAlign: 'center',
  },
  disabled: { opacity: 0.48 },
});
