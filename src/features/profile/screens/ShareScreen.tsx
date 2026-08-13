import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { useNetworkStatus } from '@/hooks/use-network-status';
import {
  fetchMyReferrals,
  type MyReferrals,
  type ReferralItem,
  type ReferralStatus,
} from '@/services/api/referrals';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const PUBLIC_INVITE_BASE_URL =
  process.env.EXPO_PUBLIC_INVITE_BASE_URL?.trim().replace(/\/+$/, '') || null;

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  hero: {
    minHeight: 210,
    overflow: 'hidden',
  },
  heroOrb: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: Radius.full,
    right: -70,
    top: -100,
    opacity: 0.16,
  },
  code: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 3,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  actionButton: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    flex: 1,
  },
  stats: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  ruleText: {
    flex: 1,
    lineHeight: 21,
  },
  list: {
    gap: Spacing.sm,
  },
  referralRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  referralMain: {
    flex: 1,
    gap: Spacing.xs,
  },
  status: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  disabled: {
    opacity: 0.5,
  },
  centered: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.md,
  },
});

export default function ShareScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { isOffline } = useNetworkStatus();
  const user = useAuthStore((state) => state.user);
  const [data, setData] = useState<MyReferrals | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await fetchMyReferrals());
    } catch (requestError) {
      setError(t('referral.errors.loadFailed'));
      if (__DEV__) console.warn('[ShareScreen] fetchMyReferrals failed', requestError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const inviteCode = data?.inviteCode ?? user?.inviteCode;
  const inviteUrl = inviteCode
    ? PUBLIC_INVITE_BASE_URL
      ? `${PUBLIC_INVITE_BASE_URL}/invite?code=${encodeURIComponent(inviteCode)}`
      : Linking.createURL('/invite', { queryParams: { code: inviteCode } })
    : null;

  const handleCopyInviteCode = useCallback(async () => {
    if (!inviteCode) return;
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(inviteCode);
      Alert.alert(
        t('shareScreen.copiedTitle'),
        t('shareScreen.copiedMessage'),
      );
    } catch {
      await Share.share({
        message: t('shareScreen.copyMessage', { code: inviteCode }),
      });
    }
  }, [inviteCode, t]);

  const handleShareInvite = useCallback(async () => {
    if (!inviteCode || !inviteUrl) return;
    await Share.share({
      message: t('referral.shareMessage', { code: inviteCode, url: inviteUrl }),
      url: inviteUrl,
    });
  }, [inviteCode, inviteUrl, t]);

  const loadMore = useCallback(async () => {
    if (!data?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchMyReferrals({ cursor: data.nextCursor });
      setData((current) =>
        current
          ? {
              ...next,
              items: [...current.items, ...next.items],
            }
          : next,
      );
    } catch (requestError) {
      Alert.alert(t('referral.errors.loadMoreFailed'));
      if (__DEV__)
        console.warn('[ShareScreen] referral pagination failed', requestError);
    } finally {
      setLoadingMore(false);
    }
  }, [data?.nextCursor, loadingMore, t]);

  const statusMeta = useMemo(
    () =>
      ({
        PENDING: {
          label: t('referral.status.pending'),
          color: colors.warning,
        },
        REWARDED: {
          label: t('referral.status.rewarded'),
          color: colors.success,
        },
        CAPPED: {
          label: t('referral.status.capped'),
          color: colors.textSecondary,
        },
        REJECTED: {
          label: t('referral.status.rejected'),
          color: colors.error,
        },
        EXPIRED: {
          label: t('referral.status.expired'),
          color: colors.textSecondary,
        },
      }) satisfies Record<ReferralStatus, { label: string; color: string }>,
    [colors, t],
  );

  const renderReferral = (item: ReferralItem) => {
    const meta = statusMeta[item.status];
    const description =
      item.status === 'REWARDED'
        ? t('referral.item.rewarded', { points: item.inviterReward })
        : item.status === 'PENDING'
          ? t('referral.item.pending', {
              days: data?.rules.qualificationDays ?? 7,
            })
          : t('referral.item.noReward');
    return (
      <View key={item.id} style={s.referralRow}>
        <View style={s.referralMain}>
          <Text selectable style={[Typography.body, { color: colors.text }]}>
            {item.invitee.nickname}
          </Text>
          <Text style={[Typography.small, { color: colors.textSecondary }]}>
            {description}
          </Text>
        </View>
        <View style={[s.status, { backgroundColor: `${meta.color}20` }]}>
          <Text style={[Typography.small, { color: meta.color }]}>
            {meta.label}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
      }}
    >
      <NavHeader title={t('referral.title')} />
      <ScrollView
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {isOffline ? (
          <Text selectable style={[Typography.caption, { color: colors.error }]}>
            {t('common.offline')}
          </Text>
        ) : null}

        <View style={[s.card, s.hero, { backgroundColor: colors.primary }]}>
          <View style={[s.heroOrb, { backgroundColor: colors.white }]} />
          <Text style={[Typography.caption, { color: 'rgba(255,255,255,0.78)' }]}>
            {t('shareScreen.inviteCode')}
          </Text>
          <Text selectable={Boolean(inviteCode)} style={[s.code, { color: colors.white }]}>
            {inviteCode ?? t('shareScreen.inviteUnavailable')}
          </Text>
          <Text style={[Typography.bodyRegular, { color: 'rgba(255,255,255,0.84)' }]}>
            {data && !data.rules.enabled
              ? t('referral.paused')
              : t('referral.heroSubtitle', {
                  inviter: data?.rules.inviterReward ?? 20,
                  invitee: data?.rules.inviteeReward ?? 5,
                })}
          </Text>
          <View style={s.actionRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('shareScreen.copyInviteTitle')}
              disabled={!inviteCode}
              onPress={handleCopyInviteCode}
              style={[
                s.actionButton,
                { backgroundColor: 'rgba(255,255,255,0.18)' },
                !inviteCode && s.disabled,
              ]}
            >
              <Ionicons name="copy-outline" size={18} color={colors.white} />
              <Text style={[Typography.body, { color: colors.white }]}>
                {t('referral.copy')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('referral.share')}
              disabled={!inviteCode}
              onPress={handleShareInvite}
              style={[
                s.actionButton,
                { backgroundColor: colors.white },
                !inviteCode && s.disabled,
              ]}
            >
              <Ionicons name="share-social-outline" size={18} color={colors.primary} />
              <Text style={[Typography.body, { color: colors.primary }]}>
                {t('referral.share')}
              </Text>
            </Pressable>
          </View>
        </View>

        {data ? (
          <>
            <View style={s.stats}>
              {[
                [data.summary.total, t('referral.stats.invited')],
                [data.summary.rewarded, t('referral.stats.rewarded')],
                [data.summary.pointsEarned, t('referral.stats.points')],
              ].map(([value, label]) => (
                <View key={String(label)} style={[s.stat, { backgroundColor: colors.surface }]}>
                  <Text selectable style={[s.statValue, { color: colors.text }]}>{value}</Text>
                  <Text style={[Typography.small, { color: colors.textSecondary }]}>{label}</Text>
                </View>
              ))}
            </View>

            <View style={[s.card, { backgroundColor: colors.surface }]}>
              <Text style={[Typography.h3, { color: colors.text }]}>
                {t('referral.rulesTitle')}
              </Text>
              {[
                t('referral.ruleReward', {
                  inviter: data.rules.inviterReward,
                  invitee: data.rules.inviteeReward,
                }),
                t('referral.ruleQualification', {
                  days: data.rules.qualificationDays,
                }),
                t('referral.ruleCap', { count: data.rules.monthlyCap }),
              ].map((rule) => (
                <View key={rule} style={s.ruleRow}>
                  <Ionicons name="checkmark-circle" size={19} color={colors.success} />
                  <Text style={[Typography.bodyRegular, s.ruleText, { color: colors.textSecondary }]}>
                    {rule}
                  </Text>
                </View>
              ))}
            </View>

            <View style={[s.card, { backgroundColor: colors.surface }]}>
              <Text style={[Typography.h3, { color: colors.text }]}>
                {t('referral.recordsTitle')}
              </Text>
              {data.items.length > 0 ? (
                <View style={s.list}>
                  {data.items.map(renderReferral)}
                  {data.nextCursor ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={loadingMore}
                      onPress={() => void loadMore()}
                      style={[s.actionButton, { backgroundColor: colors.primaryLight }]}
                    >
                      {loadingMore ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : null}
                      <Text style={[Typography.body, { color: colors.primary }]}>
                        {t(
                          loadingMore
                            ? 'referral.loadingMore'
                            : 'referral.loadMore',
                        )}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <Text style={[Typography.bodyRegular, { color: colors.textSecondary }]}>
                  {t('referral.empty')}
                </Text>
              )}
            </View>
          </>
        ) : loading ? (
          <View style={s.centered}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <View style={s.centered}>
            <Text selectable style={[Typography.bodyRegular, { color: colors.error }]}>
              {error}
            </Text>
            <Pressable onPress={() => void load()}>
              <Text style={[Typography.body, { color: colors.primary }]}>
                {t('common.retry')}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
