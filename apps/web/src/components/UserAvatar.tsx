import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
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

function avatarUri(value?: string | null) {
  if (!value) return null;
  return /^https?:\/\//i.test(value)
    ? value
    : `${API_URL}${value.startsWith('/') ? '' : '/'}${value}`;
}

export function UserAvatar({
  nickname,
  avatarUrl,
  size = 36,
}: {
  nickname: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  const uri = avatarUri(avatarUrl);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [uri]);

  const dimensions = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View
      accessibilityLabel={`Avatar de ${nickname}`}
      accessibilityRole="image"
      style={[styles.avatar, dimensions]}
    >
      {uri && !imageFailed ? (
        <Image
          source={{ uri }}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
          style={dimensions}
        />
      ) : (
        <Text style={[styles.initials, { fontSize: Math.max(10, size * 0.3) }]}>
          {initials(nickname)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: theme.color.surfaceHover,
    borderColor: theme.color.accent,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: { color: theme.color.text, fontWeight: '900' },
});
