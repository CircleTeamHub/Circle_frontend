import React, { useState, useCallback, useMemo } from 'react';
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

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrapper: {
          gap: Spacing.sm,
        },
        label: {
          color: colors.text,
          fontSize: 13,
          fontWeight: '500',
        },
        container: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderRadius: Radius.md,
          height: 52,
          paddingHorizontal: Spacing.md,
          gap: Spacing.md,
          borderWidth: 1,
          borderColor: colors.surfaceBorder,
        },
        prefix: {
          color: colors.text,
          ...Typography.body,
        },
        divider: {
          width: 1,
          height: 24,
          backgroundColor: colors.surfaceBorder,
        },
        input: {
          flex: 1,
          color: colors.text,
          ...Typography.body,
          padding: 0,
        },
      }),
    [colors],
  );

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.container}>
        {prefix ? (
          <>
            <Text style={styles.prefix}>{prefix}</Text>
            <View style={styles.divider} />
          </>
        ) : null}
        <TextInput
          style={styles.input}
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
