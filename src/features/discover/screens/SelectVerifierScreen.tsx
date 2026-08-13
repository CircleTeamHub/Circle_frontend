import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import {
  addVerifierToInvitation,
  fetchEligibleVerifiers,
} from '@/services/api/circles';
import { getApiErrorMessage } from '@/services/api/errors';
import type { CircleInvitationUser } from '@/types';

const s = StyleSheet.create({
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  info: {
    flex: 1,
  },
  selectBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 16,
  },
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function SelectVerifierScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const { id: invitationId } = useLocalSearchParams<{
    id: string;
    circleId: string;
    circleName: string;
  }>();

  // 候选人 = 好友 ∩ 本圈 ACTIVE 成员,交集由服务端算好(见 fetchEligibleVerifiers)。
  // 以前这里拉的是全部好友,圈外好友照列、点了才被服务端打回。
  const [candidates, setCandidates] = useState<CircleInvitationUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  // 候选名单必须钉在发起它的那张担保单上。这条路由的实例可以从一张单换到
  // 另一张(参数变了但组件没重挂),旧请求后落地就会把上一张单的候选人装进来 ——
  // 点其中一个提交到新的 invitationId 上,只会换来一句莫名其妙的资格失败。
  const loadedForRef = useRef<string | null>(null);

  const loadCandidates = useCallback(async () => {
    if (!invitationId) {
      setLoading(false);
      return;
    }
    loadedForRef.current = invitationId;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchEligibleVerifiers(invitationId);
      if (loadedForRef.current !== invitationId) return;
      setCandidates(data);
    } catch (error) {
      if (loadedForRef.current !== invitationId) return;
      setLoadError(
        t('invitation.loadVerifiersFailed', {
          defaultValue: '加载候选人失败，请稍后重试',
        }),
      );
      if (__DEV__) {
        console.warn(
          '[SelectVerifierScreen] fetchEligibleVerifiers failed',
          error,
        );
      }
    } finally {
      if (loadedForRef.current === invitationId) setLoading(false);
    }
  }, [invitationId, t]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      name: { color: colors.text, ...Typography.body, fontWeight: '600' as const },
      accountId: { color: colors.textSecondary, ...Typography.caption },
      selectBtn: { backgroundColor: colors.primary },
      selectText: { color: colors.white, ...Typography.caption, fontWeight: '600' as const },
      emptyText: { color: colors.textSecondary, ...Typography.body },
      retryButton: {
        marginTop: Spacing.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.full,
        backgroundColor: colors.primary,
      },
      retryText: {
        color: colors.white,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  const handleSelect = useCallback(
    async (candidate: CircleInvitationUser) => {
      if (!invitationId || submittingId) return;
      setSubmittingId(candidate.id);
      try {
        // 验证邀请名片由服务端签发:addVerifier 提交席位之后,后端用
        // ChatSystemMessageService 把卡片发给验证人(点击直达验证页)。
        // 这里曾经自己发一条 —— 而 verification-card 是服务端专属类型,那次发送
        // 100% 被拒,还被 best-effort 的 catch 吞掉,卡片从来没送达过。
        await addVerifierToInvitation(invitationId, candidate.id);
        Alert.alert(
          t('invitation.invited'),
          t('invitation.invitedMessage', { name: candidate.nickname }),
        );
        router.back();
      } catch (error: unknown) {
        Alert.alert(
          t('invitation.addFailed'),
          getApiErrorMessage(error, t('invitation.addFailed')),
        );
      } finally {
        setSubmittingId(null);
      }
    },
    [invitationId, submittingId, router, t],
  );

  const renderItem = useCallback(
    ({ item }: { item: CircleInvitationUser }) => (
      <View>
        <View style={s.row}>
          <Avatar
            size={44}
            name={item.nickname}
            uri={item.avatarUrl ?? undefined}
          />
          <View style={s.info}>
            <Text style={d.name}>{item.nickname}</Text>
            <Text style={d.accountId}>{item.accountId}</Text>
          </View>
          <Pressable
            style={[s.selectBtn, d.selectBtn]}
            onPress={() => handleSelect(item)}
            disabled={submittingId === item.id}
          >
            {submittingId === item.id ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={d.selectText}>{t('invitation.select')}</Text>
            )}
          </Pressable>
        </View>
        <Divider />
      </View>
    ),
    [handleSelect, d, submittingId, colors, t],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('invitation.selectVerifier')} />
      {loading ? (
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : loadError && candidates.length === 0 ? (
        <View style={s.centerLoader}>
          <Text style={d.emptyText}>{loadError}</Text>
          <Pressable style={d.retryButton} onPress={loadCandidates}>
            <Text style={d.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={candidates}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          ListEmptyComponent={
            <View style={s.centerLoader}>
              <Text style={{ color: colors.textSecondary, ...Typography.body }}>
                {t('invitation.noEligibleVerifiers', {
                  defaultValue: '没有可选的验证人：验证人得既是你的好友，又已经在这个圈子里',
                })}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
