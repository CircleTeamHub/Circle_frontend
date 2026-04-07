import { useState, useCallback, useMemo } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Radius, Typography } from '@/theme';

interface AuthInputProps {
  label?: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
  prefix?: string;
  keyboardType?: 'default' | 'phone-pad' | 'email-address' | 'number-pad';
  rightElement?: React.ReactNode;
}

const s = StyleSheet.create({
  wrapper: {
    gap: Spacing.sm,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    height: 52,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
    borderWidth: 1,
  },
  divider: {
    width: 1,
    height: 24,
  },
  input: {
    flex: 1,
    padding: 0,
  },
});

export const AuthInput: React.FC<AuthInputProps> = ({
  label,
  placeholder,
  value,
  onChangeText,
  secureTextEntry,
  prefix,
  keyboardType = 'default',
  rightElement,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const togglePassword = useCallback(() => setShowPassword((v) => !v), []);
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      label: {
        color: colors.text,
        fontSize: 13,
        fontWeight: '500' as const,
      },
      container: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      prefix: {
        color: colors.text,
        ...Typography.body,
      },
      divider: {
        backgroundColor: colors.surfaceBorder,
      },
      input: {
        color: colors.text,
        ...Typography.body,
      },
    }),
    [colors],
  );

  return (
    <View style={s.wrapper}>
      {label ? <Text style={d.label}>{label}</Text> : null}
      <View style={[s.container, d.container]}>
        {prefix ? (
          <>
            <Text style={d.prefix}>{prefix}</Text>
            <View style={[s.divider, d.divider]} />
          </>
        ) : null}
        <TextInput
          style={[s.input, d.input]}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary + '80'}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry && !showPassword}
          keyboardType={keyboardType}
          autoCapitalize="none"
        />
        {secureTextEntry ? (
          <Pressable onPress={togglePassword} hitSlop={8}>
            <Ionicons
              name={showPassword ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
        {rightElement}
      </View>
    </View>
  );
};
