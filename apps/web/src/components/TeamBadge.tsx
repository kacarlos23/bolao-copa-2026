import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { TeamDto } from '@bolao/shared';
import { localClubCrestSource } from '../clubCrestSources';
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
  const localCrest = localClubCrestSource(team?.name);
  const remoteFlag = team?.flagUrl ? { uri: team.flagUrl } : undefined;
  const remoteCrest = team?.crestUrl ? { uri: team.crestUrl } : undefined;
  let source = null as typeof localFlag | { uri: string } | null;
  let rendersCrest = false;

  if (kind === 'crest') {
    source = localCrest ?? remoteCrest ?? null;
    rendersCrest = Boolean(source);
  } else if (localFlag) {
    source = localFlag;
  } else if (kind === 'auto' && localCrest) {
    source = localCrest;
    rendersCrest = true;
  } else if (remoteFlag) {
    source = remoteFlag;
  } else if (remoteCrest) {
    source = remoteCrest;
    rendersCrest = true;
  }

  useEffect(
    () => setFailed(false),
    [iso2, kind, team?.crestUrl, team?.flagUrl, team?.id, team?.name],
  );

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

  const image = (
    <Image
      accessibilityLabel={
        rendersCrest ? undefined : team ? `Bandeira de ${team.name}` : 'Time a definir'
      }
      onError={() => setFailed(true)}
      resizeMode={rendersCrest ? 'contain' : 'cover'}
      source={source}
      style={
        rendersCrest
          ? { width: Math.max(12, size - 6), height: Math.max(12, size - 6) }
          : { width: size, height: size, borderRadius: Math.max(4, size / 5) }
      }
    />
  );

  if (rendersCrest) {
    return (
      <View
        accessibilityLabel={team ? `Escudo de ${team.name}` : 'Time a definir'}
        style={[
          styles.crestFrame,
          { width: size, height: size, borderRadius: Math.max(7, size / 2) },
        ]}
      >
        {image}
      </View>
    );
  }

  return image;
}

const styles = StyleSheet.create({
  crestFrame: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: theme.color.border,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fallback: {
    alignItems: 'center',
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.border,
    borderWidth: 1,
    justifyContent: 'center',
  },
  fallbackText: { color: theme.color.text, fontWeight: '900' },
});
