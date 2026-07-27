import type { ComponentProps, ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { theme } from '../theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];
type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'secondary';
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function ResponsiveContainer({
  children,
  style,
  ...props
}: ViewProps & { children: ReactNode }) {
  return (
    <View {...props} style={[styles.container, style]}>
      {children}
    </View>
  );
}

export function Card({
  children,
  style,
  interactive = false,
  ...props
}: ViewProps & { children: ReactNode; interactive?: boolean }) {
  return (
    <View {...props} style={[styles.card, interactive && styles.cardInteractive, style]}>
      {children}
    </View>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
  level = 2,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  level?: 1 | 2 | 3;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionCopy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text role="heading" aria-level={level} style={styles.sectionTitle}>
          {title}
        </Text>
        {description ? <Text style={styles.sectionDescription}>{description}</Text> : null}
      </View>
      {action ? <View style={styles.sectionAction}>{action}</View> : null}
    </View>
  );
}

export function StatusChip({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: StatusTone;
  icon?: IconName;
}) {
  const palette = chipPalette[tone];
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor },
      ]}
      accessibilityLabel={label}
    >
      {icon ? <Ionicons name={icon} size={13} color={palette.color} /> : null}
      <Text style={[styles.chipText, { color: palette.color }]}>{label}</Text>
    </View>
  );
}

export function AppButton({
  label,
  icon,
  variant = 'primary',
  disabled,
  style,
  accessibilityLabel,
  ...props
}: Omit<PressableProps, 'children'> & {
  label: string;
  icon?: IconName;
  variant?: ButtonVariant;
  style?: ViewStyle | ViewStyle[];
}) {
  const palette = buttonPalette[variant];
  return (
    <Pressable
      {...props}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
        },
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={palette.color} /> : null}
      <Text style={[styles.buttonText, { color: palette.color }]}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton(props: Omit<ComponentProps<typeof AppButton>, 'variant'>) {
  return <AppButton {...props} variant="primary" />;
}

export function SecondaryButton(props: Omit<ComponentProps<typeof AppButton>, 'variant'>) {
  return <AppButton {...props} variant="secondary" />;
}

export function DangerButton(props: Omit<ComponentProps<typeof AppButton>, 'variant'>) {
  return <AppButton {...props} variant="danger" />;
}

const chipPalette: Record<
  StatusTone,
  { backgroundColor: string; borderColor: string; color: string }
> = {
  neutral: {
    backgroundColor: 'rgba(116, 135, 155, 0.11)',
    borderColor: theme.color.borderMuted,
    color: theme.color.textMuted,
  },
  accent: {
    backgroundColor: theme.color.accentMuted,
    borderColor: 'rgba(168, 230, 0, 0.34)',
    color: theme.color.accent,
  },
  success: {
    backgroundColor: theme.color.successMuted,
    borderColor: 'rgba(52, 209, 123, 0.34)',
    color: theme.color.success,
  },
  warning: {
    backgroundColor: theme.color.warningMuted,
    borderColor: 'rgba(231, 184, 74, 0.34)',
    color: theme.color.warning,
  },
  danger: {
    backgroundColor: theme.color.dangerMuted,
    borderColor: 'rgba(255, 136, 120, 0.34)',
    color: theme.color.danger,
  },
  info: {
    backgroundColor: theme.color.infoMuted,
    borderColor: 'rgba(114, 183, 242, 0.34)',
    color: theme.color.info,
  },
  secondary: {
    backgroundColor: theme.color.secondaryMuted,
    borderColor: 'rgba(116, 71, 232, 0.38)',
    color: '#bca7ff',
  },
};

const buttonPalette: Record<
  ButtonVariant,
  { backgroundColor: string; borderColor: string; color: string }
> = {
  primary: {
    backgroundColor: theme.color.accent,
    borderColor: theme.color.accent,
    color: theme.color.accentInk,
  },
  secondary: {
    backgroundColor: theme.color.secondary,
    borderColor: theme.color.secondary,
    color: theme.color.text,
  },
  danger: {
    backgroundColor: theme.color.dangerMuted,
    borderColor: theme.color.danger,
    color: theme.color.danger,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: theme.color.border,
    color: theme.color.text,
  },
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 'auto',
    maxWidth: theme.size.contentMax,
    width: '100%',
  },
  card: {
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    padding: theme.space.lg,
  },
  cardInteractive: { backgroundColor: theme.color.surfaceHover },
  sectionHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.lg,
    justifyContent: 'space-between',
  },
  sectionCopy: { flex: 1, minWidth: 220 },
  sectionAction: { alignItems: 'flex-end' },
  eyebrow: {
    color: theme.color.accent,
    fontSize: theme.font.size.xs,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  sectionTitle: {
    color: theme.color.text,
    fontSize: theme.font.size.xl,
    fontWeight: '900',
    letterSpacing: -0.35,
    lineHeight: 30,
    marginTop: theme.space.xs,
  },
  sectionDescription: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.md,
    lineHeight: 21,
    marginTop: theme.space.sm,
    maxWidth: 680,
  },
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 28,
    paddingHorizontal: 9,
  },
  chipText: { fontSize: theme.font.size.xs, fontWeight: '900', letterSpacing: 0.2 },
  button: {
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: theme.space.sm,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  buttonPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  buttonText: { fontSize: theme.font.size.sm, fontWeight: '900' },
  disabled: { opacity: 0.44 },
});
