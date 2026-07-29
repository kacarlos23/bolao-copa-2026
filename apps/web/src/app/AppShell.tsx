import { createElement, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { MotionProvider } from '../motion';
import { theme } from '../theme/tokens';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <MotionProvider>
      <View style={[styles.root, webBackground]}>
        <StatusBar style="light" />
        {Platform.OS === 'web' ? (
          <>
            <View
              {...({ 'data-motion-depth': true } as object)}
              pointerEvents="none"
              style={ambientWeb}
            />
            <View
              {...({ 'data-motion-scroll-progress': true } as object)}
              pointerEvents="none"
              style={progressWeb}
            />
            {createElement(
              'a',
              { className: 'skip-link', href: '#conteudo-principal' },
              'Pular para o conteúdo principal',
            )}
          </>
        ) : null}
        {children}
      </View>
    </MotionProvider>
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

const ambientWeb = {
  backgroundImage: [
    'radial-gradient(520px 280px at 16% 8%, rgba(168, 230, 0, 0.045), transparent 70%)',
    'radial-gradient(680px 360px at 84% 18%, rgba(116, 71, 232, 0.075), transparent 72%)',
  ].join(', '),
  inset: '-18px 0 0',
  pointerEvents: 'none',
  position: 'fixed',
  zIndex: 0,
} as never;

const progressWeb = {
  backgroundColor: theme.color.accent,
  boxShadow: '0 0 14px rgba(168, 230, 0, 0.44)',
  height: 2,
  left: 0,
  position: 'fixed',
  right: 0,
  top: 0,
  transform: 'scaleX(0)',
  transformOrigin: 'left center',
  zIndex: 1001,
} as never;
