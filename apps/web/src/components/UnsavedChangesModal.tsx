import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MotionModal, MotionPressable } from '../motion';
import { theme } from '../theme/tokens';

export function UnsavedChangesModal({
  visible,
  onContinue,
  onKeepDraft,
  onDiscard,
}: {
  visible: boolean;
  onContinue: () => void;
  onKeepDraft: () => void;
  onDiscard: () => void;
}) {
  const continueRef = useRef<View>(null);

  return (
    <MotionModal
      describedBy="unsaved-description"
      initialFocusRef={continueRef}
      labelledBy="unsaved-title"
      onRequestClose={onContinue}
      panelStyle={styles.card}
      visible={visible}
    >
      <Text nativeID="unsaved-title" role="heading" aria-level={2} style={styles.title}>
        Alterações não salvas
      </Text>
      <Text nativeID="unsaved-description" style={styles.description}>
        Há edições que ainda não foram confirmadas pelo servidor neste contexto.
      </Text>
      <View style={styles.actions}>
        <MotionPressable
          ref={continueRef}
          {...({ tabIndex: 0 } as object)}
          accessibilityRole="button"
          onPress={onContinue}
          style={[styles.button, styles.secondary]}
        >
          <Text style={styles.secondaryText}>Continuar editando</Text>
        </MotionPressable>
        <MotionPressable
          accessibilityRole="button"
          onPress={onKeepDraft}
          style={[styles.button, styles.secondary]}
        >
          <Text style={styles.secondaryText}>Sair e manter rascunho</Text>
        </MotionPressable>
        <MotionPressable
          accessibilityRole="button"
          onPress={onDiscard}
          style={[styles.button, styles.danger]}
        >
          <Text style={styles.dangerText}>Descartar alterações e sair</Text>
        </MotionPressable>
      </View>
    </MotionModal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    gap: theme.space.md,
    maxWidth: 560,
    padding: theme.space.xl,
    width: '100%',
  },
  title: { color: theme.color.text, fontSize: 24, fontWeight: '900' },
  description: { color: theme.color.textMuted, fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginTop: 4 },
  button: {
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
  },
  secondary: { borderColor: theme.color.border },
  secondaryText: { color: theme.color.text, fontSize: 12, fontWeight: '800' },
  danger: { backgroundColor: theme.color.dangerMuted, borderColor: theme.color.danger },
  dangerText: { color: theme.color.danger, fontSize: 12, fontWeight: '900' },
});
