import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { CircleAvatar } from '@/components/ui/circle-avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import {
  getSendFriendRequestHref,
  getUserProfileHref,
} from '@/features/user/utils/routes';
import { getApiErrorMessage } from '@/services/api/errors';
import { approveQrLogin } from '@/services/api/qr-login';
import {
  joinByQrToken,
  resolveQrToken,
  type QrResolveResult,
} from '@/services/api/qr';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

/**
 * 扫码落地页:App 内扫码与外部相机深链(windnoteai://qr?t=..)都汇到这里。
 * 先 resolve 预览(是什么、多少人、来自谁),用户确认后才执行加入 —— 扫到什么
 * 都不自动入群/入圈,授权动作必须是用户自己按下去的。
 */
export default function QrLandingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ t?: string }>();
  const token = typeof params.t === 'string' ? params.t : '';

  const [preview, setPreview] = useState<QrResolveResult | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setErrorText(null);
    if (!token) {
      setErrorText(t('qr.invalid'));
      return;
    }
    resolveQrToken(token)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((error) => {
        if (!cancelled) setErrorText(getApiErrorMessage(error, t('qr.invalid')));
      });
    return () => {
      cancelled = true;
    };
  }, [t, token]);

  const openConversation = useCallback(
    (conversationId: string, name: string) => {
      // 独立群聊:sourceID 就是会话 id(与消息列表进入同一形状)。
      router.replace({
        pathname: '/(tabs)/messages/chat-detail',
        params: {
          conversationID: conversationId,
          sourceID: conversationId,
          title: name,
          conversationType: 'group',
          conversationKind: 'group',
        },
      });
    },
    [router],
  );

  const handlePrimary = useCallback(async () => {
    if (!preview || joining) return;

    // 网页扫码登录:确认后网页端轮询会自动完成登录,这里只负责 approve。
    if (preview.type === 'LOGIN') {
      setJoining(true);
      try {
        await approveQrLogin(token);
        Alert.alert(
          t('qr.loginDoneTitle', { defaultValue: '已确认登录' }),
          t('qr.loginDoneMessage', { defaultValue: '网页端正在登录你的账号' }),
          [{ text: t('common.ok'), onPress: () => router.back() }],
        );
      } catch (error) {
        Alert.alert(
          t('qr.joinFailedTitle'),
          getApiErrorMessage(error, t('qr.invalid')),
        );
      } finally {
        setJoining(false);
      }
      return;
    }

    if (preview.type === 'USER') {
      if (preview.viewerState === 'SELF') return;
      if (preview.viewerState === 'FRIEND') {
        router.replace(
          getUserProfileHref('messages', preview.targetId, preview.name),
        );
        return;
      }
      // 加好友:跳申请页,qrToken 一路带到服务端换 addMeByQrCode 放行。
      router.push(
        getSendFriendRequestHref('messages', preview.targetId, preview.name, {
          qrToken: token,
        }),
      );
      return;
    }

    if (preview.viewerState === 'ALREADY_IN') {
      if (preview.type === 'GROUP') {
        openConversation(preview.targetId, preview.name);
      } else {
        router.back();
      }
      return;
    }

    setJoining(true);
    try {
      const result = await joinByQrToken(token);
      if (result.type === 'GROUP' && result.conversationId) {
        openConversation(result.conversationId, preview.name);
        return;
      }
      if (result.status === 'JOINED') {
        Alert.alert(t('qr.circleJoinedTitle'), t('qr.circleJoinedMessage', { name: preview.name }), [
          { text: t('common.ok'), onPress: () => router.back() },
        ]);
      } else {
        // 严格招新(10 人担保):建了邀请单,等验证人凑齐。
        Alert.alert(t('qr.circlePendingTitle'), t('qr.circlePendingMessage'), [
          { text: t('common.ok'), onPress: () => router.back() },
        ]);
      }
    } catch (error) {
      Alert.alert(
        t('qr.joinFailedTitle'),
        getApiErrorMessage(error, t('qr.joinFailed')),
      );
    } finally {
      setJoining(false);
    }
  }, [joining, openConversation, preview, router, t, token]);

  const primaryLabel = useMemo(() => {
    if (!preview) return '';
    if (preview.type === 'LOGIN') {
      return t('qr.loginConfirm', { defaultValue: '确认登录' });
    }
    if (preview.type === 'USER') {
      if (preview.viewerState === 'SELF') return t('qr.thisIsYou');
      if (preview.viewerState === 'FRIEND') return t('qr.viewProfile');
      return t('qr.addFriend');
    }
    if (preview.viewerState === 'ALREADY_IN') {
      return preview.type === 'GROUP' ? t('qr.enterGroup') : t('qr.alreadyInCircle');
    }
    return preview.type === 'GROUP' ? t('qr.joinGroup') : t('qr.joinCircle');
  }, [preview, t]);

  const subtitle = useMemo(() => {
    if (!preview) return null;
    if (preview.type === 'LOGIN') {
      return t('qr.loginSubtitle', { defaultValue: '确认后将在网页端登录你的账号' });
    }
    if (preview.type === 'USER') return t('qr.userSubtitle');
    const base =
      preview.type === 'GROUP'
        ? t('qr.groupSubtitle', { count: preview.memberCount ?? 0 })
        : t('qr.circleSubtitle', { count: preview.memberCount ?? 0 });
    return preview.issuerNickname
      ? `${base} · ${t('qr.sharedBy', { name: preview.issuerNickname })}`
      : base;
  }, [preview, t]);

  const primaryDisabled =
    !preview || joining || (preview.type === 'USER' && preview.viewerState === 'SELF');

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      card: { backgroundColor: colors.surface },
      name: { color: colors.text },
      subtitle: { color: colors.textSecondary },
      error: { color: colors.textSecondary },
      primaryButton: { backgroundColor: colors.primary },
      primaryText: { color: colors.white },
    }),
    [colors],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('qr.landingTitle')} />
      <View style={s.body}>
        {preview ? (
          <View style={[s.card, d.card]}>
            {preview.type === 'LOGIN' ? (
              <Ionicons name="desktop-outline" size={56} color={colors.primary} />
            ) : preview.type === 'GROUP' ? (
              <GroupChatAvatar size={64} name={preview.name} uri={preview.avatarUrl} />
            ) : preview.type === 'CIRCLE' ? (
              <CircleAvatar size={64} uri={preview.avatarUrl} />
            ) : (
              <Avatar size={64} name={preview.name} uri={preview.avatarUrl ?? undefined} />
            )}
            <Text style={[s.name, d.name]} numberOfLines={2}>
              {preview.type === 'LOGIN'
                ? t('qr.loginTitle', { defaultValue: '登录网页版' })
                : preview.name || t('qr.unnamed')}
            </Text>
            {subtitle ? (
              <Text style={[s.subtitle, d.subtitle]}>{subtitle}</Text>
            ) : null}
            <Pressable
              style={[s.primaryButton, d.primaryButton, primaryDisabled && s.disabled]}
              onPress={() => void handlePrimary()}
              disabled={primaryDisabled}
              accessibilityRole="button"
            >
              {joining ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={[s.primaryText, d.primaryText]}>{primaryLabel}</Text>
              )}
            </Pressable>
          </View>
        ) : errorText ? (
          <View style={[s.card, d.card]}>
            <Text style={[s.errorText, d.error]}>{errorText}</Text>
          </View>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
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
    paddingTop: Spacing.xxl,
    alignItems: 'center',
  },
  card: {
    alignSelf: 'stretch',
    borderRadius: Radius.lg,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
  },
  name: {
    ...Typography.h2,
    textAlign: 'center',
  },
  subtitle: {
    ...Typography.bodyRegular,
    textAlign: 'center',
  },
  errorText: {
    ...Typography.bodyRegular,
    textAlign: 'center',
    lineHeight: 21,
  },
  primaryButton: {
    alignSelf: 'stretch',
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.md,
  },
  disabled: {
    opacity: 0.5,
  },
  primaryText: {
    ...Typography.body,
    fontWeight: '600',
  },
});
