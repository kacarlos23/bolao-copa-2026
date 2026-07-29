import { createElement, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { API_URL } from '../services/api-client';
import { theme } from '../theme/tokens';

function initials(value: string) {
  return (
    value
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

export function userAvatarUri(value?: string | null) {
  if (!value) return null;
  return /^https?:\/\//i.test(value)
    ? value
    : `${API_URL}${value.startsWith('/') ? '' : '/'}${value}`;
}

export function UserAvatar({
  nickname,
  avatarUrl,
  size = 44,
}: {
  nickname: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  const uri = userAvatarUri(avatarUrl);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const visibleUri = uri && failedUri !== uri ? uri : null;
  const dimensions = { width: size, height: size, borderRadius: size / 2 };
  const imageLabel = `Foto de perfil de ${nickname}`;

  return (
    <View
      accessibilityLabel={visibleUri ? imageLabel : `Avatar com iniciais de ${nickname}`}
      accessibilityRole="image"
      style={[styles.container, dimensions]}
    >
      {visibleUri ? (
        Platform.OS === 'web' ? (
          createElement('img', {
            alt: imageLabel,
            draggable: false,
            onError: () => setFailedUri(visibleUri),
            src: visibleUri,
            style: {
              display: 'block',
              height: '100%',
              objectFit: 'cover',
              width: '100%',
            },
          })
        ) : (
          <Image
            accessibilityLabel={imageLabel}
            onError={() => setFailedUri(visibleUri)}
            resizeMode="cover"
            source={{ uri: visibleUri }}
            style={styles.image}
          />
        )
      ) : (
        <Text style={[styles.initials, { fontSize: Math.max(11, size * 0.3) }]}>
          {initials(nickname)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.accent,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    height: '100%',
    width: '100%',
  },
  initials: {
    color: theme.color.text,
    fontWeight: '900',
  },
});
