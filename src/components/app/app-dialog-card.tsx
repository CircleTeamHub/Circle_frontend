import { Animated, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { GlassSurface } from '@/components/ui/glass-surface';
import { Radius, Spacing, useTheme } from '@/theme';
import { AppDialogButton } from './app-dialog-button';
import type { DialogButtonLayout, DialogButtonSlot } from './app-dialog-buttons';
import type { QueuedDialog } from './app-dialog-store';

interface AppDialogCardProps {
  dialog: QueuedDialog;
  layout: DialogButtonLayout;
  /** 0→1 的入场进度：只淡入卡片里的内容，玻璃容器本身不能改 opacity（材质会失效）。 */
  contentOpacity: Animated.Value;
  promptValue: string;
  onPromptChange: (value: string) => void;
  onPromptSubmit: () => void;
  onButtonPress: (slot: DialogButtonSlot) => void;
}

const s = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 320,
    ...Platform.select({
      ios: null,
      default: {
        shadowColor: '#000000',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
        elevation: 16,
      },
    }),
  },
  surface: {
    padding: Spacing.lg,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 24,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  input: {
    marginTop: Spacing.md,
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  column: {
    gap: Spacing.sm,
  },
  buttonsAfterHeader: {
    marginTop: Spacing.lg,
  },
});

/** 弹窗卡片本体：玻璃面上放标题 / 正文 / 可选输入框 / 按钮区。纯展示，不管队列。 */
export function AppDialogCard({
  dialog,
  layout,
  contentOpacity,
  promptValue,
  onPromptChange,
  onPromptSubmit,
  onButtonPress,
}: AppDialogCardProps) {
  const { colors } = useTheme();
  // 菜单式调用（长按图片 / 会话行操作）标题正文都空：按钮直接顶到卡片内边距。
  const hasHeader = Boolean(dialog.title || dialog.message || dialog.prompt);
  const isColumn = layout.direction === 'column';

  return (
    <View accessibilityViewIsModal style={s.card}>
      <GlassSurface material="dialog" radius={Radius.xxl} style={s.surface}>
        <Animated.View style={{ opacity: contentOpacity }}>
          {dialog.title ? (
            <Text accessibilityRole="header" style={[s.title, { color: colors.text }]}>
              {dialog.title}
            </Text>
          ) : null}
          {dialog.message ? (
            <Text style={[s.message, { color: colors.textSecondary }]}>{dialog.message}</Text>
          ) : null}
          {dialog.prompt ? (
            <TextInput
              autoFocus
              value={promptValue}
              onChangeText={onPromptChange}
              onSubmitEditing={onPromptSubmit}
              placeholder={dialog.prompt.placeholder}
              placeholderTextColor={colors.textSecondary}
              secureTextEntry={dialog.prompt.secureTextEntry}
              keyboardType={dialog.prompt.keyboardType}
              returnKeyType="done"
              selectionColor={colors.primary}
              accessibilityLabel={dialog.title}
              style={[
                s.input,
                {
                  backgroundColor: colors.glassButton,
                  borderColor: colors.glassBorder,
                  color: colors.text,
                },
              ]}
            />
          ) : null}
          <View style={[isColumn ? s.column : s.row, hasHeader && s.buttonsAfterHeader]}>
            {layout.slots.map((slot, index) => (
              <AppDialogButton
                key={`${slot.button.text}-${index}`}
                text={slot.button.text}
                role={slot.role}
                grow={!isColumn}
                onPress={() => onButtonPress(slot)}
              />
            ))}
          </View>
        </Animated.View>
      </GlassSurface>
    </View>
  );
}
