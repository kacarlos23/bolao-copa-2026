import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { theme } from '../theme/tokens';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <View style={[styles.root, webBackground]}>
      <StatusBar style="light" />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: theme.color.canvas,
    flex: 1,
  },
});

const webBackground = {
  backgroundAttachment: 'fixed',
  backgroundImage: [
    'radial-gradient(950px 520px at 8% 92%, rgba(0, 170, 89, 0.35), transparent 62%)',
    'radial-gradient(900px 520px at 94% 96%, rgba(255, 211, 21, 0.34), transparent 58%)',
    'radial-gradient(1100px 620px at 58% 8%, rgba(39, 133, 214, 0.22), transparent 60%)',
    'linear-gradient(135deg, #001033 0%, #00275f 42%, #00133d 100%)',
  ].join(', '),
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
  minHeight: '100vh',
} as never;
