import { ScrollView, View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useTheme, Spacing, Typography } from '@/theme';
import { EMOJI_GROUPS } from '@/constants/emojis';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

const emojiFontFamily = Platform.select({
  ios: 'Apple Color Emoji',
  android: 'Noto Color Emoji',
  default: undefined,
});

const s = StyleSheet.create({
  container: {
    maxHeight: 240,
  },
  content: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  groupLabel: {
    ...Typography.small,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '12.5%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 26,
    fontFamily: emojiFontFamily,
  },
});

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const { colors } = useTheme();
  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {EMOJI_GROUPS.map((group) => (
          <View key={group.label}>
            <Text style={[s.groupLabel, { color: colors.textSecondary }]}>
              {group.label}
            </Text>
            <View style={s.grid}>
              {group.emojis.map((emoji) => (
                <Pressable
                  key={emoji}
                  style={s.cell}
                  onPress={() => onSelect(emoji)}
                  accessibilityRole="button"
                  accessibilityLabel={emoji}
                >
                  <Text style={s.emoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
