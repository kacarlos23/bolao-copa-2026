import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from './theme/tokens';

export function Shell({ children }: { children: ReactNode }) {
  return <View style={styles.shell}>{children}</View>;
}

export function Panel({ children }: { children: ReactNode }) {
  return <View style={styles.panel}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Field({
  value,
  onChangeText,
  secureTextEntry,
  placeholder,
}: {
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
  placeholder?: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      secureTextEntry={secureTextEntry}
      placeholder={placeholder}
      placeholderTextColor={theme.color.textSubtle}
      autoCapitalize="none"
      style={styles.field}
    />
  );
}

export function Button({
  children,
  onPress,
  variant = 'primary',
  disabled,
}: {
  children: ReactNode;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          variant === 'secondary' && styles.buttonSecondaryText,
          variant === 'danger' && styles.buttonDangerText,
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

export function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'live' | 'final' | 'warn';
}) {
  return (
    <View
      style={[
        styles.pill,
        tone === 'live' && styles.pillLive,
        tone === 'final' && styles.pillFinal,
        tone === 'warn' && styles.pillWarn,
      ]}
    >
      <Text
        style={[
          styles.pillText,
          tone === 'live' && styles.pillLiveText,
          tone === 'final' && styles.pillFinalText,
          tone === 'warn' && styles.pillWarnText,
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: theme.color.canvas,
    flex: 1,
    minHeight: '100%',
    padding: theme.space.xl,
  },
  panel: {
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    padding: theme.space.lg,
  },
  title: { color: theme.color.text, fontSize: 28, fontWeight: '900' },
  label: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.sm,
    fontWeight: '800',
    marginBottom: theme.space.sm,
  },
  field: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    color: theme.color.text,
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
  },
  button: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderColor: theme.color.accent,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderColor: theme.color.border,
  },
  buttonDanger: {
    backgroundColor: theme.color.dangerMuted,
    borderColor: theme.color.danger,
  },
  buttonText: { color: theme.color.accentInk, fontWeight: '900' },
  buttonSecondaryText: { color: theme.color.text },
  buttonDangerText: { color: theme.color.danger },
  disabled: { opacity: 0.48 },
  pill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(116, 135, 155, 0.11)',
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillText: { color: theme.color.textMuted, fontSize: theme.font.size.xs, fontWeight: '900' },
  pillLive: { backgroundColor: theme.color.dangerMuted, borderColor: theme.color.danger },
  pillLiveText: { color: theme.color.danger },
  pillFinal: { backgroundColor: theme.color.successMuted, borderColor: theme.color.success },
  pillFinalText: { color: theme.color.success },
  pillWarn: { backgroundColor: theme.color.warningMuted, borderColor: theme.color.warning },
  pillWarnText: { color: theme.color.warning },
});
