import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { topNotice } from '@/components/app/top-notice-store';
import { reportHandledFailure } from '@/observability/report-failure';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';
import { isAppleInAppBrowser } from '../services/home-screen-install';

interface AddToHomeScreenGuideProps {
  visible: boolean;
  onClose: () => void;
}

const prefix = 'homeScreenInstall';
const STEPS = [
  { key: 'share', icon: 'share-outline' },
  { key: 'add', icon: 'add-circle-outline' },
  { key: 'confirm', icon: 'checkmark-circle-outline' },
  { key: 'open', icon: 'apps-outline' },
] as const;

/** iOS 没有可调用的安装接口：把 Safari 分享菜单里的几步讲清楚。 */
export const AddToHomeScreenGuide: React.FC<AddToHomeScreenGuideProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const inAppBrowser = visible && isAppleInAppBrowser();
  const d = useMemo(() => ({
    sheet: { backgroundColor: colors.surface, paddingBottom: insets.bottom || Spacing.lg },
    handle: { backgroundColor: colors.surfaceBorder },
    title: { color: colors.text },
    secondary: { color: colors.textSecondary },
    warning: { backgroundColor: withAlpha(colors.warning, 0.12) },
    stepIcon: { backgroundColor: withAlpha(colors.primary, 0.12) },
    button: { backgroundColor: colors.primary },
  }), [colors, insets.bottom]);

  const copyLink = () => {
    Clipboard.setStringAsync(window.location.href)
      .then(() => topNotice.success(t(`${prefix}.linkCopied`)))
      .catch(error => reportHandledFailure('homeScreenInstall', 'copyLink', error));
  };

  return (
    <BottomSheetModal visible={visible} onClose={onClose} sheetStyle={[s.sheet, d.sheet]}>
      <View style={[s.handle, d.handle]} />
      <Text style={[s.title, d.title]}>{t(`${prefix}.title`)}</Text>
      <Text style={[s.intro, d.secondary]}>{t(`${prefix}.intro`)}</Text>
      {inAppBrowser ? (
        <View style={[s.warning, d.warning]}>
          <Text style={[s.stepDetail, d.title]}>{t(`${prefix}.inAppBrowser`)}</Text>
          <Pressable onPress={copyLink} accessibilityRole="button" style={s.copyButton}>
            <Text style={[s.copyLabel, { color: colors.iconAccent }]}>{t(`${prefix}.copyLink`)}</Text>
          </Pressable>
        </View>
      ) : null}
      {STEPS.map((step, index) => (
        <View key={step.key} style={s.step}>
          <View style={[s.stepIcon, d.stepIcon]}>
            <Ionicons name={step.icon} size={20} color={colors.iconAccent} />
          </View>
          <View style={s.stepText}>
            <Text style={[s.stepTitle, d.title]}>{`${index + 1}. ${t(`${prefix}.steps.${step.key}.title`)}`}</Text>
            <Text style={[s.stepDetail, d.secondary]}>{t(`${prefix}.steps.${step.key}.detail`)}</Text>
          </View>
        </View>
      ))}
      <Pressable onPress={onClose} accessibilityRole="button" style={[s.doneButton, d.button]}>
        <Text style={[s.doneLabel, { color: colors.white }]}>{t(`${prefix}.done`)}</Text>
      </Pressable>
    </BottomSheetModal>
  );
};

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: Radius.full },
  title: { ...Typography.h3, marginTop: Spacing.sm },
  intro: { ...Typography.bodyRegular, lineHeight: 20 },
  warning: { borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  copyButton: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  copyLabel: { ...Typography.caption },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  stepIcon: { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1, minWidth: 0, gap: Spacing.xs },
  stepTitle: { ...Typography.body },
  stepDetail: { ...Typography.small, lineHeight: 18 },
  doneButton: {
    minHeight: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  doneLabel: { ...Typography.body, fontWeight: '600' },
});
