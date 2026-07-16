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
import { useAuthStore } from '@/stores/authStore';

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
  actionDisabled: {
    opacity: 0.5,
  },
});

export default function ShareScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const inviteCode = user?.inviteCode;

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
    if (!inviteCode) return;
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(inviteCode);
      Alert.alert(t('shareScreen.copiedTitle'), t('shareScreen.copiedMessage'));
      return;
    } catch {
      await Share.share({
        message: t('shareScreen.copyMessage', { code: inviteCode }),
      });
      Alert.alert(
        t('shareScreen.copyFallbackTitle'),
        t('shareScreen.copyFallbackMessage'),
      );
    }
  }, [inviteCode, t]);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('profile.share')} />
      <ScrollView
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.inviteBlock}>
          <Text style={d.inviteLabel}>{t('shareScreen.inviteCode')}</Text>
          <Text style={d.inviteCode} selectable={Boolean(inviteCode)}>
            {inviteCode ?? t('shareScreen.inviteUnavailable')}
          </Text>
        </View>

        <View>
          <Pressable
            style={[s.actionRow, !inviteCode && s.actionDisabled]}
            onPress={handleCopyInviteCode}
            disabled={!inviteCode}
          >
            <Ionicons name="copy-outline" size={22} color={colors.text} />
            <View style={s.actionTextWrap}>
              <Text style={d.actionTitle}>{t('shareScreen.copyInviteTitle')}</Text>
              <Text style={d.actionSubtitle}>
                {t(
                  inviteCode
                    ? 'shareScreen.copyInviteSubtitle'
                    : 'shareScreen.inviteUnavailableSubtitle',
                )}
              </Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
