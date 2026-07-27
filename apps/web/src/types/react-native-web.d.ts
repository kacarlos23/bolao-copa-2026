import 'react-native';

declare module 'react-native' {
  interface ViewStyle {
    backdropFilter?: string;
    backgroundAttachment?: string;
    backgroundImage?: string;
    backgroundRepeat?: string;
    backgroundSize?: string;
    boxShadow?: string;
    overflowX?: 'auto' | 'hidden' | 'scroll' | 'visible';
    overflowY?: 'auto' | 'hidden' | 'scroll' | 'visible';
    scrollbarColor?: string;
    scrollbarWidth?: 'auto' | 'thin' | 'none';
    transitionDuration?: string;
    transitionProperty?: string;
    transitionTimingFunction?: string;
  }

  interface PressableProps {
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
  }
}
