import { useEffect, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_URL, api, type User } from '../api';
import { ResponsiveContainer } from '../components/DesignSystem';
import {
  activePrimaryDestination,
  pathForScreen,
  type AppScreen,
  type PrimaryDestination,
} from '../navigation/routes';
import { RouteLink } from '../navigation/RouteLink';
import { theme } from '../theme/tokens';

type PrimaryItem = {
  key: PrimaryDestination;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const primaryItems: readonly PrimaryItem[] = [
  { key: 'home', label: 'Início', icon: 'home-outline' },
  { key: 'competitions', label: 'Competições', icon: 'trophy-outline' },
  { key: 'predictions', label: 'Palpites', icon: 'create-outline' },
  { key: 'ranking', label: 'Ranking', icon: 'podium-outline' },
];

function initials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

function avatarUri(value?: string | null) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_URL}${value.startsWith('/') ? '' : '/'}${value}`;
}

function Avatar({ user, size = 36 }: { user: User; size?: number }) {
  const uri = avatarUri(user.avatarUrl);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [uri]);
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri && !imageFailed ? (
        <Image
          source={{ uri }}
          onError={() => setImageFailed(true)}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : (
        <Text style={styles.avatarText}>{initials(user.nickname)}</Text>
      )}
    </View>
  );
}

function PrimaryNavigation({
  active,
  competitionSlug,
  mobile,
  resolvePrimaryScreen,
  onNavigatePrimary,
}: {
  active: PrimaryDestination | null;
  competitionSlug?: string | null;
  mobile: boolean;
  resolvePrimaryScreen: (destination: PrimaryDestination) => AppScreen;
  onNavigatePrimary: (destination: PrimaryDestination) => void;
}) {
  return (
    <View
      {...({ role: 'navigation' } as object)}
      accessibilityLabel="Navegação principal"
      testID={mobile ? 'mobile-primary-navigation' : 'desktop-primary-navigation'}
      style={[
        styles.primaryNavigation,
        mobile ? styles.mobilePrimaryNavigation : styles.desktopPrimaryNavigation,
        mobile && Platform.OS === 'web' ? mobilePrimaryNavigationWeb : undefined,
      ]}
    >
      {primaryItems.map((item) => {
        const selected = active === item.key;
        return (
          <RouteLink
            key={item.key}
            {...({ 'aria-current': selected ? 'page' : undefined } as object)}
            href={pathForScreen(resolvePrimaryScreen(item.key), { competitionSlug })}
            accessibilityLabel={item.label}
            accessibilityState={{ selected }}
            onActivate={() => onNavigatePrimary(item.key)}
            style={({ pressed }) => [
              styles.navItem,
              mobile ? styles.mobileNavItem : styles.desktopNavItem,
              selected && (mobile ? styles.mobileNavItemActive : styles.desktopNavItemActive),
              pressed && styles.navItemPressed,
            ]}
          >
            {mobile && selected ? <View style={styles.mobileActiveIndicator} /> : null}
            <Ionicons
              name={item.icon}
              size={mobile ? 21 : 18}
              color={selected ? theme.color.accent : theme.color.textMuted}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.navLabel,
                mobile ? styles.mobileNavLabel : styles.desktopNavLabel,
                selected && styles.navLabelActive,
              ]}
            >
              {item.label}
            </Text>
          </RouteLink>
        );
      })}
    </View>
  );
}

export function AppHeader({
  user,
  screen,
  competitionSlug,
  competitionName,
  primaryScreenFor,
  onNavigatePrimary,
  onRefresh,
  onUserChange,
  onNavigateAdmin,
  onLogout,
}: {
  user: User;
  screen: AppScreen;
  competitionSlug?: string | null;
  competitionName?: string | null;
  primaryScreenFor?: (destination: PrimaryDestination) => AppScreen;
  onNavigatePrimary: (destination: PrimaryDestination) => void;
  onRefresh: () => void;
  onUserChange: (user: User) => void;
  onNavigateAdmin?: () => void;
  onLogout: () => void;
}) {
  const { width } = useWindowDimensions();
  const compact = width < theme.breakpoint.compact;
  const condensed = width < theme.breakpoint.content;
  const [profileOpen, setProfileOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const active = activePrimaryDestination(screen);
  const resolvePrimaryScreen =
    primaryScreenFor ?? ((destination: PrimaryDestination) => destination as AppScreen);

  function showAvatarError(cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Não foi possível atualizar a foto.';
    if (typeof window !== 'undefined') window.alert(message);
  }

  function pickAvatar() {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        showAvatarError(new Error('Escolha uma imagem de até 8 MB.'));
        return;
      }
      setAvatarBusy(true);
      api
        .uploadAvatar(file)
        .then((result) => onUserChange(result.user))
        .catch(showAvatarError)
        .finally(() => setAvatarBusy(false));
    };
    input.click();
  }

  function removeAvatar() {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Remover sua foto e voltar ao avatar com iniciais?')
    ) {
      return;
    }
    setAvatarBusy(true);
    api
      .resetAvatar()
      .then((result) => onUserChange(result.user))
      .catch(showAvatarError)
      .finally(() => setAvatarBusy(false));
  }

  return (
    <View role="banner" style={styles.header}>
      <ResponsiveContainer
        style={[
          styles.topbar,
          compact && styles.topbarCompact,
          compact && Platform.OS === 'web' ? topbarSafeAreaWeb : undefined,
        ]}
      >
        <RouteLink
          href={pathForScreen('home')}
          accessibilityLabel="Bolão Sirel, ir para o início"
          onActivate={() => onNavigatePrimary('home')}
          style={({ pressed }) => [styles.brandLink, pressed && styles.brandLinkPressed]}
        >
          <View style={[styles.brandMark, compact && styles.brandMarkCompact]} accessibilityElementsHidden>
            <Ionicons name="football" size={compact ? 20 : 22} color={theme.color.accentInk} />
          </View>
          <View style={styles.brandCopy}>
            <Text style={[styles.brandName, compact && styles.brandNameCompact]}>Bolão Sirel</Text>
            {!condensed && competitionName ? (
              <Text style={styles.brandContext} numberOfLines={1}>
                {competitionName}
              </Text>
            ) : null}
          </View>
        </RouteLink>

        {!compact ? (
          <PrimaryNavigation
            active={active}
            competitionSlug={competitionSlug}
            mobile={false}
            resolvePrimaryScreen={resolvePrimaryScreen}
            onNavigatePrimary={onNavigatePrimary}
          />
        ) : null}

        <View style={styles.accountArea}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Atualizar dados"
            onPress={onRefresh}
            style={({ pressed }) => [styles.utilityButton, pressed && styles.utilityButtonPressed]}
          >
            <Ionicons name="refresh-outline" size={18} color={theme.color.textMuted} />
            {!condensed ? <Text style={styles.utilityText}>Atualizar</Text> : null}
          </Pressable>
          <View style={styles.profileAnchor}>
            <Pressable
              {...({ 'aria-controls': 'menu-perfil', 'aria-haspopup': 'menu' } as object)}
              accessibilityRole="button"
              accessibilityLabel={`Abrir menu de ${user.nickname}`}
              accessibilityState={{ expanded: profileOpen }}
              onPress={() => setProfileOpen((value) => !value)}
              style={({ pressed }) => [
                styles.profileButton,
                profileOpen && styles.profileButtonOpen,
                pressed && styles.profileButtonPressed,
              ]}
            >
              <Avatar user={user} size={compact ? 34 : 36} />
              {!condensed ? (
                <View style={styles.profileText}>
                  <Text style={styles.profileName} numberOfLines={1}>
                    {user.nickname}
                  </Text>
                  <Text style={styles.profileRole}>
                    {user.role === 'ADMIN' ? 'Administrador' : 'Participante'}
                  </Text>
                </View>
              ) : null}
              <Ionicons
                name={profileOpen ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={theme.color.textMuted}
              />
            </Pressable>
            {profileOpen ? (
              <View
                nativeID="menu-perfil"
                role="group"
                accessibilityLabel="Ações do perfil"
                style={[
                  styles.profileMenu,
                  compact && styles.profileMenuCompact,
                  Platform.OS === 'web' ? profileMenuWeb : undefined,
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Trocar foto"
                  disabled={avatarBusy}
                  onPress={pickAvatar}
                  style={({ pressed }) => [
                    styles.menuItem,
                    pressed && styles.menuItemPressed,
                    avatarBusy && styles.disabled,
                  ]}
                >
                  <Ionicons name="camera-outline" size={18} color={theme.color.text} />
                  <Text style={styles.menuText}>
                    {avatarBusy ? 'Atualizando...' : 'Trocar foto'}
                  </Text>
                </Pressable>
                {user.avatarUrl ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remover foto"
                    disabled={avatarBusy}
                    onPress={removeAvatar}
                    style={({ pressed }) => [
                      styles.menuItem,
                      pressed && styles.menuItemPressed,
                      avatarBusy && styles.disabled,
                    ]}
                  >
                    <Ionicons name="trash-outline" size={18} color={theme.color.danger} />
                    <Text style={[styles.menuText, styles.dangerText]}>Remover foto</Text>
                  </Pressable>
                ) : null}
                {user.role === 'ADMIN' && onNavigateAdmin ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Administração"
                    onPress={() => {
                      setProfileOpen(false);
                      onNavigateAdmin();
                    }}
                    style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                  >
                    <Ionicons name="settings-outline" size={18} color={theme.color.text} />
                    <Text style={styles.menuText}>Administração</Text>
                  </Pressable>
                ) : null}
                <View style={styles.menuDivider} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Sair"
                  onPress={() => {
                    setProfileOpen(false);
                    onLogout();
                  }}
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                >
                  <Ionicons name="log-out-outline" size={18} color={theme.color.text} />
                  <Text style={styles.menuText}>Sair</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </ResponsiveContainer>

      {compact ? (
        <PrimaryNavigation
          active={active}
          competitionSlug={competitionSlug}
          mobile
          resolvePrimaryScreen={resolvePrimaryScreen}
          onNavigatePrimary={onNavigatePrimary}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: theme.color.canvasDeep,
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    position: 'relative',
    zIndex: 60,
  },
  topbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.space.lg,
    minHeight: theme.size.headerDesktop,
    paddingHorizontal: theme.space.xl,
  },
  topbarCompact: {
    minHeight: theme.size.headerMobile,
    paddingHorizontal: theme.space.md,
  },
  brandLink: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: theme.space.sm,
    minHeight: theme.touchTarget,
  },
  brandLinkPressed: { opacity: 0.82 },
  brandMark: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    height: 38,
    justifyContent: 'center',
    transform: [{ rotate: '-3deg' }],
    width: 38,
  },
  brandMarkCompact: { borderRadius: theme.radius.sm, height: 34, width: 34 },
  brandCopy: { minWidth: 0 },
  brandName: {
    color: theme.color.text,
    fontSize: theme.font.size.lg,
    fontWeight: '900',
    letterSpacing: -0.35,
  },
  brandNameCompact: { fontSize: 16 },
  brandContext: {
    color: theme.color.textSubtle,
    fontSize: theme.font.size.xs,
    marginTop: 1,
    maxWidth: 190,
  },
  primaryNavigation: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  desktopPrimaryNavigation: {
    alignSelf: 'stretch',
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  mobilePrimaryNavigation: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    gap: 0,
    justifyContent: 'space-around',
    minHeight: theme.size.bottomNavigation,
    paddingBottom: theme.space.sm,
    paddingHorizontal: theme.space.xs,
    paddingTop: theme.space.sm,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  desktopNavItem: {
    alignSelf: 'stretch',
    borderBottomColor: 'transparent',
    borderBottomWidth: 2,
    flexDirection: 'row',
    gap: 7,
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
  },
  desktopNavItemActive: {
    backgroundColor: theme.color.accentMuted,
    borderBottomColor: theme.color.accent,
  },
  mobileNavItem: {
    borderRadius: theme.radius.sm,
    flex: 1,
    gap: 3,
    minHeight: 54,
    minWidth: 0,
    paddingHorizontal: 2,
  },
  mobileNavItemActive: { backgroundColor: theme.color.accentMuted },
  mobileActiveIndicator: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.pill,
    height: 3,
    position: 'absolute',
    top: -9,
    width: 32,
  },
  navItemPressed: {
    backgroundColor: theme.color.surfacePressed,
    opacity: 0.88,
  },
  navLabel: { color: theme.color.textMuted, fontWeight: '800' },
  desktopNavLabel: { fontSize: theme.font.size.sm },
  mobileNavLabel: { fontSize: theme.font.size.xs },
  navLabelActive: { color: theme.color.accent },
  accountArea: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: theme.space.xs,
    marginLeft: 'auto',
  },
  utilityButton: {
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    paddingHorizontal: theme.space.sm,
  },
  utilityButtonPressed: { backgroundColor: theme.color.surfacePressed },
  utilityText: { color: theme.color.textMuted, fontSize: theme.font.size.sm, fontWeight: '800' },
  profileAnchor: { position: 'relative', zIndex: 80 },
  profileButton: {
    alignItems: 'center',
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: theme.touchTarget,
    paddingHorizontal: 4,
    paddingRight: 9,
  },
  profileButtonOpen: {
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.borderStrong,
  },
  profileButtonPressed: { backgroundColor: theme.color.surfacePressed },
  profileText: { maxWidth: 132 },
  profileName: { color: theme.color.text, fontSize: theme.font.size.sm, fontWeight: '900' },
  profileRole: { color: theme.color.textSubtle, fontSize: 9, marginTop: 1 },
  avatar: {
    alignItems: 'center',
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.accent,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: { color: theme.color.text, fontSize: theme.font.size.sm, fontWeight: '900' },
  profileMenu: {
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    minWidth: 220,
    padding: theme.space.xs,
    position: 'absolute',
    right: 0,
    top: 48,
  },
  profileMenuCompact: { right: -4, top: 46 },
  menuItem: {
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    flexDirection: 'row',
    gap: 10,
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
  },
  menuItemPressed: { backgroundColor: theme.color.surfacePressed },
  menuText: { color: theme.color.text, fontSize: theme.font.size.sm, fontWeight: '800' },
  dangerText: { color: theme.color.danger },
  menuDivider: { backgroundColor: theme.color.borderMuted, height: 1, marginVertical: 5 },
  disabled: { opacity: 0.48 },
});

const mobilePrimaryNavigationWeb = {
  bottom: 0,
  boxShadow: theme.shadow.raised,
  left: 0,
  margin: '0 max(8px, env(safe-area-inset-left)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-right))',
  paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
  position: 'fixed',
  right: 0,
  zIndex: 70,
} as never;

const topbarSafeAreaWeb = {
  paddingTop: 'env(safe-area-inset-top)',
} as never;

const profileMenuWeb = {
  boxShadow: theme.shadow.raised,
} as never;
