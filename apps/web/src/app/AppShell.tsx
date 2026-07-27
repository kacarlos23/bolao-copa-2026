import { createElement, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { theme } from '../theme/tokens';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <View style={[styles.root, webBackground]}>
      <StatusBar style="light" />
      {Platform.OS === 'web'
        ? createElement(
            'a',
            { className: 'skip-link', href: '#conteudo-principal' },
            'Pular para o conteúdo principal',
          )
        : null}
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
  backgroundImage: [
    'radial-gradient(720px 360px at 50% -12%, rgba(168, 230, 0, 0.055), transparent 68%)',
    'linear-gradient(180deg, #030c17 0%, #061426 28%, #061426 100%)',
  ].join(', '),
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
  minHeight: '100dvh',
} as never;
