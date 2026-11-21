import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';
import { useAddToHomeScreen } from '../hooks/use-add-to-home-screen';
import { AddToHomeScreenGuide } from './AddToHomeScreenGuide';

const DISMISSED_KEY = 'windnote.home-screen-banner-dismissed';
const prefix = 'homeScreenInstall';

/**
 * 消息列表顶部的「添加到桌面」横幅（只在网页版、还没从主屏幕打开时出现）。
 * 关掉就不再出现；之后仍可从通知设置里的锁屏通知那一行进入步骤说明。
 */
export const AddToHomeScreenBanner: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { mode, start, guideVisible, closeGuide } = useAddToHomeScreen();
  const [dismissed, setDismissed] = useState(false);

  // Chrome 的安装事件可能在首屏之后才到，所以每次渲染都看一眼是否关过，而不是只在挂载时读。
  if (mode === null || dismissed || localStorage.getItem(DISMISSED_KEY) === '1') return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  };

  return (
    <View testID="add-to-home-screen-banner" style={[s.banner, { backgroundColor: withAlpha(colors.warning, 0.1) }]}>
      <Ionicons name="notifications" size={18} color={colors.warning} />
      <Text style={[s.message, { color: colors.text }]} numberOfLines={2}>{t(`${prefix}.banner`)}</Text>
      <Pressable onPress={start} accessibilityRole="button" style={[s.addButton, { backgroundColor: colors.primary }]}>
        <Text style={[s.addLabel, { color: colors.white }]}>{t(`${prefix}.add`)}</Text>
      </Pressable>
      <Pressable
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel={t(`${prefix}.dismiss`)}
        hitSlop={8}
        style={s.closeButton}
      >
        <Ionicons name="close" size={18} color={colors.textSecondary} />
      </Pressable>
      <AddToHomeScreenGuide visible={guideVisible} onClose={closeGuide} />
    </View>
  );
};

const s = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.sm,
    borderRadius: Radius.md,
  },
  message: { ...Typography.caption, flex: 1, minWidth: 0 },
  addButton: {
    minHeight: 32,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: { ...Typography.caption, fontWeight: '600' },
  closeButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
