import { StyleSheet, Text, View } from 'react-native';
import type { ConnectionStatus } from '../services/realtime';
import { theme } from '../theme/tokens';

const labels: Record<ConnectionStatus, string> = {
  live: 'Ao vivo',
  reconnecting: 'Reconectando',
  offline: 'Offline',
};

export function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  return (
    <View
      accessibilityLabel={`Atualizações: ${labels[status]}`}
      accessibilityLiveRegion="polite"
      style={styles.row}
    >
      <View style={[styles.dot, styles[status]]} />
      <Text style={styles.label}>{labels[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 7, minHeight: theme.touchTarget },
  dot: { borderRadius: 5, height: 10, width: 10 },
  live: { backgroundColor: theme.color.accent },
  reconnecting: { backgroundColor: theme.color.warning },
  offline: { backgroundColor: theme.color.danger },
  label: { color: theme.color.textMuted, fontSize: 12, fontWeight: '800' },
});
