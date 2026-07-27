import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { theme } from '../theme/tokens';

type ToastTone = 'success' | 'error' | 'info';
interface ToastMessage { id: number; message: string; tone: ToastTone }
interface ToastContextValue { showToast: (message: string, tone?: ToastTone) => void }

const ToastContext = createContext<ToastContextValue>({ showToast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const nextId = useRef(0);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string, tone: ToastTone = 'info') {
    if (timer.current) clearTimeout(timer.current);
    const next = { id: ++nextId.current, message, tone };
    setToast(next);
    timer.current = setTimeout(() => setToast((current) => (current?.id === next.id ? null : current)), 5000);
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast ? (
        <View
          accessibilityLiveRegion={toast.tone === 'error' ? 'assertive' : 'polite'}
          accessibilityRole={toast.tone === 'error' ? 'alert' : 'summary'}
          style={[
            styles.toast,
            Platform.OS === 'web' ? toastWeb : undefined,
            toast.tone === 'error' && styles.error,
            toast.tone === 'success' && styles.success,
          ]}
        >
          <Ionicons
            name={
              toast.tone === 'success'
                ? 'checkmark-circle'
                : toast.tone === 'error'
                  ? 'alert-circle'
                  : 'information-circle'
            }
            size={20}
            color={
              toast.tone === 'success'
                ? theme.color.success
                : toast.tone === 'error'
                  ? theme.color.danger
                  : theme.color.info
            }
          />
          <Text style={styles.text}>{toast.message}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar aviso"
            onPress={() => setToast(null)}
            style={styles.close}
          >
            <Text style={styles.closeText}>Fechar</Text>
          </Pressable>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  toast: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.info,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    bottom: theme.size.bottomNavigation + theme.space.lg,
    elevation: 12,
    flexDirection: 'row',
    gap: theme.space.md,
    maxWidth: 560,
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
    position: 'absolute',
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 14,
    zIndex: 1000,
  },
  success: {
    backgroundColor: '#0d2a2d',
    borderColor: theme.color.success,
  },
  error: {
    backgroundColor: '#2a1c2b',
    borderColor: theme.color.danger,
  },
  text: { color: theme.color.text, flex: 1, fontWeight: '700' },
  close: { justifyContent: 'center', minHeight: theme.touchTarget, paddingHorizontal: 4 },
  closeText: { color: theme.color.textMuted, fontWeight: '800' },
});

const toastWeb = {
  bottom: `calc(${theme.size.bottomNavigation + theme.space.lg}px + env(safe-area-inset-bottom))`,
  position: 'fixed',
} as never;
