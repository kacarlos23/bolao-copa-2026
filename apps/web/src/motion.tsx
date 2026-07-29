import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ModalProps,
  type PressableProps,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

type Gsap = (typeof import('gsap'))['gsap'];
type MotionKind = 'button' | 'row' | 'icon' | 'subtle';
type Focusable = { focus?: () => void };

const motionTiming = {
  press: 90,
  micro: 160,
  selection: 240,
  modal: 320,
  route: 420,
  stagger: 45,
} as const;

let gsapPromise: Promise<Gsap | null> | null = null;
let loadedGsap: Gsap | null = null;

export function loadGsap() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return Promise.resolve<Gsap | null>(null);
  }
  if (!gsapPromise) {
    gsapPromise = import('gsap')
      .then((module) => {
        loadedGsap = module.gsap;
        return loadedGsap;
      })
      .catch(() => null);
  }
  return gsapPromise;
}

function webNode(value: unknown) {
  if (typeof HTMLElement === 'undefined') return null;
  return value instanceof HTMLElement ? value : null;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

interface ScrollMetrics {
  contentHeight: number;
  viewportHeight: number;
  y: number;
}

interface AppMotionContextValue {
  ready: boolean;
  reducedMotion: boolean;
  updateScroll: (metrics: ScrollMetrics) => void;
}

const AppMotionContext = createContext<AppMotionContextValue>({
  ready: false,
  reducedMotion: false,
  updateScroll: () => undefined,
});

export function MotionProvider({ children }: { children: ReactNode }) {
  const reducedMotion = usePrefersReducedMotion();
  const [ready, setReady] = useState(Boolean(loadedGsap));
  const pendingMetrics = useRef<ScrollMetrics | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion) return undefined;
    let active = true;
    const preload = () => {
      void loadGsap().then((gsap) => {
        if (active && gsap) setReady(true);
      });
    };
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: 700 });
      return () => {
        active = false;
        window.cancelIdleCallback(idleId);
      };
    }
    const timeout = setTimeout(preload, 0);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion || Platform.OS !== 'web' || typeof document === 'undefined') {
      return undefined;
    }
    const selector =
      'button, a, [role="button"], [role="link"], [role="tab"], [role="radio"], [role="switch"]';
    const targetFor = (event: Event) => {
      const origin = event.target;
      if (!(origin instanceof Element)) return null;
      const target = origin.closest(selector);
      if (
        !(target instanceof HTMLElement) ||
        target.hasAttribute('data-motion-interactive') ||
        target.getAttribute('aria-disabled') === 'true'
      ) {
        return null;
      }
      return target;
    };
    const press = (event: Event) => {
      const target = targetFor(event);
      if (!target || !loadedGsap) return;
      loadedGsap.to(target, {
        duration: motionTiming.press / 1000,
        ease: 'power2.out',
        overwrite: 'auto',
        scale: target.clientWidth > 180 ? 0.985 : 0.97,
        y: 1,
      });
    };
    const release = (event: Event) => {
      const target = targetFor(event);
      if (!target || !loadedGsap) return;
      loadedGsap.to(target, {
        clearProps: 'transform',
        duration: motionTiming.selection / 1000,
        ease: 'back.out(1.35)',
        overwrite: 'auto',
        scale: 1,
        y: 0,
      });
    };
    const hover = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const target = targetFor(event);
      if (!target || !loadedGsap || target.contains(event.relatedTarget as Node | null)) return;
      loadedGsap.to(target, {
        duration: motionTiming.micro / 1000,
        ease: 'power3.out',
        overwrite: 'auto',
        y: -2,
      });
    };
    const unhover = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const target = targetFor(event);
      if (!target || !loadedGsap || target.contains(event.relatedTarget as Node | null)) return;
      loadedGsap.to(target, {
        clearProps: 'transform',
        duration: motionTiming.micro / 1000,
        ease: 'power3.out',
        overwrite: 'auto',
        scale: 1,
        y: 0,
      });
    };
    document.addEventListener('pointerdown', press);
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
    document.addEventListener('pointerover', hover);
    document.addEventListener('pointerout', unhover);
    return () => {
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('pointerup', release);
      document.removeEventListener('pointercancel', release);
      document.removeEventListener('pointerover', hover);
      document.removeEventListener('pointerout', unhover);
    };
  }, [reducedMotion, ready]);

  const updateScroll = useCallback(
    (metrics: ScrollMetrics) => {
      if (
        reducedMotion ||
        Platform.OS !== 'web' ||
        typeof document === 'undefined' ||
        typeof requestAnimationFrame === 'undefined'
      ) {
        return;
      }
      pendingMetrics.current = metrics;
      if (frame.current != null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const current = pendingMetrics.current;
        const gsap = loadedGsap;
        if (!current || !gsap) return;
        const maxY = Math.max(1, current.contentHeight - current.viewportHeight);
        const progress = Math.min(1, Math.max(0, current.y / maxY));
        const depth = Math.min(14, Math.max(0, current.y * 0.035));
        const progressBar = document.querySelector('[data-motion-scroll-progress]');
        const ambient = document.querySelector('[data-motion-depth]');
        const header = document.querySelector('[data-motion-header]');
        if (progressBar) {
          gsap.set(progressBar, { scaleX: progress, transformOrigin: 'left center' });
        }
        if (ambient) {
          gsap.to(ambient, {
            duration: motionTiming.micro / 1000,
            ease: 'power2.out',
            overwrite: 'auto',
            y: depth,
          });
        }
        if (header) {
          gsap.to(header, {
            boxShadow: current.y > 16 ? '0 16px 42px rgba(0, 0, 0, 0.3)' : '0 0 0 rgba(0, 0, 0, 0)',
            duration: motionTiming.micro / 1000,
            ease: 'power2.out',
            overwrite: 'auto',
          });
        }
      });
    },
    [reducedMotion],
  );

  useEffect(
    () => () => {
      if (frame.current != null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(frame.current);
      }
    },
    [],
  );

  const value = useMemo(
    () => ({ ready, reducedMotion, updateScroll }),
    [ready, reducedMotion, updateScroll],
  );

  return <AppMotionContext.Provider value={value}>{children}</AppMotionContext.Provider>;
}

export function useAppMotion() {
  return useContext(AppMotionContext);
}

export function motionFeedback(target: unknown, effect: 'blur' | 'change' | 'focus' | 'refresh') {
  if (Platform.OS !== 'web') return;
  const node = webNode(target);
  if (!node) return;
  void loadGsap().then((gsap) => {
    if (!gsap) return;
    if (effect === 'focus') {
      gsap.to(node, {
        boxShadow: '0 0 0 3px rgba(168, 230, 0, 0.16), 0 10px 26px rgba(0, 0, 0, 0.22)',
        duration: motionTiming.micro / 1000,
        ease: 'power3.out',
        overwrite: 'auto',
      });
      return;
    }
    if (effect === 'blur') {
      gsap.to(node, {
        boxShadow: '0 0 0 rgba(0, 0, 0, 0)',
        clearProps: 'transform',
        duration: motionTiming.micro / 1000,
        ease: 'power2.out',
        overwrite: 'auto',
      });
      return;
    }
    if (effect === 'refresh') {
      gsap.fromTo(
        node,
        { rotation: 0 },
        {
          clearProps: 'transform',
          duration: 0.48,
          ease: 'power3.out',
          overwrite: 'auto',
          rotation: 300,
        },
      );
      return;
    }
    gsap.fromTo(
      node,
      { scale: 1.09, y: -1 },
      {
        clearProps: 'transform',
        duration: motionTiming.selection / 1000,
        ease: 'back.out(1.35)',
        overwrite: 'auto',
        scale: 1,
        y: 0,
      },
    );
  });
}

export interface MotionPressableProps extends PressableProps {
  motionKind?: MotionKind;
  motionSelected?: boolean;
}

export const MotionPressable = forwardRef<View, MotionPressableProps>(function MotionPressable(
  {
    motionKind = 'button',
    motionSelected = false,
    onHoverIn,
    onHoverOut,
    onPressIn,
    onPressOut,
    style,
    ...props
  },
  forwardedRef,
) {
  const { reducedMotion } = useAppMotion();
  const localRef = useRef<View | null>(null);
  const hovered = useRef(false);
  const nativeScale = useRef(new Animated.Value(1)).current;
  const scale = motionKind === 'row' || motionKind === 'subtle' ? 0.985 : 0.97;

  const setNode = useCallback(
    (node: View | null) => {
      localRef.current = node;
      assignRef(forwardedRef, node);
    },
    [forwardedRef],
  );

  function animateWeb(vars: Record<string, unknown>) {
    const node = webNode(localRef.current);
    if (!node || !loadedGsap || reducedMotion) return;
    loadedGsap.to(node, { overwrite: 'auto', ...vars });
  }

  function animateNative(nextScale: number, release = false) {
    if (Platform.OS === 'web' || reducedMotion) return;
    if (release) {
      Animated.spring(nativeScale, {
        friction: 5,
        tension: 180,
        toValue: nextScale,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(nativeScale, {
        duration: motionTiming.press,
        easing: Easing.out(Easing.cubic),
        toValue: nextScale,
        useNativeDriver: true,
      }).start();
    }
  }

  useEffect(() => {
    if (!motionSelected || reducedMotion || Platform.OS !== 'web') return undefined;
    const node = webNode(localRef.current);
    if (!node) return undefined;
    let context: ReturnType<Gsap['context']> | undefined;
    let cancelled = false;
    void loadGsap().then((gsap) => {
      if (!gsap || cancelled) return;
      context = gsap.context(() => {
        gsap.fromTo(
          node,
          { scale: 0.94 },
          {
            clearProps: 'transform',
            duration: motionTiming.selection / 1000,
            ease: 'back.out(1.35)',
            scale: 1,
          },
        );
      }, node);
    });
    return () => {
      cancelled = true;
      context?.revert();
    };
  }, [motionSelected, reducedMotion]);

  const animatedStyle =
    Platform.OS === 'web'
      ? undefined
      : ({ transform: [{ scale: nativeScale }] } as unknown as ViewStyle);

  return (
    <Pressable
      {...props}
      {...({ dataSet: { motionInteractive: motionKind } } as object)}
      ref={setNode}
      onHoverIn={(event) => {
        hovered.current = true;
        onHoverIn?.(event);
        if (motionKind !== 'subtle') {
          animateWeb({
            duration: motionTiming.micro / 1000,
            ease: 'power3.out',
            y: -2,
          });
        }
      }}
      onHoverOut={(event) => {
        hovered.current = false;
        onHoverOut?.(event);
        animateWeb({
          duration: motionTiming.micro / 1000,
          ease: 'power3.out',
          scale: 1,
          y: 0,
        });
      }}
      onPressIn={(event) => {
        onPressIn?.(event);
        animateNative(scale);
        animateWeb({
          duration: motionTiming.press / 1000,
          ease: 'power2.out',
          scale,
          y: 1,
        });
      }}
      onPressOut={(event) => {
        onPressOut?.(event);
        animateNative(1, true);
        animateWeb({
          duration: motionTiming.selection / 1000,
          ease: 'back.out(1.35)',
          scale: 1,
          y: hovered.current && motionKind !== 'subtle' ? -2 : 0,
        });
      }}
      style={(state) => [typeof style === 'function' ? style(state) : style, animatedStyle]}
    />
  );
});

interface RevealProps extends Omit<ViewProps, 'children' | 'style'> {
  children: ReactNode;
  distance?: number;
  duration?: number;
  stagger?: number;
  style?: StyleProp<ViewStyle>;
}

function NativeReveal({
  children,
  distance = 16,
  duration = motionTiming.route,
  reducedMotion,
  style,
  ...viewProps
}: RevealProps & { reducedMotion: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(reducedMotion ? 1 : 0);
    const animation = Animated.timing(progress, {
      duration: reducedMotion ? 0 : duration,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [duration, progress, reducedMotion]);

  return (
    <Animated.View
      {...viewProps}
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

export function PageTransition({
  children,
  distance = 16,
  duration = motionTiming.route,
  stagger = motionTiming.stagger,
  style,
  ...viewProps
}: RevealProps) {
  const { reducedMotion } = useAppMotion();
  const ref = useRef<View | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || reducedMotion) return undefined;
    const node = webNode(ref.current);
    if (!node) return undefined;
    let context: ReturnType<Gsap['context']> | undefined;
    let cancelled = false;
    void loadGsap().then((gsap) => {
      if (!gsap || cancelled) return;
      const marked = Array.from(node.querySelectorAll('[data-motion-item]')).slice(0, 18);
      const targets = marked.length ? marked : [node];
      context = gsap.context(() => {
        gsap.fromTo(
          targets,
          { opacity: 0, y: distance },
          {
            clearProps: 'opacity,transform',
            duration: duration / 1000,
            ease: 'power3.out',
            opacity: 1,
            stagger: stagger / 1000,
            y: 0,
          },
        );
      }, node);
    });
    return () => {
      cancelled = true;
      context?.revert();
    };
  }, [distance, duration, reducedMotion, stagger]);

  if (Platform.OS !== 'web') {
    return (
      <NativeReveal
        distance={distance}
        duration={duration}
        reducedMotion={reducedMotion}
        stagger={stagger}
        style={style}
        {...viewProps}
      >
        {children}
      </NativeReveal>
    );
  }

  return (
    <View {...viewProps} ref={ref} style={style}>
      {children}
    </View>
  );
}

export function SoftReveal({
  children,
  distance = 8,
  duration = 180,
  style,
}: Omit<RevealProps, 'stagger'>) {
  return (
    <PageTransition distance={distance} duration={duration} stagger={0} style={style}>
      {children}
    </PageTransition>
  );
}

export function ScrollReveal({
  children,
  distance = 24,
  duration = motionTiming.route,
  once = true,
  stagger = motionTiming.stagger,
  style,
  ...viewProps
}: RevealProps & { once?: boolean }) {
  const { reducedMotion } = useAppMotion();
  const ref = useRef<View | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || reducedMotion) return undefined;
    const node = webNode(ref.current);
    if (!node) return undefined;
    let context: ReturnType<Gsap['context']> | undefined;
    let observer: IntersectionObserver | undefined;
    let cancelled = false;

    const reveal = () => {
      void loadGsap().then((gsap) => {
        if (!gsap || cancelled) return;
        const marked = Array.from(node.querySelectorAll('[data-motion-item]')).slice(0, 12);
        const targets = marked.length ? marked : [node];
        context?.revert();
        context = gsap.context(() => {
          gsap.fromTo(
            targets,
            { opacity: 0, y: distance },
            {
              clearProps: 'opacity,transform',
              duration: duration / 1000,
              ease: 'power3.out',
              opacity: 1,
              stagger: stagger / 1000,
              y: 0,
            },
          );
        }, node);
      });
    };

    if (typeof IntersectionObserver === 'undefined') {
      reveal();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          reveal();
          if (once) observer?.disconnect();
        },
        { threshold: 0.18 },
      );
      observer.observe(node);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      context?.revert();
    };
  }, [distance, duration, once, reducedMotion, stagger]);

  return (
    <View {...viewProps} ref={ref} style={style}>
      {children}
    </View>
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
  const { reducedMotion } = useAppMotion();
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const ref = useRef<View | null>(null);
  const [rendered, setRendered] = useState(open);

  useEffect(() => {
    if (open) setRendered(true);
  }, [open]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !rendered) return undefined;
    const node = webNode(ref.current);
    if (!node) return undefined;
    if (reducedMotion) {
      if (!open) setRendered(false);
      return undefined;
    }
    let context: ReturnType<Gsap['context']> | undefined;
    let cancelled = false;
    void loadGsap().then((gsap) => {
      if (!gsap || cancelled) {
        if (!open && !cancelled) setRendered(false);
        return;
      }
      context = gsap.context(() => {
        if (open) {
          gsap.fromTo(
            node,
            { height: 0, opacity: 0, y: -6 },
            {
              clearProps: 'height,opacity,transform',
              duration: 0.24,
              ease: 'power3.out',
              height: 'auto',
              opacity: 1,
              y: 0,
            },
          );
        } else {
          gsap.to(node, {
            duration: 0.16,
            ease: 'power2.inOut',
            height: 0,
            opacity: 0,
            onComplete: () => {
              if (!cancelled) setRendered(false);
            },
            y: -6,
          });
        }
      }, node);
    });
    return () => {
      cancelled = true;
      context?.revert();
    };
  }, [open, reducedMotion, rendered]);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    if (open) setRendered(true);
    const animation = Animated.timing(progress, {
      duration: reducedMotion ? 0 : open ? 210 : 160,
      easing: Easing.out(Easing.cubic),
      toValue: open ? 1 : 0,
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (finished && !open) setRendered(false);
    });
    return () => animation.stop();
  }, [open, progress, reducedMotion]);

  if (!rendered) return null;

  if (Platform.OS === 'web') {
    return (
      <View
        ref={ref}
        pointerEvents={open ? 'auto' : 'none'}
        style={[styles.drawer, { maxHeight }, style]}
      >
        {children}
      </View>
    );
  }

  return (
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      style={[
        styles.drawer,
        {
          maxHeight: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, maxHeight],
          }),
          opacity: progress,
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

export interface MotionModalProps extends Omit<
  ModalProps,
  'animationType' | 'children' | 'onRequestClose' | 'visible'
> {
  accessibilityLabel?: string;
  backdropStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
  describedBy?: string;
  initialFocusRef?: React.RefObject<Focusable | null>;
  labelledBy?: string;
  onRequestClose: () => void;
  panelStyle?: StyleProp<ViewStyle>;
  visible: boolean;
}

export function MotionModal({
  accessibilityLabel,
  backdropStyle,
  children,
  describedBy,
  initialFocusRef,
  labelledBy,
  onRequestClose,
  panelStyle,
  visible,
  ...modalProps
}: MotionModalProps) {
  const { reducedMotion } = useAppMotion();
  const [rendered, setRendered] = useState(visible);
  const backdropRef = useRef<View | null>(null);
  const panelRef = useRef<View | null>(null);
  const originRef = useRef<Focusable | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      originRef.current = document.activeElement as Focusable | null;
    }
    setRendered(true);
  }, [visible]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !rendered) return undefined;
    const backdrop = webNode(backdropRef.current);
    const panel = webNode(panelRef.current);
    if (!backdrop || !panel) return undefined;
    let context: ReturnType<Gsap['context']> | undefined;
    let cancelled = false;
    let fallback: ReturnType<typeof setTimeout> | undefined;

    const finishExit = () => {
      if (cancelled) return;
      setRendered(false);
      requestAnimationFrame(() => originRef.current?.focus?.());
    };

    if (reducedMotion) {
      if (!visible) finishExit();
      else requestAnimationFrame(() => initialFocusRef?.current?.focus?.());
      return undefined;
    }

    void loadGsap().then((gsap) => {
      if (!gsap || cancelled) {
        if (!visible) finishExit();
        return;
      }
      context = gsap.context(() => {
        const timeline = gsap.timeline();
        if (visible) {
          timeline
            .fromTo(backdrop, { opacity: 0 }, { duration: 0.18, ease: 'power2.out', opacity: 1 })
            .fromTo(
              panel,
              { opacity: 0, scale: 0.96, y: 18 },
              {
                clearProps: 'opacity,transform',
                duration: motionTiming.modal / 1000,
                ease: 'back.out(1.35)',
                opacity: 1,
                scale: 1,
                y: 0,
              },
              0.02,
            )
            .call(() => initialFocusRef?.current?.focus?.());
        } else {
          fallback = setTimeout(finishExit, 240);
          timeline
            .to(panel, {
              duration: 0.14,
              ease: 'power2.in',
              opacity: 0,
              scale: 0.98,
              y: 10,
            })
            .to(
              backdrop,
              {
                duration: 0.16,
                ease: 'power2.inOut',
                onComplete: finishExit,
                opacity: 0,
              },
              0,
            );
        }
      }, backdrop);
    });

    return () => {
      cancelled = true;
      if (fallback) clearTimeout(fallback);
      context?.revert();
    };
  }, [initialFocusRef, reducedMotion, rendered, visible]);

  if (Platform.OS !== 'web') {
    return (
      <Modal
        {...modalProps}
        transparent
        animationType={reducedMotion ? 'none' : 'fade'}
        visible={visible}
        onRequestClose={onRequestClose}
      >
        <View
          role="dialog"
          aria-modal
          accessibilityLabel={accessibilityLabel}
          accessibilityViewIsModal
          style={[styles.modalBackdrop, backdropStyle]}
        >
          <View style={panelStyle}>{children}</View>
        </View>
      </Modal>
    );
  }

  if (!rendered) return null;

  return (
    <Modal {...modalProps} transparent animationType="none" visible onRequestClose={onRequestClose}>
      <View
        {...({
          'aria-describedby': describedBy,
          'aria-labelledby': labelledBy,
        } as object)}
        ref={backdropRef}
        role="dialog"
        aria-modal
        accessibilityLabel={accessibilityLabel}
        accessibilityViewIsModal
        style={[styles.modalBackdrop, backdropStyle]}
      >
        <View ref={panelRef} style={panelStyle}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

export interface MotionToastProps extends ViewProps {
  durationMs?: number;
  onExited: () => void;
  visible: boolean;
}

export function MotionToast({
  children,
  durationMs = 5000,
  onExited,
  style,
  visible,
  ...props
}: MotionToastProps) {
  const { reducedMotion } = useAppMotion();
  const [rendered, setRendered] = useState(visible);
  const rootRef = useRef<View | null>(null);
  const progressRef = useRef<View | null>(null);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  useEffect(() => {
    if (visible) setRendered(true);
  }, [visible]);

  useEffect(() => {
    if (Platform.OS === 'web' || visible || !rendered) return;
    setRendered(false);
    onExitedRef.current();
  }, [rendered, visible]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !rendered) return undefined;
    const root = webNode(rootRef.current);
    const progress = webNode(progressRef.current);
    if (!root) return undefined;
    let context: ReturnType<Gsap['context']> | undefined;
    let cancelled = false;

    const exit = () => {
      if (cancelled) return;
      setRendered(false);
      onExitedRef.current();
    };

    if (reducedMotion) {
      if (!visible) exit();
      return undefined;
    }

    void loadGsap().then((gsap) => {
      if (!gsap || cancelled) {
        if (!visible) exit();
        return;
      }
      context = gsap.context(() => {
        if (visible) {
          gsap.fromTo(
            root,
            { opacity: 0, scale: 0.98, y: 18 },
            {
              clearProps: 'opacity,transform',
              duration: motionTiming.selection / 1000,
              ease: 'back.out(1.35)',
              opacity: 1,
              scale: 1,
              y: 0,
            },
          );
          if (progress) {
            gsap.fromTo(
              progress,
              { scaleX: 1 },
              {
                duration: durationMs / 1000,
                ease: 'none',
                scaleX: 0,
                transformOrigin: 'left center',
              },
            );
          }
        } else {
          gsap.to(root, {
            duration: 0.16,
            ease: 'power2.in',
            onComplete: exit,
            opacity: 0,
            scale: 0.98,
            y: 12,
          });
        }
      }, root);
    });

    return () => {
      cancelled = true;
      context?.revert();
    };
  }, [durationMs, reducedMotion, rendered, visible]);

  if (!rendered) return null;

  return (
    <View {...props} ref={rootRef} style={[styles.toastMotionRoot, style]}>
      {children}
      <View ref={progressRef} style={styles.toastProgress} />
    </View>
  );
}

const particleVectors = [
  [-62, -54, -46],
  [-38, -72, -22],
  [-8, -66, 28],
  [28, -62, 48],
  [58, -38, 74],
  [68, 2, 100],
  [44, 38, 122],
  [12, 58, 150],
  [-24, 48, -140],
  [-54, 30, -112],
  [-68, -4, -82],
  [4, -86, 12],
] as const;

const particleColors = ['#a8e600', '#f4d65c', '#7447e8', '#34d17b'];

export function CelebrationBurst({ intensity = 'compact' }: { intensity?: 'compact' | 'full' }) {
  const { reducedMotion } = useAppMotion();
  const ref = useRef<View | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || reducedMotion) return undefined;
    const node = webNode(ref.current);
    if (!node) return undefined;
    let context: ReturnType<Gsap['context']> | undefined;
    let cancelled = false;
    void loadGsap().then((gsap) => {
      if (!gsap || cancelled) return;
      const particles = node.querySelectorAll('[data-motion-particle]');
      const multiplier = intensity === 'full' ? 1.3 : 1;
      context = gsap.context(() => {
        gsap.fromTo(
          particles,
          { opacity: 1, scale: 0.4, x: 0, y: 0 },
          {
            duration: 0.72,
            ease: 'power3.out',
            opacity: 0,
            rotation: (index) => particleVectors[index]?.[2] ?? 0,
            scale: 1,
            stagger: 0.018,
            x: (index) => (particleVectors[index]?.[0] ?? 0) * multiplier,
            y: (index) => (particleVectors[index]?.[1] ?? 0) * multiplier,
          },
        );
      }, node);
    });
    return () => {
      cancelled = true;
      context?.revert();
    };
  }, [intensity, reducedMotion]);

  if (Platform.OS !== 'web' || reducedMotion) return null;

  return (
    <View ref={ref} pointerEvents="none" style={styles.celebration}>
      {particleVectors.map((_, index) => (
        <View
          key={index}
          {...({ 'data-motion-particle': true } as object)}
          style={[
            styles.particle,
            {
              backgroundColor: particleColors[index % particleColors.length],
              borderRadius: index % 2 ? 2 : 999,
              height: index % 2 ? 9 : 6,
              width: index % 2 ? 3 : 6,
            },
          ]}
        />
      ))}
    </View>
  );
}

export function MotionShimmer({ children, style, ...props }: ViewProps) {
  const { reducedMotion } = useAppMotion();
  const rootRef = useRef<View | null>(null);
  const shimmerRef = useRef<View | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || reducedMotion) return undefined;
    const root = webNode(rootRef.current);
    const shimmer = webNode(shimmerRef.current);
    if (!root || !shimmer) return undefined;
    let context: ReturnType<Gsap['context']> | undefined;
    let cancelled = false;
    let animation: ReturnType<Gsap['to']> | undefined;
    const updateVisibility = () => {
      if (!animation || typeof document === 'undefined') return;
      if (document.hidden) animation.pause();
      else animation.resume();
    };
    void loadGsap().then((gsap) => {
      if (!gsap || cancelled) return;
      context = gsap.context(() => {
        animation = gsap.fromTo(
          shimmer,
          { xPercent: -130 },
          { duration: 1.2, ease: 'none', repeat: -1, xPercent: 130 },
        );
      }, root);
      document.addEventListener('visibilitychange', updateVisibility);
    });
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', updateVisibility);
      context?.revert();
    };
  }, [reducedMotion]);

  return (
    <View {...props} ref={rootRef} style={[styles.shimmerRoot, style]}>
      {children}
      {!reducedMotion && Platform.OS === 'web' ? (
        <View ref={shimmerRef} pointerEvents="none" style={styles.shimmerSweep} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  celebration: {
    alignItems: 'center',
    height: 1,
    justifyContent: 'center',
    left: '50%',
    overflow: 'visible',
    position: 'absolute',
    top: '50%',
    width: 1,
    zIndex: 20,
  },
  drawer: {
    overflow: 'hidden',
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(3, 12, 23, 0.84)',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  particle: {
    left: -3,
    position: 'absolute',
    top: -3,
  },
  shimmerRoot: {
    overflow: 'hidden',
    position: 'relative',
  },
  shimmerSweep: {
    ...StyleSheet.absoluteFillObject,
    backgroundImage:
      'linear-gradient(105deg, transparent 22%, rgba(255,255,255,0.08) 46%, rgba(168,230,0,0.10) 52%, transparent 76%)',
  },
  toastMotionRoot: {
    overflow: 'hidden',
  },
  toastProgress: {
    backgroundColor: '#a8e600',
    bottom: 0,
    height: 2,
    left: 0,
    position: 'absolute',
    right: 0,
  },
});
