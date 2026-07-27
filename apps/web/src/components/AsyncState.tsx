import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { theme } from '../theme/tokens';

export type AsyncStatus =
  | 'idle'
  | 'loading'
  | 'refreshing'
  | 'success'
  | 'empty'
  | 'error'
  | 'offline';

export function Skeleton({ lines = 4 }: { lines?: number }) {
  return (
    <View accessibilityLabel="Carregando conteúdo" style={styles.skeleton}>
      {Array.from({ length: lines }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={styles.skeletonMarker} />
          <View
            style={[styles.skeletonLine, index === lines - 1 && styles.skeletonLineShort]}
          />
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.message} accessibilityRole="summary">
      <View style={styles.messageIcon}>
        <Ionicons name="calendar-clear-outline" size={22} color={theme.color.textMuted} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{message}</Text>
    </View>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.message} accessibilityRole="alert">
      <View style={[styles.messageIcon, styles.messageIconError]}>
        <Ionicons name="alert-circle-outline" size={22} color={theme.color.danger} />
      </View>
      <Text style={styles.title}>Não foi possível carregar</Text>
      <Text style={styles.error}>{error}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
          <Text style={styles.retryText}>Tentar novamente</Text>
        </Pressable>
      ) : null}
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
    return <EmptyState title={emptyTitle} message={emptyMessage} />;
  }
  if (status === 'error' && !children) {
    return <ErrorState error={error ?? 'Tente novamente em instantes.'} onRetry={onRetry} />;
  }
  if (status === 'offline' && !children) {
    return (
      <View style={styles.message} accessibilityRole="alert">
        <View style={styles.messageIcon}>
          <Ionicons name="cloud-offline-outline" size={22} color={theme.color.warning} />
        </View>
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
  skeleton: { gap: theme.space.md, paddingVertical: theme.space.lg },
  skeletonRow: { alignItems: 'center', flexDirection: 'row', gap: theme.space.md },
  skeletonMarker: {
    backgroundColor: theme.color.surfaceHover,
    borderRadius: theme.radius.md,
    height: 42,
    width: 42,
  },
  skeletonLine: {
    backgroundColor: theme.color.surfaceHover,
    borderRadius: theme.radius.sm,
    flex: 1,
    height: 42,
  },
  skeletonLineShort: { width: '62%' },
  message: {
    alignItems: 'flex-start',
    gap: theme.space.sm,
    maxWidth: 560,
    paddingVertical: theme.space.xxl,
  },
  messageIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(169, 184, 201, 0.10)',
    borderRadius: theme.radius.md,
    height: 44,
    justifyContent: 'center',
    marginBottom: theme.space.xs,
    width: 44,
  },
  messageIconError: { backgroundColor: theme.color.dangerMuted },
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
    marginTop: theme.space.xs,
  },
  inlineRetry: { justifyContent: 'center', minHeight: theme.touchTarget, paddingHorizontal: 8 },
  retryText: { color: theme.color.accentInk, fontWeight: '900' },
  refreshing: { color: theme.color.info, fontSize: 12, marginTop: theme.space.md },
  inlineError: {
    alignItems: 'center',
    backgroundColor: theme.color.dangerMuted,
    borderLeftColor: theme.color.danger,
    borderLeftWidth: 3,
    flexDirection: 'row',
    gap: theme.space.sm,
    marginTop: theme.space.md,
    paddingHorizontal: theme.space.md,
  },
});
