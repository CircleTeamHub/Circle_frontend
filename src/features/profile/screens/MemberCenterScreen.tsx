import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { useNetworkStatus } from '@/hooks/use-network-status';
import { fetchCurrentUser } from '@/services/api/auth';
import {
  fetchMembershipPlans,
  upgradeMembership,
  type MembershipPlan,
} from '@/services/api/membership';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';

const VIP_LEVELS = [
  { level: 1, name: 'VIP1', price: 780, perks: '基础会员权益' },
  { level: 2, name: 'VIP2', price: 1280, perks: '更多群容量与基础折扣' },
  { level: 3, name: 'VIP3', price: 2100, perks: '高级身份标识与积分加成' },
  { level: 4, name: 'VIP4', price: 4600, perks: '专属靓号折扣与优先体验' },
  { level: 5, name: 'VIP5', price: 9100, perks: '至尊会员权益与最高折扣' },
];

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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isOffline } = useNetworkStatus();
  const vipLevel = useAuthStore((state) => state.user?.vipLevel ?? 0);
  const setUser = useAuthStore((state) => state.setUser);
  const [plans, setPlans] = useState<MembershipPlan[]>(VIP_LEVELS);
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
          setStatusText('会员等级加载失败，已显示本地等级配置');
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
  }, [vipLevel]);

  const performUpgrade = useCallback(async () => {
    setSubmitting(true);
    setStatusText(null);
    try {
      const result = await upgradeMembership(selectedLevel);
      const nextUser = await fetchCurrentUser();
      setUser(nextUser);
      setStatusText(`已成功兑换 VIP${result.user.vipLevel}`);
    } catch {
      setStatusText('兑换失败，请确认积分余额足够后重试');
    } finally {
      setSubmitting(false);
    }
  }, [selectedLevel, setUser]);

  const handleUpgrade = useCallback(() => {
    if (!canUpgrade) {
      return;
    }
    Alert.alert(
      '确认兑换',
      `确定要消耗 ${selectedPlan.price} 积分兑换 ${selectedPlan.name} 吗？`,
      [
        { text: '取消', style: 'cancel' },
        { text: '确认兑换', onPress: performUpgrade },
      ],
    );
  }, [canUpgrade, performUpgrade, selectedPlan.name, selectedPlan.price]);

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
        title="会员中心"
        rightIcon="help-circle-outline"
        onRightPress={() => router.push('/(tabs)/profile/member-rules' as never)}
      />
      <ScrollView
        contentContainerStyle={[s.content, d.content]}
        showsVerticalScrollIndicator={false}
      >
        {isOffline ? <Text style={d.status}>当前无网络连接，部分功能可能不可用</Text> : null}
        <View style={[s.hero, d.hero]}>
          <View style={[s.heroOrb, d.heroOrb]} />
          <Text style={d.heroTitle}>开通VIP会员</Text>
          <Text style={d.heroText}>当前等级：VIP{vipLevel}</Text>
          <Text style={d.heroText}>尊享会员权益，等级越高权益越多。</Text>
        </View>

        <View style={s.sectionHeader}>
          <Text style={d.sectionTitle}>兑换会员</Text>
          <Pressable onPress={() => router.push('/(tabs)/profile/member-rules' as never)}>
            <Text style={d.rulesLink}>会员规则</Text>
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
                  <Text style={d.perk}>{item.perks}</Text>
                </View>
                <View style={s.levelPoints}>
                  <Text style={d.oldPoints}>{item.price + 100}</Text>
                  <Text style={d.points}>{item.price}</Text>
                  <Text style={d.pointsUnit}>积分</Text>
                </View>
              </View>
              {isCurrent ? <Text style={d.currentBadge}>当前等级</Text> : null}
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
              ? '正在加载会员等级'
              : canUpgrade
                ? `确认兑换 ${selectedPlan.name}`
                : '请选择更高会员等级'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
