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
  competitionSectionForScreen,
  pageTitle,
  screenForPrimaryDestination,
  type AppScreen,
  type CompetitionSection,
} from '../navigation/routes';
import { theme } from '../theme/tokens';
import { useCompetition } from './CompetitionContext';
import { AppHeader } from './AppHeader';
import { CompetitionSubnav } from './CompetitionSubnav';

export function RoutedWorkspace({
  user,
  screen,
  competitionSlug,
  content,
  scrollRef,
  onScroll,
  onNavigate,
  onNavigateCompetition,
  onRefresh,
  onUserChange,
  requestContextChange,
  onLogout,
}: {
  user: User;
  screen: AppScreen;
  competitionSlug?: string | null;
  content: ReactNode;
  scrollRef: RefObject<ScrollView | null>;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onNavigate: (screen: AppScreen) => void;
  onNavigateCompetition: (competitionSlug: string, section: CompetitionSection) => void;
  onRefresh: () => void;
  onUserChange: (user: User) => void;
  requestContextChange: (action: () => void) => void;
  onLogout: () => void;
}) {
  const context = useCompetition();
  const { width } = useWindowDimensions();
  const compact = width < 768;

  useEffect(() => {
    if (!context.competitions.length || !competitionSlug) return;
    const desired = context.competitions.find((item) => item.slug === competitionSlug);
    if (desired && desired.id !== context.competition?.id) {
      void context.selectCompetition(desired.id);
    }
  }, [competitionSlug, context.competition?.id, context.competitions]);

  const section = competitionSectionForScreen(screen);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = pageTitle(screen, context.season?.name ?? context.competition?.name);
  }, [context.competition?.name, context.season?.name, screen]);

  return (
    <>
      <AppHeader
        user={user}
        screen={screen}
        competitionSlug={competitionSlug}
        competitionName={section ? (context.season?.name ?? context.competition?.name) : null}
        primaryScreenFor={screenForPrimaryDestination}
        onNavigatePrimary={(destination) => {
          const destinationScreen = screenForPrimaryDestination(destination);
          const destinationSection = competitionSectionForScreen(destinationScreen);
          if (destinationSection && (competitionSlug ?? context.competition?.slug)) {
            onNavigateCompetition(
              (competitionSlug ?? context.competition?.slug)!,
              destinationSection,
            );
          } else {
            onNavigate(destinationScreen);
          }
        }}
        onRefresh={onRefresh}
        onUserChange={onUserChange}
        onNavigateAdmin={user.role === 'ADMIN' ? () => onNavigate('admin') : undefined}
        onLogout={onLogout}
      />
      <CompetitionSubnav
        section={section}
        competitionSlug={competitionSlug}
        competitionName={context.season?.name ?? context.competition?.name}
        seasons={context.seasons}
        selectedSeasonId={context.season?.id}
        onNavigate={(destinationSection) => {
          if (competitionSlug) onNavigateCompetition(competitionSlug, destinationSection);
        }}
        onChangeCompetition={() => onNavigate('competitions')}
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
