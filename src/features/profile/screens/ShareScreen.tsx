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
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const INVITE_CODE = 'CIRCLE-134273011';
const INVITE_URL = `https://circle.im/invite?code=${INVITE_CODE}`;

const s = StyleSheet.create({
  qrSection: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.md,
  },
  qrCard: {
    width: 220,
    height: 220,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inviteBlock: {
    gap: Spacing.xs,
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
      qrCard: {
        backgroundColor: colors.white,
      },
      qrTitle: {
        color: colors.text,
        ...Typography.h3,
      },
      qrSubtitle: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        textAlign: 'center' as const,
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

  const handleShareQr = useCallback(async () => {
    await Share.share({
      message: t('shareScreen.shareMessage', {
        url: INVITE_URL,
        code: INVITE_CODE,
      }),
    });
  }, [t]);

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
        <View style={s.qrSection}>
          <Text style={d.qrTitle}>{t('shareScreen.qrTitle')}</Text>
          <View style={[s.qrCard, d.qrCard]}>
            <QRCode value={INVITE_URL} size={164} color="#111111" backgroundColor="#FFFFFF" />
          </View>
          <Text style={d.qrSubtitle}>
            {t('shareScreen.qrSubtitle')}
          </Text>
        </View>

        <View style={s.inviteBlock}>
          <Text style={d.inviteLabel}>{t('shareScreen.inviteCode')}</Text>
          <Text style={d.inviteCode}>{INVITE_CODE}</Text>
        </View>

        <View>
          <Pressable style={s.actionRow} onPress={handleShareQr}>
            <Ionicons name="qr-code-outline" size={22} color={colors.text} />
            <View style={s.actionTextWrap}>
              <Text style={d.actionTitle}>{t('shareScreen.shareQrTitle')}</Text>
              <Text style={d.actionSubtitle}>{t('shareScreen.shareQrSubtitle')}</Text>
            </View>
          </Pressable>
          <Divider />
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
