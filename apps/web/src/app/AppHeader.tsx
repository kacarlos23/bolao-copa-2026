import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_URL, api, type User } from '../api';
import {
  activePrimaryDestination,
  pathForScreen,
  type AppScreen,
  type PrimaryDestination,
} from '../navigation/routes';
import { RouteLink } from '../navigation/RouteLink';
import { theme } from '../theme/tokens';

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

function Avatar({ user, size = 38 }: { user: User; size?: number }) {
  const uri = avatarUri(user.avatarUrl);
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <Text style={styles.avatarText}>{initials(user.nickname)}</Text>
      )}
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
  const compact = width < 768;
  const [profileOpen, setProfileOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const active = activePrimaryDestination(screen);
  const resolvePrimaryScreen =
    primaryScreenFor ?? ((destination: PrimaryDestination) => destination as AppScreen);

  const items: Array<{
    key: PrimaryDestination;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
  }> = [
    { key: 'home', label: 'Início', icon: 'home-outline' },
    { key: 'competitions', label: 'Competições', icon: 'trophy-outline' },
    { key: 'predictions', label: 'Palpites', icon: 'create-outline' },
    { key: 'ranking', label: 'Ranking', icon: 'podium-outline' },
  ];

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
      <View style={[styles.topbar, compact && styles.topbarCompact]}>
        <RouteLink
          href={pathForScreen('home')}
          accessibilityLabel="Bolão Sirel, ir para o início"
          onActivate={() => onNavigatePrimary('home')}
          style={styles.brandLink}
        >
          <View style={styles.brandMark} accessibilityElementsHidden>
            <Text style={styles.brandMarkText}>BS</Text>
          </View>
          <View>
            <Text style={styles.brandName}>Bolão Sirel</Text>
            {!compact && competitionName ? (
              <Text style={styles.brandContext} numberOfLines={1}>
                {competitionName}
              </Text>
            ) : null}
          </View>
        </RouteLink>

        <View style={styles.accountArea}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Atualizar dados"
            onPress={onRefresh}
            style={styles.utilityButton}
          >
            <Ionicons name="refresh-outline" size={18} color={theme.color.textMuted} />
            {!compact ? <Text style={styles.utilityText}>Atualizar</Text> : null}
          </Pressable>
          <View style={styles.profileAnchor}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Abrir menu de ${user.nickname}`}
              accessibilityState={{ expanded: profileOpen }}
              onPress={() => setProfileOpen((value) => !value)}
              style={styles.profileButton}
            >
              <Avatar user={user} />
              {!compact ? (
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
                size={15}
                color={theme.color.textMuted}
              />
            </Pressable>
            {profileOpen ? (
              <View
                nativeID="menu-perfil"
                role="group"
                accessibilityLabel="Ações do perfil"
                style={styles.profileMenu}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Trocar foto"
                  disabled={avatarBusy}
                  onPress={pickAvatar}
                  style={styles.menuItem}
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
                    style={styles.menuItem}
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
                    style={styles.menuItem}
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
                  style={styles.menuItem}
                >
                  <Ionicons name="log-out-outline" size={18} color={theme.color.text} />
                  <Text style={styles.menuText}>Sair</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.navContent}
        role="navigation"
        accessibilityLabel="Navegação principal"
        style={styles.navScroll}
      >
        {items.map((item) => {
          const selected = active === item.key;
          return (
            <RouteLink
              key={item.key}
              {...({ 'aria-current': selected ? 'page' : undefined } as never)}
              href={pathForScreen(resolvePrimaryScreen(item.key), { competitionSlug })}
              accessibilityLabel={item.label}
              accessibilityState={{ selected }}
              onActivate={() => onNavigatePrimary(item.key)}
              style={[styles.navItem, selected && styles.navItemActive]}
            >
              <Ionicons
                name={item.icon}
                size={18}
                color={selected ? theme.color.accent : theme.color.textMuted}
              />
              <Text style={[styles.navLabel, selected && styles.navLabelActive]}>{item.label}</Text>
            </RouteLink>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: 'rgba(0, 20, 58, 0.96)',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    position: 'relative',
    zIndex: 30,
  },
  topbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 'auto',
    maxWidth: 1280,
    minHeight: 70,
    paddingHorizontal: theme.space.xl,
    width: '100%',
  },
  topbarCompact: { minHeight: 62, paddingHorizontal: theme.space.md },
  brandLink: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: theme.touchTarget },
  brandMark: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderRadius: 11,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  brandMarkText: { color: theme.color.accentInk, fontSize: 14, fontWeight: '900' },
  brandName: { color: theme.color.text, fontSize: 18, fontWeight: '900', letterSpacing: -0.2 },
  brandContext: { color: theme.color.textMuted, fontSize: 10, marginTop: 2, maxWidth: 280 },
  accountArea: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  utilityButton: {
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: 10,
  },
  utilityText: { color: theme.color.textMuted, fontSize: 12, fontWeight: '800' },
  profileAnchor: { position: 'relative', zIndex: 40 },
  profileButton: {
    alignItems: 'center',
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: theme.touchTarget,
    paddingHorizontal: 5,
    paddingRight: 10,
  },
  profileText: { maxWidth: 150 },
  profileName: { color: theme.color.text, fontSize: 12, fontWeight: '900' },
  profileRole: { color: theme.color.textMuted, fontSize: 9, marginTop: 1 },
  avatar: {
    alignItems: 'center',
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.accent,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: { color: theme.color.text, fontSize: 12, fontWeight: '900' },
  profileMenu: {
    backgroundColor: '#05274b',
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    minWidth: 218,
    padding: 6,
    position: 'absolute',
    right: 0,
    top: 50,
  },
  menuItem: {
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    flexDirection: 'row',
    gap: 10,
    minHeight: theme.touchTarget,
    paddingHorizontal: 11,
  },
  menuText: { color: theme.color.text, fontSize: 12, fontWeight: '800' },
  dangerText: { color: theme.color.danger },
  menuDivider: { backgroundColor: theme.color.borderMuted, height: 1, marginVertical: 5 },
  navScroll: { borderTopColor: 'rgba(88, 134, 181, 0.18)', borderTopWidth: 1 },
  navContent: {
    gap: 2,
    marginHorizontal: 'auto',
    maxWidth: 1280,
    paddingHorizontal: theme.space.md,
    width: '100%',
  },
  navItem: {
    alignItems: 'center',
    borderBottomColor: 'transparent',
    borderBottomWidth: 3,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: theme.space.lg,
  },
  navItemActive: { borderBottomColor: theme.color.accent },
  navLabel: { color: theme.color.textMuted, fontSize: 12, fontWeight: '800' },
  navLabelActive: { color: theme.color.text },
});
