import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AssistantSprite } from '@/features/assistant/components/AssistantSprite';
import { Spacing, Typography, useTheme } from '@/theme';

type AssistantFloatingHeaderProps = {
  title: string;
  spinning?: boolean;
  onBack?: () => void;
};

/**
 * Assistant conversations use a character-led header instead of the normal
 * compact chat title bar. Keeping the avatar outside the message list makes
 * it feel like the assistant is present while the conversation scrolls.
 */
export function AssistantFloatingHeader({
  title,
  spinning = false,
  onBack,
}: AssistantFloatingHeaderProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      testID="assistant-floating-header"
      pointerEvents="box-none"
      style={styles.container}
    >
      {onBack ? (
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          hitSlop={10}
          onPress={onBack}
          style={[
            styles.backButton,
            {
              backgroundColor: colors.glassButton,
              borderColor: colors.glassBorder,
              top: insets.top + Spacing.sm,
            },
          ]}
        >
          <Ionicons name="chevron-back" size={21} color={colors.text} />
        </Pressable>
      ) : null}
      <View style={[styles.stage, { paddingTop: insets.top + Spacing.sm }]}>
        <AssistantSprite reacting={spinning} />
        <View
          style={[
            styles.titlePill,
            {
              backgroundColor: colors.glassButton,
              borderColor: colors.glassBorder,
            },
          ]}
        >
          <Text
            numberOfLines={1}
            style={[styles.title, { color: colors.text }]}
          >
            {title}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 20,
  },
  backButton: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: 25,
    borderWidth: StyleSheet.hairlineWidth,
    height: 42,
    left: Spacing.sm,
    justifyContent: 'center',
    position: 'absolute',
    top: Spacing.md,
    width: 42,
    zIndex: 2,
  },
  stage: {
    alignItems: 'center',
    gap: Spacing.xs,
    justifyContent: 'flex-start',
  },
  titlePill: {
    borderCurve: 'continuous',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 160,
    paddingHorizontal: 12,
    paddingVertical: Spacing.xs,
  },
  title: {
    ...Typography.caption,
    fontWeight: '600',
  },
});
