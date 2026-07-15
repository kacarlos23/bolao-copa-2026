import { Platform, Pressable, type GestureResponderEvent, type PressableProps } from 'react-native';

type RouteLinkProps = Omit<PressableProps, 'accessibilityRole' | 'onPress'> & {
  href: string;
  onActivate: () => void;
};

function isModifiedWebClick(event: GestureResponderEvent) {
  if (Platform.OS !== 'web') return false;
  const nativeEvent = event.nativeEvent as typeof event.nativeEvent & {
    altKey?: boolean;
    button?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  };
  return Boolean(
    nativeEvent.altKey ||
    nativeEvent.ctrlKey ||
    nativeEvent.metaKey ||
    nativeEvent.shiftKey ||
    nativeEvent.button === 1,
  );
}

/**
 * Preserva copiar URL/abrir em nova aba e entrega cliques comuns ao roteamento
 * interno, onde o guard de drafts é executado.
 */
export function RouteLink({ href, onActivate, ...props }: RouteLinkProps) {
  return (
    <Pressable
      {...props}
      {...({ href } as never)}
      accessibilityRole="link"
      onPress={(event) => {
        if (isModifiedWebClick(event)) return;
        if (Platform.OS === 'web') event.preventDefault();
        onActivate();
      }}
    />
  );
}
