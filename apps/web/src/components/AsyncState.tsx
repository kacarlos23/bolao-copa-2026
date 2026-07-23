import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme/tokens';

export type AsyncStatus =
  | 'idle'
  | 'loading'
  | 'refreshing'
  | 'success'
  | 'empty'
  | 'error'
  | 'offline';

function Skeleton({ lines = 4 }: { lines?: number }) {
  return (
    <View accessibilityLabel="Carregando conteúdo" style={styles.skeleton}>
      {Array.from({ length: lines }, (_, index) => (
        <View
          key={index}
          style={[styles.skeletonLine, index === lines - 1 && styles.skeletonLineShort]}
        />
      ))}
    </View>
  );
}

export function AsyncState({
  status,
  children,
  error,
  emptyTitle = 'Nada por aqui ainda',
  emptyMessage = 'Os dados aparecerão assim que estiverem disponíveis.',
  onRetry,
  skeletonLines,
}: {
  status: AsyncStatus;
  children?: ReactNode;
  error?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  onRetry?: () => void;
  skeletonLines?: number;
}) {
  if (status === 'loading' && !children) return <Skeleton lines={skeletonLines} />;
  if (status === 'empty') {
    return (
      <View style={styles.message} accessibilityRole="summary">
        <Text style={styles.title}>{emptyTitle}</Text>
        <Text style={styles.body}>{emptyMessage}</Text>
      </View>
    );
  }
  if (status === 'error' && !children) {
    return (
      <View style={styles.message} accessibilityRole="alert">
        <Text style={styles.title}>Não foi possível carregar</Text>
        <Text style={styles.error}>{error ?? 'Tente novamente em instantes.'}</Text>
        {onRetry ? (
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
            <Text style={styles.retryText}>Tentar novamente</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  if (status === 'offline' && !children) {
    return (
      <View style={styles.message} accessibilityRole="alert">
        <Text style={styles.title}>Sem conexão</Text>
        <Text style={styles.body}>Mostraremos os dados salvos assim que a conexão voltar.</Text>
        {onRetry ? (
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
            <Text style={styles.retryText}>Tentar novamente</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  return (
    <View>
      {children}
      {status === 'refreshing' ? (
        <Text accessibilityLiveRegion="polite" style={styles.refreshing}>
          Atualizando sem interromper sua leitura…
        </Text>
      ) : null}
      {status === 'error' ? (
        <View style={styles.inlineError} accessibilityRole="alert">
          <Text style={styles.error}>{error}</Text>
          {onRetry ? (
            <Pressable accessibilityRole="button" onPress={onRetry} style={styles.inlineRetry}>
              <Text style={styles.retryText}>Tentar novamente</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {status === 'offline' ? (
        <Text accessibilityLiveRegion="polite" style={styles.refreshing}>
          Sem conexão. Exibindo os últimos dados disponíveis.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: theme.space.sm, paddingVertical: theme.space.lg },
  skeletonLine: {
    backgroundColor: 'rgba(145, 174, 204, 0.18)',
    borderRadius: theme.radius.sm,
    height: 54,
    width: '100%',
  },
  skeletonLineShort: { width: '62%' },
  message: { alignItems: 'flex-start', gap: theme.space.sm, paddingVertical: theme.space.xl },
  title: { color: theme.color.text, fontSize: 18, fontWeight: '800' },
  body: { color: theme.color.textMuted, lineHeight: 21 },
  error: { color: theme.color.danger, lineHeight: 20 },
  retry: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.sm,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  inlineRetry: { justifyContent: 'center', minHeight: theme.touchTarget, paddingHorizontal: 8 },
  retryText: { color: theme.color.accentInk, fontWeight: '900' },
  refreshing: { color: theme.color.info, fontSize: 12, marginTop: theme.space.sm },
  inlineError: { alignItems: 'center', flexDirection: 'row', gap: theme.space.sm, marginTop: 8 },
});
