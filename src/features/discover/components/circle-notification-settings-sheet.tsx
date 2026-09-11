import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { CircleNotificationToggles } from '@/features/discover/components/circle-notification-toggles';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

/**
 * 圈子动态头部的通知设置快捷入口。内容与整页设置同源（CircleNotificationToggles），
 * 这里只负责承载 —— 从信息流里调开关不值得整页跳转再返回。
 */

interface CircleNotificationSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
}

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    paddingTop: Spacing.sm,
    borderCurve: 'continuous',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
  },
  header: {
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 60,
  },
  title: {
    ...Typography.h3,
    textAlign: 'center',
  },
  closeButton: {
    position: 'absolute',
    right: Spacing.md,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  body: {
    paddingHorizontal: Spacing.lg,
  },
});

export function CircleNotificationSettingsSheet({
  visible,
  onClose,
}: CircleNotificationSettingsSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      title: { color: colors.text },
      closeButton: { backgroundColor: colors.inputBg },
    }),
    [colors],
  );

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      backdropStyle={d.backdrop}
      sheetStyle={[
        s.sheet,
        d.sheet,
        { paddingBottom: Math.max(insets.bottom, Spacing.md) },
      ]}
    >
      <View style={[s.handle, d.handle]} />
      <View style={s.header}>
        <Text style={[s.title, d.title]} numberOfLines={1}>
          {t('discover.notifications.title')}
        </Text>
        <Pressable
          style={({ pressed }) => [
            s.closeButton,
            d.closeButton,
            pressed && { opacity: 0.65 },
          ]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* 开关文案是三行一档，小屏 + 大字号下会超过弹层高度，给一层滚动兜底。 */}
      <ScrollView
        style={{ maxHeight: 420 }}
        contentContainerStyle={s.body}
        showsVerticalScrollIndicator={false}
      >
        <CircleNotificationToggles />
      </ScrollView>
    </BottomSheetModal>
  );
}
