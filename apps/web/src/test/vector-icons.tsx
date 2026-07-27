import type { ComponentProps } from 'react';
import { Text } from 'react-native';

type IconProps = ComponentProps<typeof Text> & {
  name?: string;
  size?: number;
  color?: string;
};

export function Ionicons({ name, accessibilityLabel, ...props }: IconProps) {
  return (
    <Text {...props} accessibilityLabel={accessibilityLabel ?? name} aria-hidden={!accessibilityLabel}>
      {name}
    </Text>
  );
}

export default Ionicons;
