import type { ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

export function Shell({ children }: { children: ReactNode }) {
  return <View className="min-h-screen bg-slate-950 px-4 py-5 md:px-8">{children}</View>;
}

export function Panel({ children }: { children: ReactNode }) {
  return <View className="rounded-lg border border-slate-800 bg-panel p-4 shadow-sm">{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text className="text-2xl font-bold text-white md:text-3xl">{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text className="mb-2 text-sm font-semibold text-slate-300">{children}</Text>;
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
      className="rounded-md border border-slate-700 bg-slate-900 px-3 py-3 text-base text-white outline-none"
      value={value}
      onChangeText={onChangeText}
      secureTextEntry={secureTextEntry}
      placeholder={placeholder}
      placeholderTextColor="#64748b"
      autoCapitalize="none"
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
  const color =
    variant === 'danger'
      ? 'bg-coral'
      : variant === 'secondary'
        ? 'bg-slate-800'
        : 'bg-grass';

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      className={`items-center rounded-md px-4 py-3 ${disabled ? 'bg-slate-700 opacity-60' : color}`}
    >
      <Text className="font-semibold text-white">{children}</Text>
    </Pressable>
  );
}

export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'live' | 'final' | 'warn' }) {
  const color =
    tone === 'live'
      ? 'border-coral bg-coral/20 text-red-100'
      : tone === 'final'
        ? 'border-grass bg-grass/20 text-green-100'
        : tone === 'warn'
          ? 'border-gold bg-gold/20 text-yellow-100'
          : 'border-slate-700 bg-slate-800 text-slate-200';

  return (
    <View className={`rounded-full border px-3 py-1 ${color}`}>
      <Text className="text-xs font-semibold text-white">{children}</Text>
    </View>
  );
}
