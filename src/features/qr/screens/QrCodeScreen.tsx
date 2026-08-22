import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { CircleAvatar } from '@/components/ui/circle-avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { ShareQrSheet } from '@/features/qr/components/ShareQrSheet';
import { buildQrUrl } from '@/features/qr/qr-payload';
import { saveQrPngToLibrary } from '@/features/qr/save-qr-image';
import { getApiErrorMessage } from '@/services/api/errors';
import {
  issueQrToken,
  rotateUserQrToken,
  type QrTokenType,
} from '@/services/api/qr';
import type { QrCardData } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { getLocalizedDateTimeLocale } from '@/utils/locale';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const QR_SIZE = 220;

type RouteType = 'user' | 'group' | 'circle';

// 展示码只有三种实体类型；LOGIN 是网页端登录会话，不在本屏签发。
const TYPE_MAP: Record<RouteType, Exclude<QrTokenType, 'LOGIN'>> = {
  user: 'USER',
  group: 'GROUP',
  circle: 'CIRCLE',
};

/**
 * 二维码展示页(微信同款):个人名片 / 独立群聊 / 圈子共用。
 * 令牌服务端签发;群/圈码七天有效,「重新进入将更新」由签发端的轮换窗口保证。
 */
export default function QrCodeScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const params = useLocalSearchParams<{
    type?: string;
    id?: string;
    name?: string;
    avatarUrl?: string;
  }>();
  const currentUser = useAuthStore((state) => state.user);

  const routeType: RouteType =
    params.type === 'group' || params.type === 'circle' ? params.type : 'user';
  const targetId = typeof params.id === 'string' ? params.id : undefined;
  const displayName =
    (typeof params.name === 'string' && params.name) ||
    (routeType === 'user' ? currentUser?.nickname || '' : '');
  const avatarUrl =
    (typeof params.avatarUrl === 'string' && params.avatarUrl) ||
    (routeType === 'user' ? currentUser?.avatarUrl || undefined : undefined);

  const [qrValue, setQrValue] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  // 分享用的卡片载荷:令牌没签发下来之前按钮就是禁用态,不存在「开着面板但没内容」。
  const [shareCard, setShareCard] = useState<QrCardData | null>(null);
  // 令牌原文(qrValue 是它拼出来的深链);卡片只带令牌,不带整条 URL。
  const [qrToken, setQrToken] = useState<string | null>(null);
  // react-native-qrcode-svg 的 getRef 回调给出 svg 实例,toDataURL 导出 PNG base64。
  const qrSvgRef = useRef<{ toDataURL: (cb: (data: string) => void) => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setQrValue(null);
    setQrToken(null);
    setErrorText(null);
    issueQrToken({ type: TYPE_MAP[routeType], targetId })
      .then((result) => {
        if (cancelled) return;
        setQrToken(result.token);
        setQrValue(buildQrUrl(result.token));
        setExpiresAt(result.expiresAt);
      })
      .catch((error) => {
        if (cancelled) return;
        setErrorText(getApiErrorMessage(error, t('qr.issueFailed')));
      });
    return () => {
      cancelled = true;
    };
  }, [routeType, t, targetId]);

  const captureQrPng = useCallback(async () => {
    const svg = qrSvgRef.current;
    if (!svg) return null;
    return new Promise<string>((resolve) => svg.toDataURL(resolve));
  }, []);

  const handleSave = useCallback(async () => {
    if (saving || !qrValue) return;
    setSaving(true);
    try {
      const base64 = await captureQrPng();
      if (!base64) return;
      const outcome = await saveQrPngToLibrary(base64);
      if (outcome === 'denied') {
        Alert.alert(t('qr.saveDeniedTitle'), t('qr.saveDeniedMessage'));
        return;
      }
      Alert.alert(t('qr.savedTitle'), t('qr.savedMessage'));
    } catch {
      Alert.alert(t('qr.saveFailedTitle'), t('qr.saveFailedMessage'));
    } finally {
      setSaving(false);
    }
  }, [captureQrPng, qrValue, saving, t]);

  /**
   * 「分享二维码」——发的是二维码卡片进某个私聊 / 群聊,不是把裸链接甩进系统面板。
   * 链接分享等于把入群 / 加好友的令牌明文交给任意 App;卡片留在站内,
   * 收方看到头像 + 名字 + 码本身,点一下就走落地页。
   */
  const handleShare = useCallback(() => {
    if (!qrToken) {
      Alert.alert(t('qr.shareFailedTitle'), t('qr.shareFailedMessage'));
      return;
    }
    setShareCard({
      token: qrToken,
      qrType: routeType,
      name: displayName || t('qr.unnamed'),
      avatarUrl: avatarUrl ?? null,
    });
  }, [avatarUrl, displayName, qrToken, routeType, t]);

  const rotateToken = useCallback(async () => {
    if (rotating) return;
    setRotating(true);
    try {
      const result = await rotateUserQrToken();
      setQrToken(result.token);
      setQrValue(buildQrUrl(result.token));
      setExpiresAt(result.expiresAt);
      setErrorText(null);
      Alert.alert(t('qr.resetSuccessTitle'), t('qr.resetSuccessMessage'));
    } catch (error) {
      Alert.alert(
        t('qr.resetFailedTitle'),
        getApiErrorMessage(error, t('qr.resetFailedMessage')),
      );
    } finally {
      setRotating(false);
    }
  }, [rotating, t]);

  const handleRotate = useCallback(() => {
    if (routeType !== 'user' || rotating) return;
    Alert.alert(t('qr.resetConfirmTitle'), t('qr.resetConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('qr.reset'),
        style: 'destructive',
        onPress: () => void rotateToken(),
      },
    ]);
  }, [rotateToken, rotating, routeType, t]);

  const title =
    routeType === 'group'
      ? t('qr.groupTitle')
      : routeType === 'circle'
        ? t('qr.circleTitle')
        : t('qr.userTitle');

  const hint =
    routeType === 'group'
      ? t('qr.groupHint')
      : routeType === 'circle'
        ? t('qr.circleHint')
        : t('qr.userHint');

  const expiryText = useMemo(() => {
    if (routeType === 'user') return t('qr.userValidity');
    if (!expiresAt) return null;
    const date = new Date(expiresAt).toLocaleDateString(
      getLocalizedDateTimeLocale(i18n.language),
      { month: 'long', day: 'numeric' },
    );
    return t('qr.expiresBefore', { date });
  }, [expiresAt, i18n.language, routeType, t]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      card: { backgroundColor: colors.surface },
      name: { color: colors.text },
      hint: { color: colors.textSecondary },
      expiry: { color: colors.textSecondary },
      error: { color: colors.error },
      qrCard: { backgroundColor: colors.white },
      primaryButton: { backgroundColor: colors.primary },
      primaryText: { color: colors.white },
      secondaryButton: {
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.surfaceBorder,
      },
      secondaryText: { color: colors.text },
      resetText: { color: colors.primary },
    }),
    [colors],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={title} />
      <View style={s.body}>
        <View style={[s.card, d.card]}>
          <View style={s.identityRow}>
            {routeType === 'group' ? (
              <GroupChatAvatar size={48} name={displayName} uri={avatarUrl} />
            ) : routeType === 'circle' ? (
              <CircleAvatar size={48} uri={avatarUrl ?? null} />
            ) : (
              <Avatar size={48} name={displayName} uri={avatarUrl} shape="square" />
            )}
            <Text style={[s.name, d.name]} numberOfLines={2}>
              {displayName || t('qr.unnamed')}
            </Text>
          </View>

          <View style={[s.qrCard, d.qrCard]}>
            {qrValue ? (
              <QRCode
                value={qrValue}
                size={QR_SIZE}
                color="#111111"
                backgroundColor="#FFFFFF"
                getRef={(ref) => {
                  qrSvgRef.current = ref;
                }}
              />
            ) : errorText ? (
              <Text style={[s.errorText, d.error]}>{errorText}</Text>
            ) : (
              <ActivityIndicator color={colors.primary} />
            )}
          </View>

          <Text style={[s.hint, d.hint]}>{hint}</Text>
          {expiryText ? (
            <Text style={[s.expiry, d.expiry]}>{expiryText}</Text>
          ) : null}
        </View>

        <View style={s.actions}>
          <Pressable
            style={[
              s.actionButton,
              d.primaryButton,
              (!qrValue || rotating) && s.actionDisabled,
            ]}
            onPress={() => void handleSave()}
            disabled={!qrValue || saving || rotating}
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={[s.actionText, d.primaryText]}>{t('qr.saveImage')}</Text>
            )}
          </Pressable>
          <Pressable
            style={[
              s.actionButton,
              d.secondaryButton,
              (!qrToken || rotating) && s.actionDisabled,
            ]}
            onPress={handleShare}
            disabled={!qrToken || rotating}
            accessibilityRole="button"
          >
            <Text style={[s.actionText, d.secondaryText]}>{t('qr.shareQr')}</Text>
          </Pressable>
        </View>
        {routeType === 'user' ? (
          <Pressable
            style={[s.resetButton, rotating && s.actionDisabled]}
            onPress={handleRotate}
            disabled={rotating}
            accessibilityRole="button"
          >
            {rotating ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={[s.resetText, d.resetText]}>{t('qr.reset')}</Text>
            )}
          </Pressable>
        ) : null}
      </View>

      <ShareQrSheet card={shareCard} onClose={() => setShareCard(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.lg,
  },
  card: {
    alignSelf: 'stretch',
    borderRadius: Radius.lg,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    alignSelf: 'stretch',
  },
  name: {
    ...Typography.h3,
    flex: 1,
  },
  qrCard: {
    width: QR_SIZE + Spacing.lg * 2,
    height: QR_SIZE + Spacing.lg * 2,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    ...Typography.bodyRegular,
    textAlign: 'center',
  },
  expiry: {
    ...Typography.caption,
    textAlign: 'center',
  },
  errorText: {
    ...Typography.bodyRegular,
    textAlign: 'center',
    paddingHorizontal: Spacing.md,
  },
  actions: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: Spacing.md,
  },
  actionButton: {
    flex: 1,
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionDisabled: {
    opacity: 0.5,
  },
  actionText: {
    ...Typography.body,
    fontWeight: '600',
  },
  resetButton: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetText: {
    ...Typography.body,
    fontWeight: '600',
  },
});
