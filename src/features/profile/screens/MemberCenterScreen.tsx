import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import {
  MEMBERSHIP_BENEFITS,
  MEMBERSHIP_PLANS,
  getMembershipTierForVipLevel,
  type MembershipBenefitId,
  type MembershipBenefitValue,
  type MembershipTier,
} from '@/features/profile/membership-plans';
import { getUserProfileHref } from '@/features/user/utils/routes';
import { fetchCurrentUser } from '@/services/api/auth';
import { fetchMembershipProgramStatus } from '@/services/api/membership';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

function getMembershipSupportUserId(): string | undefined {
  return process.env.EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID?.trim() || undefined;
}

const DEFAULT_TIER_NAMES: Record<MembershipTier, string> = {
  silver: '白银会员',
  gold: '黄金会员',
  diamond: '钻石会员',
  super: '超级会员',
};

const DEFAULT_BENEFIT_LABELS: Record<MembershipBenefitId, string> = {
  'name-color': '名字颜色',
  badge: '会员徽章',
  'group-member-limit': '单群人数上限',
  'joined-groups': '可加入群聊',
  'note-storage': '笔记存储',
  'city-filters': '城市筛选',
  'fancy-number': '靓号赠送',
};

const DEFAULT_NAMED_BENEFIT_VALUES: Record<
  Exclude<MembershipBenefitValue, number | '999+'>,
  string
> = {
  unlimited: '不限',
  silver: '银色',
  gold: '金色',
  rainbow: '七彩',
  'exclusive-shimmer': '专属流光',
  diamond: '钻石',
  'super-lifetime': '超级永久',
  none: '无',
  'one-gift': '赠送 1 次',
  'one-premium-gift': '赠送高级靓号 1 次',
};

const TIER_ACCENTS: Omit<Record<MembershipTier, string>, 'super'> = {
  silver: '#64748B',
  gold: '#B7791F',
  diamond: '#2563EB',
};

function formatCountBenefit(
  benefitId: MembershipBenefitId,
  value: number,
): string {
  switch (benefitId) {
    case 'group-member-limit':
      return `${value} 人`;
    case 'joined-groups':
    case 'city-filters':
      return `${value} 个`;
    case 'note-storage':
      return `${value} 条`;
    default:
      return String(value);
  }
}

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  currentLabel: {
    textTransform: 'uppercase',
  },
  sectionHeader: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  tierList: {
    gap: Spacing.sm,
    paddingRight: Spacing.lg,
  },
  tierCard: {
    width: 172,
    minHeight: 184,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    padding: Spacing.md,
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  tierMarkerRow: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  tierMarker: {
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 2,
  },
  benefitsPanel: {
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  benefitRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  benefitText: {
    flex: 1,
    gap: 2,
  },
  contactSection: {
    gap: Spacing.sm,
  },
  marketingPanel: {
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  cta: {
    minHeight: 52,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
});

export default function MemberCenterScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const vipLevel = useAuthStore((state) => state.user?.vipLevel ?? 0);
  const currentTier = getMembershipTierForVipLevel(vipLevel);
  const currentPlan = currentTier
    ? MEMBERSHIP_PLANS.find((plan) => plan.tier === currentTier)
    : undefined;
  const currentPlanLevel = currentPlan?.level ?? 0;
  const [selectedTier, setSelectedTier] = useState<MembershipTier>(
    currentTier ?? 'diamond',
  );
  const [programEnabled, setProgramEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    setSelectedTier(currentTier ?? 'diamond');
  }, [currentTier]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const owner = useAuthStore.getState();
      const ownerUserId = owner.user?.id;
      const ownerAccountId = owner.user?.accountId;
      const ownerSessionEpoch = owner.sessionEpoch;

      void fetchMembershipProgramStatus()
        .then((status) => {
          if (active) setProgramEnabled(status.enabled);
        })
        .catch(() => {
          if (active) setProgramEnabled(false);
        });

      if (ownerUserId && ownerAccountId) {
        void fetchCurrentUser()
          .then((nextUser) => {
            if (!active) return;

            const latest = useAuthStore.getState();
            const ownsRequest =
              latest.sessionEpoch === ownerSessionEpoch &&
              latest.user?.id === ownerUserId &&
              latest.user?.accountId === ownerAccountId;
            const responseMatchesOwner =
              nextUser.id === ownerUserId && nextUser.accountId === ownerAccountId;

            if (ownsRequest && responseMatchesOwner && latest.user) {
              latest.setUser({
                ...latest.user,
                vipLevel: nextUser.vipLevel,
              });
            }
          })
          .catch(() => {
            if (active && typeof __DEV__ !== 'undefined' && __DEV__) {
              console.warn('[MemberCenterScreen] user refresh failed');
            }
          });
      }

      return () => {
        active = false;
      };
    }, []),
  );

  const selectedPlan =
    MEMBERSHIP_PLANS.find((plan) => plan.tier === selectedTier) ??
    MEMBERSHIP_PLANS[2];
  const selectedPlanName = t(selectedPlan.nameKey, {
    defaultValue: DEFAULT_TIER_NAMES[selectedPlan.tier],
  });
  const currentMembershipName = currentTier
    ? t(`profile.membership.tiers.${currentTier}.name`, {
        defaultValue: DEFAULT_TIER_NAMES[currentTier],
      })
    : t('profile.membership.regularUser', { defaultValue: '普通用户' });
  const isUpgrade = currentPlanLevel > 0 && selectedPlan.level > currentPlanLevel;
  const isCurrent = currentPlanLevel > 0 && selectedPlan.level === currentPlanLevel;
  const isLowerTier = currentPlanLevel > selectedPlan.level;

  const contactLabel = !currentTier
    ? t('profile.membership.contactToActivate', {
        defaultValue: '联系客服开通 {{plan}}',
        plan: selectedPlanName,
      })
    : isUpgrade
      ? t('profile.membership.contactToUpgrade', {
          defaultValue: '联系客服升级至 {{plan}}',
          plan: selectedPlanName,
        })
      : isCurrent
        ? t('profile.membership.contactForCurrent', {
            defaultValue: '当前已是 {{plan}}，联系客服咨询',
            plan: selectedPlanName,
          })
        : isLowerTier
          ? t('profile.membership.contactForLowerTier', {
              defaultValue: '当前会员等级更高，联系客服咨询',
            })
          : t('profile.membership.contactSupport', { defaultValue: '联系客服咨询' });

  const handleContactSupport = useCallback(() => {
    const membershipSupportUserId = getMembershipSupportUserId();
    if (membershipSupportUserId) {
      router.push(
        getUserProfileHref(
          'profile',
          membershipSupportUserId,
          t('profile.membership.supportName', { defaultValue: '官方客服' }),
        ),
      );
      return;
    }

    Alert.alert(
      t('profile.membership.supportUnavailableTitle', {
        defaultValue: '客服账号暂未配置',
      }),
      t('profile.membership.supportUnavailableMessage', {
        defaultValue: '请联系平台官方客服咨询会员开通或升级。',
      }),
    );
  }, [router, t]);

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
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      currentLabel: {
        color: colors.textSecondary,
        ...Typography.tiny,
      },
      currentMembership: {
        color: colors.text,
        ...Typography.h1,
      },
      heroText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      sectionTitle: {
        color: colors.text,
        ...Typography.h2,
        flexShrink: 1,
      },
      rulesLink: {
        color: colors.primary,
        ...Typography.caption,
        fontWeight: '700' as const,
        flexShrink: 1,
      },
      tierCard: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      tierCardSelected: {
        backgroundColor: colors.primaryLight,
      },
      tierMarker: {
        backgroundColor: colors.primary,
      },
      lifetimeMarker: {
        backgroundColor: colors.text,
      },
      tierMarkerText: {
        color: colors.white,
        ...Typography.tiny,
        fontWeight: '700' as const,
      },
      tierName: {
        color: colors.text,
        ...Typography.h3,
        flexShrink: 1,
      },
      duration: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      currency: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '700' as const,
      },
      price: {
        color: colors.text,
        fontSize: 28,
        fontWeight: '800' as const,
        fontVariant: ['tabular-nums'] as TextStyle['fontVariant'],
      },
      selectedHint: {
        color: colors.primary,
        ...Typography.small,
        fontWeight: '700' as const,
      },
      benefitsPanel: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      benefitDivider: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.divider,
      },
      benefitLabel: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      benefitValue: {
        color: colors.text,
        ...Typography.body,
      },
      upgradeNote: {
        color: colors.textSecondary,
        ...Typography.small,
        lineHeight: 18,
      },
      cta: {
        backgroundColor: colors.primary,
      },
      ctaText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '700' as const,
        textAlign: 'center' as const,
        flexShrink: 1,
      },
      tierAccents: {
        ...TIER_ACCENTS,
        super: colors.text,
      },
      marketingPanel: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      marketingTitle: {
        color: colors.text,
        ...Typography.h2,
      },
      marketingText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
    }),
    [colors, insets.bottom, insets.top],
  );

  return (
    <View style={d.container}>
      <NavHeader
        title={t('profile.membership.title', { defaultValue: '会员中心' })}
        rightIcon="help-circle-outline"
        rightAccessibilityLabel={t('profile.memberRules.link', {
          defaultValue: '会员规则',
        })}
        onRightPress={() => router.push('/(tabs)/profile/member-rules' as never)}
      />
      {programEnabled === null ? (
        <View style={s.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !programEnabled ? (
        <ScrollView
          contentContainerStyle={[s.content, d.content]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[s.marketingPanel, d.marketingPanel]}>
            <Text style={d.marketingTitle}>
              {t('profile.membership.marketing.title', {
                defaultValue: '会员功能暂未开放',
              })}
            </Text>
            <Text style={d.marketingText}>
              {t('profile.membership.marketing.goldAccess', {
                defaultValue: '当前所有用户免费享有黄金额度',
              })}
            </Text>
            <Text style={d.marketingText}>单群 400 人 · 可加入 300 个群</Text>
            <Text style={d.marketingText}>笔记 500 条 · 城市筛选 10 个</Text>
          </View>
        </ScrollView>
      ) : (
      <ScrollView
        contentContainerStyle={[s.content, d.content]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.hero, d.hero]}>
          <Text style={[s.currentLabel, d.currentLabel]}>
            {t('profile.membership.currentIdentity', { defaultValue: '当前身份' })}
          </Text>
          <Text style={d.currentMembership}>{currentMembershipName}</Text>
          <Text style={d.heroText}>
            {t('profile.membership.catalogHint', {
              defaultValue: '选择会员档位查看对应权益，开通和升级由客服协助处理。',
            })}
          </Text>
        </View>

        <View style={s.sectionHeader}>
          <Text style={d.sectionTitle}>
            {t('profile.membership.chooseTier', { defaultValue: '选择会员档位' })}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('profile.memberRules.link', {
              defaultValue: '会员规则',
            })}
            hitSlop={8}
            onPress={() => router.push('/(tabs)/profile/member-rules' as never)}
          >
            <Text style={d.rulesLink}>
              {t('profile.memberRules.link', { defaultValue: '会员规则' })}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          contentContainerStyle={s.tierList}
          showsHorizontalScrollIndicator={false}
        >
          {MEMBERSHIP_PLANS.map((plan) => {
            const selected = plan.tier === selectedPlan.tier;
            const planName = t(plan.nameKey, {
              defaultValue: DEFAULT_TIER_NAMES[plan.tier],
            });
            const duration =
              plan.duration.type === 'lifetime'
                ? t('profile.membership.duration.lifetime', { defaultValue: '永久' })
                : t('profile.membership.duration.months', {
                    defaultValue: '{{count}} 个月',
                    count: plan.duration.months,
                  });

            return (
              <Pressable
                key={plan.tier}
                accessibilityRole="button"
                accessibilityLabel={t('profile.membership.planAccessibilityLabel', {
                  defaultValue: '{{plan}}，{{duration}}，¥{{price}}',
                  plan: planName,
                  duration,
                  price: plan.price.amount,
                })}
                accessibilityState={{ selected }}
                style={[
                  s.tierCard,
                  d.tierCard,
                  selected && d.tierCardSelected,
                  selected && { borderColor: d.tierAccents[plan.tier] },
                ]}
                onPress={() => setSelectedTier(plan.tier)}
              >
                <View>
                  <View style={s.tierMarkerRow}>
                    {plan.recommended ? (
                      <View style={[s.tierMarker, d.tierMarker]}>
                        <Text style={d.tierMarkerText}>
                          {t('profile.membership.recommended', { defaultValue: '推荐' })}
                        </Text>
                      </View>
                    ) : null}
                    {plan.duration.type === 'lifetime' ? (
                      <View style={[s.tierMarker, d.lifetimeMarker]}>
                        <Text style={d.tierMarkerText}>
                          {t('profile.membership.lifetime', { defaultValue: '永久' })}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={d.tierName} numberOfLines={2}>
                    {planName}
                  </Text>
                  <Text style={d.duration}>{duration}</Text>
                </View>
                <View>
                  <View style={s.priceRow}>
                    <Text style={d.currency}>¥</Text>
                    <Text style={d.price} selectable>
                      {plan.price.amount}
                    </Text>
                  </View>
                  <Text style={d.selectedHint}>
                    {selected
                      ? t('profile.membership.selected', { defaultValue: '已选择' })
                      : ' '}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={d.sectionTitle}>
          {t('profile.membership.benefitsTitle', { defaultValue: '会员权益' })}
        </Text>
        <View style={[s.benefitsPanel, d.benefitsPanel]}>
          {MEMBERSHIP_BENEFITS.map((benefit, index) => {
            const value = benefit.values[selectedPlan.tier];
            const defaultValue =
              typeof value === 'number'
                ? formatCountBenefit(benefit.id, value)
                : DEFAULT_NAMED_BENEFIT_VALUES[value];
            const valueText =
              typeof value === 'number'
                ? t(`profile.membership.benefitValues.${benefit.id}`, {
                    defaultValue,
                    value,
                  })
                : t(`profile.membership.benefitValues.${value}`, { defaultValue });

            return (
              <View
                key={benefit.id}
                style={[
                  s.benefitRow,
                  index < MEMBERSHIP_BENEFITS.length - 1 && d.benefitDivider,
                ]}
              >
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={d.tierAccents[selectedPlan.tier]}
                />
                <View style={s.benefitText}>
                  <Text style={d.benefitLabel}>
                    {t(benefit.labelKey, {
                      defaultValue: DEFAULT_BENEFIT_LABELS[benefit.id],
                    })}
                  </Text>
                  <Text style={d.benefitValue} selectable>
                    {valueText}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={s.contactSection}>
          <Text style={d.upgradeNote}>
            {t('profile.membership.upgradeDifferenceNote', {
              defaultValue: '已开通会员可联系客服补差价升级，升级后立即生效，原会员剩余价值由客服核算抵扣。',
            })}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={contactLabel}
            style={[s.cta, d.cta]}
            onPress={handleContactSupport}
          >
            <Text style={d.ctaText}>{contactLabel}</Text>
          </Pressable>
        </View>
      </ScrollView>
      )}
    </View>
  );
}
