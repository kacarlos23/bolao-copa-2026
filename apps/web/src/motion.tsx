import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

export function SoftReveal({
  children,
  distance = 8,
  duration = 180,
  style,
}: {
  children: ReactNode;
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [duration, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

export function DrawerReveal({
  children,
  maxHeight = 3600,
  open,
  style,
}: {
  children: ReactNode;
  maxHeight?: number;
  open: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [rendered, setRendered] = useState(open);

  useEffect(() => {
    if (open) setRendered(true);

    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: open ? 210 : 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && !open) setRendered(false);
    });
  }, [open, progress]);

  if (!rendered) return null;

  return (
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      style={[
        {
          maxHeight: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, maxHeight],
          }),
          opacity: progress,
          overflow: 'hidden',
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [-6, 0],
              }),
            },
          ],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}
