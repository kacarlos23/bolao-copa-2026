import { Suspense, useEffect, type ReactNode, type RefObject } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import type { User } from '../api';
import { SoftReveal } from '../motion';
import {
  competitionForScreen,
  leagueScreens,
  screenForPrimaryDestination,
  worldCupScreens,
  type AppScreen,
} from '../navigation/routes';
import { theme } from '../theme/tokens';
import { useCompetition } from './CompetitionContext';
import { AppHeader } from './AppHeader';
import { CompetitionSubnav } from './CompetitionSubnav';

export function RoutedWorkspace({
  user,
  screen,
  content,
  scrollRef,
  onScroll,
  onNavigate,
  onRefresh,
  onUserChange,
  requestContextChange,
  onLogout,
}: {
  user: User;
  screen: AppScreen;
  content: ReactNode;
  scrollRef: RefObject<ScrollView | null>;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onNavigate: (screen: AppScreen) => void;
  onRefresh: () => void;
  onUserChange: (user: User) => void;
  requestContextChange: (action: () => void) => void;
  onLogout: () => void;
}) {
  const context = useCompetition();
  const { width } = useWindowDimensions();
  const compact = width < 768;

  useEffect(() => {
    if (!context.competitions.length) return;
    const desired = competitionForScreen(context.competitions, screen);
    if (desired && desired.id !== context.competition?.id) {
      void context.selectCompetition(desired.id);
    }
  }, [context.competition?.id, context.competitions, screen]);

  const routeCapabilities = leagueScreens.has(screen)
    ? new Set(['LEAGUE'])
    : worldCupScreens.has(screen)
      ? new Set(['GROUPS', 'KNOCKOUT'])
      : context.capabilities;

  return (
    <>
      <AppHeader
        user={user}
        screen={screen}
        competitionName={
          leagueScreens.has(screen) || worldCupScreens.has(screen)
            ? (context.season?.name ?? context.competition?.name)
            : null
        }
        primaryScreenFor={(destination) =>
          screenForPrimaryDestination(destination, routeCapabilities)
        }
        onNavigatePrimary={(destination) =>
          onNavigate(screenForPrimaryDestination(destination, routeCapabilities))
        }
        onRefresh={onRefresh}
        onUserChange={onUserChange}
        onNavigateAdmin={user.role === 'ADMIN' ? () => onNavigate('admin') : undefined}
        onLogout={onLogout}
      />
      <CompetitionSubnav
        screen={screen}
        competitionName={context.season?.name ?? context.competition?.name}
        seasons={context.seasons}
        selectedSeasonId={context.season?.id}
        onNavigate={onNavigate}
        onSelectSeason={(seasonId) => {
          if (seasonId === context.season?.id) return;
          requestContextChange(() => context.selectSeason(seasonId));
        }}
      />
      <ScrollView
        {...({ tabIndex: -1 } as never)}
        ref={scrollRef}
        nativeID="conteudo-principal"
        role="main"
        style={styles.scroll}
        contentContainerStyle={[styles.content, compact && styles.contentCompact]}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <SoftReveal key={screen} style={styles.reveal}>
          <Suspense
            fallback={<ActivityIndicator color={theme.color.accent} style={styles.loader} />}
          >
            {content}
          </Suspense>
        </SoftReveal>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    marginHorizontal: 'auto',
    maxWidth: 1280,
    paddingBottom: 40,
    paddingHorizontal: theme.space.xl,
    paddingTop: theme.space.xl,
    width: '100%',
  },
  contentCompact: {
    paddingBottom: 28,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.lg,
  },
  reveal: { minHeight: 320, width: '100%' },
  loader: { marginTop: 72 },
});
