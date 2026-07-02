import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { useNetworkStatus } from '@/hooks/use-network-status';
import { fetchCurrentUser } from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';
import {
  fetchMembershipPlans,
  upgradeMembership,
  FALLBACK_MEMBERSHIP_PLANS,
  type MembershipPlan,
} from '@/services/api/membership';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  hero: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    minHeight: 128,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroOrb: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 999,
    right: -30,
    top: -50,
    opacity: 0.28,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  levelCard: {
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  levelTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.md,
  },
  levelLeft: {
    flex: 1,
    gap: 3,
  },
  levelPoints: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.xs,
  },
  cta: {
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    textAlign: 'center',
  },
});

export default function MemberCenterScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isOffline } = useNetworkStatus();
  const vipLevel = useAuthStore((state) => state.user?.vipLevel ?? 0);
  const setUser = useAuthStore((state) => state.setUser);
  const [plans, setPlans] = useState<MembershipPlan[]>(FALLBACK_MEMBERSHIP_PLANS);
  const [selectedLevel, setSelectedLevel] = useState(Math.min(Math.max(vipLevel || 1, 1), 5));
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const selectedPlan = plans.find((item) => item.level === selectedLevel) ?? plans[0];
  const canUpgrade = selectedLevel > vipLevel && !submitting && !isOffline;

  useEffect(() => {
    let cancelled = false;

    async function loadPlans() {
      setLoadingPlans(true);
      try {
        const nextPlans = await fetchMembershipPlans();
        if (!cancelled) {
          setPlans(nextPlans);
          const nextLevel = Math.min(Math.max(vipLevel || 1, 1), 5);
          setSelectedLevel(nextLevel);
        }
      } catch {
        if (!cancelled) {
          setStatusText(
            t('profile.membership.loadError', {
              defaultValue: '会员等级加载失败，已显示本地等级配置',
            }),
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingPlans(false);
        }
      }
    }

    loadPlans();

    return () => {
      cancelled = true;
    };
  }, [t, vipLevel]);

  const performUpgrade = useCallback(async () => {
    setSubmitting(true);
    setStatusText(null);
    try {
      const result = await upgradeMembership(selectedLevel);
      const nextUser = await fetchCurrentUser();
      setUser(nextUser);
      setStatusText(
        t('profile.membership.exchangeSuccess', {
          defaultValue: '已成功兑换 VIP{{level}}',
          level: result.user.vipLevel,
        }),
      );
    } catch (err) {
      // 后端会带上 errorCode(积分不足 / 等级非法 / 等级不够高),getApiErrorMessage
      // 优先按码本地化,缺码才回落这句通用兜底。
      setStatusText(
        getApiErrorMessage(
          err,
          t('profile.membership.exchangeError', {
            defaultValue: '兑换失败，请确认积分余额足够后重试',
          }),
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }, [selectedLevel, setUser, t]);

  const handleUpgrade = useCallback(() => {
    if (!canUpgrade) {
      return;
    }
    Alert.alert(
      t('profile.membership.confirmExchange', { defaultValue: '确认兑换' }),
      t('profile.membership.confirmExchangeMessage', {
        defaultValue: '确定要消耗 {{points}} 积分兑换 {{plan}} 吗？',
        points: selectedPlan.price,
        plan: selectedPlan.name,
      }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('profile.membership.confirmExchange', { defaultValue: '确认兑换' }),
          onPress: performUpgrade,
        },
      ],
    );
  }, [canUpgrade, performUpgrade, selectedPlan.name, selectedPlan.price, t]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
      },
      content: {
        paddingBottom: insets.bottom + Spacing.xl,
      },
      hero: {
        backgroundColor: colors.memberCardBg,
      },
      heroOrb: {
        backgroundColor: colors.white,
      },
      heroTitle: {
        color: '#D946EF',
        ...Typography.h1,
      },
      heroText: {
        color: colors.memberCardText,
        ...Typography.body,
        marginTop: Spacing.xs,
      },
      sectionTitle: {
        color: colors.text,
        ...Typography.h2,
      },
      rulesLink: {
        color: colors.primary,
        ...Typography.caption,
        fontWeight: '700' as const,
      },
      levelCard: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      levelCardActive: {
        borderColor: '#FACC15',
        backgroundColor: 'rgba(250, 204, 21, 0.12)',
      },
      levelName: {
        color: colors.text,
        ...Typography.h3,
      },
      perk: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      oldPoints: {
        color: colors.textSecondary,
        fontSize: 20,
        fontWeight: '700' as const,
        textDecorationLine: 'line-through' as const,
      },
      points: {
        color: colors.orange,
        fontSize: 30,
        fontWeight: '800' as const,
        fontVariant: ['tabular-nums'] as any,
      },
      pointsUnit: {
        color: colors.orange,
        ...Typography.caption,
        fontWeight: '700' as const,
      },
      currentBadge: {
        color: colors.success,
        ...Typography.caption,
        fontWeight: '700' as const,
      },
      cta: {
        backgroundColor: colors.primary,
      },
      ctaDisabled: {
        backgroundColor: colors.surfaceBorder,
      },
      ctaText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '700' as const,
      },
      status: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
    }),
    [colors, insets.bottom, insets.top],
  );

  return (
    <View style={d.container}>
      <NavHeader
        title={t('profile.membership.title', { defaultValue: '会员中心' })}
        rightIcon="help-circle-outline"
        onRightPress={() => router.push('/(tabs)/profile/member-rules' as never)}
      />
      <ScrollView
        contentContainerStyle={[s.content, d.content]}
        showsVerticalScrollIndicator={false}
      >
        {isOffline ? (
          <Text style={d.status}>
            {t('common.offline', { defaultValue: '当前无网络连接，部分功能可能不可用' })}
          </Text>
        ) : null}
        <View style={[s.hero, d.hero]}>
          <View style={[s.heroOrb, d.heroOrb]} />
          <Text style={d.heroTitle}>
            {t('profile.membership.activateVip', { defaultValue: '开通VIP会员' })}
          </Text>
          <Text style={d.heroText}>
            {t('profile.membership.currentLevel', {
              defaultValue: '当前等级：VIP{{level}}',
              level: vipLevel,
            })}
          </Text>
          <Text style={d.heroText}>
            {t('profile.membership.benefitsHint', {
              defaultValue: '尊享会员权益，等级越高权益越多。',
            })}
          </Text>
        </View>

        <View style={s.sectionHeader}>
          <Text style={d.sectionTitle}>
            {t('profile.membership.exchange', { defaultValue: '兑换会员' })}
          </Text>
          <Pressable onPress={() => router.push('/(tabs)/profile/member-rules' as never)}>
            <Text style={d.rulesLink}>
              {t('profile.memberRules.link', { defaultValue: '会员规则' })}
            </Text>
          </Pressable>
        </View>

        {plans.map((item) => {
          const active = selectedLevel === item.level;
          const isCurrent = vipLevel === item.level;

          return (
            <Pressable
              key={item.level}
              style={[s.levelCard, d.levelCard, active && d.levelCardActive]}
              onPress={() => setSelectedLevel(item.level)}
            >
              <View style={s.levelTop}>
                <View style={s.levelLeft}>
                  <Text style={d.levelName}>{item.name}</Text>
                  <Text style={d.perk}>
                    {t(item.perksKey, { defaultValue: item.defaultPerks })}
                  </Text>
                </View>
                <View style={s.levelPoints}>
                  <Text style={d.oldPoints}>{item.price + 100}</Text>
                  <Text style={d.points}>{item.price}</Text>
                  <Text style={d.pointsUnit}>{t('common.coin', { defaultValue: '积分' })}</Text>
                </View>
              </View>
              {isCurrent ? (
                <Text style={d.currentBadge}>
                  {t('profile.membership.currentBadge', { defaultValue: '当前等级' })}
                </Text>
              ) : null}
            </Pressable>
          );
        })}

        {statusText ? <Text style={[s.status, d.status]}>{statusText}</Text> : null}

        <Pressable
          style={[s.cta, canUpgrade ? d.cta : d.ctaDisabled]}
          disabled={!canUpgrade}
          onPress={handleUpgrade}
        >
          <Text style={d.ctaText}>
            {loadingPlans
              ? t('profile.membership.loadingPlans', { defaultValue: '正在加载会员等级' })
              : canUpgrade
                ? t('profile.membership.confirmExchangePlan', {
                    defaultValue: '确认兑换 {{plan}}',
                    plan: selectedPlan.name,
                  })
                : t('profile.membership.selectHigher', {
                    defaultValue: '请选择更高会员等级',
                  })}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
