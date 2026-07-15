import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/tokens';

export function RouteState({
  title,
  message,
  actionLabel,
  onAction,
  tone = 'neutral',
}: {
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <View style={styles.page} role="region" accessibilityLabel={title}>
      <Ionicons
        name={tone === 'warning' ? 'warning-outline' : 'navigate-circle-outline'}
        size={34}
        color={tone === 'warning' ? theme.color.warning : theme.color.info}
      />
      <Text role="heading" aria-level={1} style={styles.title}>
        {title}
      </Text>
      <Text style={styles.message}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={onAction} style={styles.action}>
        <Text style={styles.actionText}>{actionLabel}</Text>
        <Ionicons name="arrow-forward" size={18} color={theme.color.accentInk} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    alignItems: 'flex-start',
    gap: theme.space.md,
    marginHorizontal: 'auto',
    maxWidth: 620,
    paddingVertical: 72,
    width: '100%',
  },
  title: { color: theme.color.text, fontSize: 28, fontWeight: '900' },
  message: { color: theme.color.textMuted, fontSize: 14, lineHeight: 22 },
  action: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.sm,
    flexDirection: 'row',
    gap: 8,
    marginTop: theme.space.sm,
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  actionText: { color: theme.color.accentInk, fontSize: 12, fontWeight: '900' },
});
