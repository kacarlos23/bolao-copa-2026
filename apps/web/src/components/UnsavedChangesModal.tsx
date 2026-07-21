import { useEffect, useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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
  const originRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof document === 'undefined') return;
    originRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const node = continueRef.current as unknown as { focus?: () => void };
      node?.focus?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  function close(action: () => void) {
    action();
    if (Platform.OS === 'web') requestAnimationFrame(() => originRef.current?.focus?.());
  }

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={() => close(onContinue)}
    >
      <View
        role="dialog"
        aria-modal
        aria-labelledby="unsaved-title"
        aria-describedby="unsaved-description"
        accessibilityViewIsModal
        style={styles.backdrop}
      >
        <View style={styles.card}>
          <Text nativeID="unsaved-title" role="heading" aria-level={2} style={styles.title}>
            Alterações não salvas
          </Text>
          <Text nativeID="unsaved-description" style={styles.description}>
            Há edições que ainda não foram confirmadas pelo servidor neste contexto.
          </Text>
          <View style={styles.actions}>
            <Pressable
              ref={continueRef}
              {...({ tabIndex: 0 } as never)}
              accessibilityRole="button"
              onPress={() => close(onContinue)}
              style={[styles.button, styles.secondary]}
            >
              <Text style={styles.secondaryText}>Continuar editando</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => close(onKeepDraft)}
              style={[styles.button, styles.secondary]}
            >
              <Text style={styles.secondaryText}>Sair e manter rascunho</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => close(onDiscard)}
              style={[styles.button, styles.danger]}
            >
              <Text style={styles.dangerText}>Descartar alterações e sair</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 9, 28, 0.82)',
    flex: 1,
    justifyContent: 'center',
    padding: theme.space.lg,
  },
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
  danger: { backgroundColor: 'rgba(255, 107, 89, 0.12)', borderColor: theme.color.danger },
  dangerText: { color: theme.color.danger, fontSize: 12, fontWeight: '900' },
});
