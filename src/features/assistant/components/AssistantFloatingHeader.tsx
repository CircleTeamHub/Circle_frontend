import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AssistantAvatar } from '@/features/assistant/components/AssistantAvatar';
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
  const { colors, resolvedMode } = useTheme();
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
      <View style={[styles.stage, { paddingTop: insets.top + 26 }]}>
        <BlurView
          intensity={32}
          tint={resolvedMode === 'dark' ? 'dark' : 'light'}
          style={[
            styles.avatarFrame,
            {
              borderColor: colors.glassBorder,
            },
          ]}
        >
          <AssistantAvatar size={58} spinning={spinning} />
        </BlurView>
        <View
          style={[
            styles.titlePill,
            {
              backgroundColor: colors.glassButton,
              borderColor: colors.glassBorder,
            },
          ]}
        >
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
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
    paddingTop: Spacing.sm,
  },
  avatarFrame: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: 32,
    borderWidth: StyleSheet.hairlineWidth,
    height: 64,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 64,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.18)',
  },
  titlePill: {
    borderCurve: 'continuous',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: -5,
    maxWidth: 120,
    paddingHorizontal: 14,
    paddingVertical: Spacing.xs,
    zIndex: 2,
  },
  title: {
    ...Typography.body,
    fontWeight: '700',
  },
});
