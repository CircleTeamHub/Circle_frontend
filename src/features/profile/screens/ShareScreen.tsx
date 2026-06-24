import { useCallback, useMemo } from 'react';
import {
  Alert,
  Share,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { Spacing, Typography, useTheme } from '@/theme';

const INVITE_CODE = 'CIRCLE-134273011';

const s = StyleSheet.create({
  inviteBlock: {
    gap: Spacing.xs,
    paddingTop: Spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  actionTextWrap: {
    flex: 1,
    gap: 2,
  },
});

export default function ShareScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      content: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xl,
        gap: Spacing.xl,
      },
      inviteLabel: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      inviteCode: {
        color: colors.text,
        ...Typography.h2,
      },
      actionTitle: {
        color: colors.text,
        ...Typography.body,
      },
      actionSubtitle: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
    }),
    [colors, insets.bottom],
  );

  const handleCopyInviteCode = useCallback(async () => {
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(INVITE_CODE);
      Alert.alert(t('shareScreen.copiedTitle'), t('shareScreen.copiedMessage'));
      return;
    } catch {
      await Share.share({
        message: t('shareScreen.copyMessage', { code: INVITE_CODE }),
      });
      Alert.alert(
        t('shareScreen.copyFallbackTitle'),
        t('shareScreen.copyFallbackMessage'),
      );
    }
  }, [t]);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('profile.share')} />
      <ScrollView
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.inviteBlock}>
          <Text style={d.inviteLabel}>{t('shareScreen.inviteCode')}</Text>
          <Text style={d.inviteCode}>{INVITE_CODE}</Text>
        </View>

        <View>
          <Pressable style={s.actionRow} onPress={handleCopyInviteCode}>
            <Ionicons name="copy-outline" size={22} color={colors.text} />
            <View style={s.actionTextWrap}>
              <Text style={d.actionTitle}>{t('shareScreen.copyInviteTitle')}</Text>
              <Text style={d.actionSubtitle}>{t('shareScreen.copyInviteSubtitle')}</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
