import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { CircleAvatar } from '@/components/ui/circle-avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { topNotice } from '@/components/app/top-notice-store';
import { ShareQrSheet } from '@/features/qr/components/ShareQrSheet';
import { OUTBOUND_APP_QR_SCHEME } from '@/features/qr/app-qr-scheme';
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

const CARD_COVER = require('../../../../assets/images/qr-card-cover.png');
const APP_ICON = require('../../../../assets/images/icon.png');

type RouteType = 'user' | 'group' | 'circle';

const TYPE_MAP: Record<RouteType, QrTokenType> = {
  user: 'USER',
  group: 'GROUP',
  circle: 'CIRCLE',
};

/**
 * 二维码名片展示页：个人 / 独立群聊 / 圈子共用。
 * 令牌服务端签发;群/圈码七天有效,「重新进入将更新」由签发端的轮换窗口保证。
 */
export default function QrCodeScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(420, width - Spacing.lg * 2);
  const cardScale = cardWidth / 960;
  const params = useLocalSearchParams<{
    type?: string;
    id?: string;
    name?: string;
    avatarUrl?: string;
  }>();
  const currentUser = useAuthStore((state) => state.user);

  const routeType: RouteType =
    params.type === 'group' || params.type === 'circle' ? params.type : 'user';
  const cardExtraHeight = routeType === 'user' ? 34 : 0;
  const targetId = typeof params.id === 'string' ? params.id : undefined;
  const displayName =
    (typeof params.name === 'string' && params.name) ||
    (routeType === 'user' ? currentUser?.nickname || '' : '');
  const avatarUrl =
    (typeof params.avatarUrl === 'string' && params.avatarUrl) ||
    (routeType === 'user' ? currentUser?.avatarUrl || undefined : undefined);
  const accountId = routeType === 'user' ? currentUser?.accountId : undefined;
  const cardRef = useRef<View>(null);

  const [qrValue, setQrValue] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [coverReady, setCoverReady] = useState(false);
  const [logoReady, setLogoReady] = useState(false);
  const [readyAvatarUrl, setReadyAvatarUrl] = useState<string | null>(null);
  const cardImagesReady = coverReady && logoReady && (!avatarUrl || readyAvatarUrl === avatarUrl);
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
        setQrValue(buildQrUrl(result.token, OUTBOUND_APP_QR_SCHEME));
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
    if (Platform.OS !== 'web') {
      // 只导出名片区域，排除导航和保存/分享操作栏。
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
      return captureRef(cardRef, { format: 'png', result: 'base64' });
    }
    const svg = qrSvgRef.current;
    if (!svg) return null;
    return new Promise<string>((resolve) => svg.toDataURL(resolve));
  }, []);

  const handleCopyId = useCallback(async () => {
    if (!accountId) return;
    try {
      await Clipboard.setStringAsync(accountId);
      topNotice.success(t('qr.idCopied'));
    } catch {
      topNotice.error(t('qr.copyIdFailed'));
    }
  }, [accountId, t]);

  const handleSave = useCallback(async () => {
    if (saving || !qrValue || !cardImagesReady) return;
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
  }, [captureQrPng, cardImagesReady, qrValue, saving, t]);

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
      setQrValue(buildQrUrl(result.token, OUTBOUND_APP_QR_SCHEME));
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
      expiry: { color: colors.textSecondary },
      error: { color: colors.error },
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

  const qrCode = qrValue ? (
    <QRCode
      value={qrValue}
      size={240 * cardScale}
      color="#111111"
      backgroundColor="#FFFFFF"
      getRef={(ref) => { qrSvgRef.current = ref; }}
    />
  ) : errorText ? (
    <Text style={[s.errorText, d.error]}>{errorText}</Text>
  ) : (
    <ActivityIndicator color={colors.primary} />
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={title} />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.body, { paddingBottom: insets.bottom + Spacing.lg }]}
        showsVerticalScrollIndicator={false}
      >
        <View
          ref={cardRef}
          collapsable={false}
          testID="qr-identity-card"
          style={[
            s.card,
            {
              width: cardWidth,
              height: (1173 + cardExtraHeight) * cardScale,
              borderRadius: 72 * cardScale,
            },
          ]}
        >
          <Image
            testID="qr-card-cover"
            source={CARD_COVER}
            onDisplay={() => setCoverReady(true)}
            style={[s.cardCover, { height: 396 * cardScale }]}
            contentFit="fill"
            accessibilityIgnoresInvertColors
          />
          <View style={[s.cardAvatar, {
            left: 69 * cardScale, top: 303 * cardScale,
            width: 204 * cardScale, height: 204 * cardScale,
            borderRadius: 102 * cardScale, overflow: 'hidden',
          }]}>
            {routeType === 'group' ? (
              <GroupChatAvatar size={204 * cardScale} name={displayName} uri={avatarUrl} onImageReady={() => setReadyAvatarUrl(avatarUrl ?? null)} />
            ) : routeType === 'circle' ? (
              <CircleAvatar size={204 * cardScale} uri={avatarUrl ?? null} onImageReady={() => setReadyAvatarUrl(avatarUrl ?? null)} />
            ) : (
              <Avatar size={204 * cardScale} name={displayName} uri={avatarUrl} shape="circle" onImageReady={() => setReadyAvatarUrl(avatarUrl ?? null)} />
            )}
          </View>
          <View style={[s.cardIdentity, { left: 60 * cardScale, right: 60 * cardScale, top: 552 * cardScale }]}>
            <Text
              style={[s.cardName, { fontSize: 76 * cardScale, lineHeight: 96 * cardScale }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {displayName || t('qr.unnamed')}
            </Text>
            {accountId ? (
              <Pressable
                style={[s.cardAccountRow, { height: Math.max(18, 44 * cardScale) }]}
                onPress={() => void handleCopyId()}
                hitSlop={16}
                accessibilityRole="button"
                accessibilityLabel={t('qr.copyId')}
              >
                <Text style={[s.cardAccount, { fontSize: Math.max(12, 32 * cardScale) }]} numberOfLines={1}>
                  {t('qr.accountId', { id: accountId })}
                </Text>
                <Ionicons name="copy-outline" size={Math.max(14, 32 * cardScale)} color="#929292" />
              </Pressable>
            ) : null}
          </View>
          <View style={[s.cardDivider, {
            left: 60 * cardScale, right: 60 * cardScale,
            top: (685 + cardExtraHeight) * cardScale, height: 3 * cardScale,
          }]} />
          <View style={[s.cardFooter, {
            left: 60 * cardScale, right: 60 * cardScale,
            top: (736 + cardExtraHeight) * cardScale,
          }]}>
            <View style={[s.cardCaptionColumn, { gap: 28 * cardScale, marginRight: 38 * cardScale }]}>
              <Image
                testID="qr-card-logo"
                source={APP_ICON}
                onDisplay={() => setLogoReady(true)}
                style={{ width: 90 * cardScale, height: 90 * cardScale, borderRadius: 20 * cardScale }}
                contentFit="contain"
              />
              <Text style={[s.cardCaption, { fontSize: 38 * cardScale, lineHeight: 58 * cardScale }]}>
                {t(routeType === 'group' ? 'qr.groupCardCaption' : routeType === 'circle' ? 'qr.circleCardCaption' : 'qr.personalCardCaption')}
              </Text>
            </View>
            <View style={[s.cardQr, {
              width: 276 * cardScale, height: 276 * cardScale,
              borderRadius: 34 * cardScale, borderWidth: 2 * cardScale,
            }]}>
              {qrCode}
            </View>
          </View>
          {routeType !== 'user' && expiryText ? (
            <Text style={[s.cardExpiry, {
              left: 60 * cardScale, right: 60 * cardScale,
              top: 1078 * cardScale, fontSize: 28 * cardScale, lineHeight: 36 * cardScale,
            }]} numberOfLines={3}>{expiryText}</Text>
          ) : null}
        </View>

        {routeType === 'user' && expiryText ? (
          <Text style={[s.expiry, d.expiry]}>{expiryText}</Text>
        ) : null}

        <View style={[s.actions, s.cardWidth]}>
          <Pressable
            style={[
              s.actionButton,
              d.primaryButton,
              (!qrValue || rotating || !cardImagesReady) && s.actionDisabled,
            ]}
            onPress={() => void handleSave()}
            disabled={!qrValue || saving || rotating || !cardImagesReady}
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
      </ScrollView>

      <ShareQrSheet card={shareCard} onClose={() => setShareCard(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  body: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.lg,
  },
  cardWidth: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  card: {
    alignSelf: 'center',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  cardCover: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
  },
  cardAvatar: { position: 'absolute' },
  cardIdentity: { position: 'absolute' },
  cardName: {
    color: '#111111',
    fontWeight: '800',
    includeFontPadding: false,
  },
  cardAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cardAccount: {
    color: '#929292',
    flexShrink: 1,
  },
  cardDivider: { position: 'absolute', backgroundColor: '#E8E8E8' },
  cardFooter: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  cardCaptionColumn: { flex: 1 },
  cardCaption: { color: '#939393', fontWeight: '600' },
  cardQr: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E8E8E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardExpiry: {
    position: 'absolute',
    color: '#939393',
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
