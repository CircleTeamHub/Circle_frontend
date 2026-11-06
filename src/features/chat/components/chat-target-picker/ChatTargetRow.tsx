import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Spacing, Typography, useTheme } from '@/theme';
import { ChatTargetAvatar } from './ChatTargetAvatar';
import type { ChatTarget } from './types';

interface ChatTargetRowProps {
  target: ChatTarget;
  multiSelect: boolean;
  selected: boolean;
  disabled?: boolean;
  onPress: (target: ChatTarget) => void;
}

const s = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  name: { ...Typography.body, flex: 1 },
});

export const ChatTargetRow = memo(function ChatTargetRow({
  target,
  multiSelect,
  selected,
  disabled = false,
  onPress,
}: ChatTargetRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}
      onPress={() => onPress(target)}
      disabled={disabled}
      accessibilityRole={multiSelect ? 'checkbox' : 'button'}
      accessibilityState={multiSelect ? { checked: selected } : undefined}
      accessibilityLabel={target.name}
    >
      {multiSelect ? (
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={selected ? colors.primary : colors.textSecondary}
        />
      ) : null}
      <ChatTargetAvatar target={target} size={44} />
      <View style={{ flex: 1 }}>
        <Text style={[s.name, { color: colors.text }]} numberOfLines={1}>
          {target.name}
        </Text>
      </View>
    </Pressable>
  );
});
