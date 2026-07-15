import { forwardRef, useId } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { theme } from '../theme/tokens';

export interface ScoreInputProps
  extends Pick<TextInputProps, 'editable' | 'onBlur' | 'onFocus' | 'testID'> {
  teamName: string;
  side: 'home' | 'away';
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  showLabel?: boolean;
  compact?: boolean;
}

export const ScoreInput = forwardRef<TextInput, ScoreInputProps>(function ScoreInput(
  { teamName, side, value, onChange, error, hint, editable = true, showLabel = true, compact = false, ...inputProps },
  ref,
) {
  const hintId = useId();
  const sideLabel = side === 'home' ? 'mandante' : 'visitante';
  const describedBy = error || hint ? hintId : undefined;
  const webA11y = {
    'aria-invalid': Boolean(error),
    'aria-describedby': describedBy,
  } as unknown as TextInputProps;

  return (
    <View style={[styles.field, compact && styles.fieldCompact]}>
      {showLabel ? <Text style={styles.label}>{teamName}</Text> : null}
      <TextInput
        {...inputProps}
        {...webA11y}
        ref={ref}
        accessibilityLabel={`Placar de ${teamName}, ${sideLabel}`}
        accessibilityHint={error ?? hint ?? 'Digite um número de zero a noventa e nove'}
        editable={editable}
        inputMode="numeric"
        keyboardType="number-pad"
        maxLength={2}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, 2))}
        selectTextOnFocus
        style={[styles.input, compact && styles.inputCompact, !editable && styles.inputDisabled, error && styles.inputInvalid]}
        value={value}
      />
      {error ? (
        <Text nativeID={hintId} style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text nativeID={hintId} style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: { alignItems: 'center', gap: theme.space.xs, minWidth: 72 },
  fieldCompact: { minWidth: 38 },
  label: { color: theme.color.textMuted, fontSize: 11, fontWeight: '700', maxWidth: 110 },
  input: {
    backgroundColor: theme.color.canvas,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    color: theme.color.text,
    fontSize: 18,
    fontWeight: '900',
    height: theme.touchTarget,
    minWidth: theme.touchTarget,
    outlineColor: theme.color.focus,
    textAlign: 'center',
    width: 52,
  },
  inputDisabled: { opacity: 0.58 },
  inputCompact: { height: 34, minWidth: 34, width: 34 },
  inputInvalid: { borderColor: theme.color.danger, borderWidth: 2 },
  hint: { color: theme.color.textMuted, fontSize: 10, textAlign: 'center' },
  error: { color: theme.color.danger, fontSize: 10, fontWeight: '700', textAlign: 'center' },
});
