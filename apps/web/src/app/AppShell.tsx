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
  backgroundAttachment: 'fixed',
  backgroundImage: [
    'radial-gradient(900px 520px at 50% -10%, rgba(39, 133, 214, 0.16), transparent 64%)',
    'linear-gradient(145deg, #001033 0%, #00224f 52%, #00163c 100%)',
  ].join(', '),
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
  minHeight: '100vh',
} as never;
