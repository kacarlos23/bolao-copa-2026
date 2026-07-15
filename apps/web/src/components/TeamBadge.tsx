import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { TeamDto } from '@bolao/shared';
import { flagSources } from '../flagSources';
import { theme } from '../theme/tokens';

type BadgeTeam = Pick<TeamDto, 'id' | 'name' | 'code' | 'flagUrl' | 'crestUrl'> & {
  metadata?: { iso2?: string; flagEmoji?: string } | null;
};

function initials(team?: BadgeTeam | null) {
  if (!team) return '?';
  if (team.code) return team.code.slice(0, 3).toUpperCase();
  return team.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function TeamBadge({
  team,
  size = 32,
  kind = 'auto',
}: {
  team?: BadgeTeam | null;
  size?: number;
  kind?: 'auto' | 'flag' | 'crest';
}) {
  const [failed, setFailed] = useState(false);
  const iso2 = team?.metadata?.iso2?.toLowerCase();
  const localFlag = iso2 ? flagSources[iso2] : undefined;
  const remoteSource = kind === 'crest' ? team?.crestUrl : team?.flagUrl ?? team?.crestUrl;
  const source = kind !== 'crest' && localFlag ? localFlag : remoteSource ? { uri: remoteSource } : null;

  useEffect(() => setFailed(false), [remoteSource, iso2]);

  if (!source || failed) {
    return (
      <View
        accessibilityLabel={team ? `Símbolo de ${team.name}` : 'Time a definir'}
        style={[
          styles.fallback,
          { width: size, height: size, borderRadius: Math.max(6, size / 2) },
        ]}
      >
        <Text style={[styles.fallbackText, { fontSize: Math.max(9, size * 0.28) }]}>
          {team?.metadata?.flagEmoji ?? initials(team)}
        </Text>
      </View>
    );
  }

  return (
    <Image
      accessibilityLabel={team ? `Símbolo de ${team.name}` : 'Time a definir'}
      onError={() => setFailed(true)}
      resizeMode={kind === 'crest' || Boolean(team?.crestUrl && !localFlag) ? 'contain' : 'cover'}
      source={source}
      style={{ width: size, height: size, borderRadius: kind === 'crest' ? 0 : Math.max(4, size / 5) }}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.border,
    borderWidth: 1,
    justifyContent: 'center',
  },
  fallbackText: { color: theme.color.text, fontWeight: '900' },
});
