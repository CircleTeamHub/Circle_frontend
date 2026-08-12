import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type ImageSourcePropType,
  type TextStyle,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { GradientCover } from '@/components/ui/gradient-cover';
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
import { useAuthStore } from '@/stores/authStore';
import { useMembershipProgramStore } from '@/stores/membershipProgramStore';
import { useSupportConfigStore } from '@/stores/supportConfigStore';
import { selectSupportAgents } from '@/stores/support-config-selectors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';


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
  'joined-groups': '可加入圈子',
  'note-storage': '笔记存储',
  'city-filters': '城市筛选',
  'fancy-number': '靓号权益',
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
  permanent: '永久靓号',
};

// 每个 VIP 等级一套「贵金属」视觉：档位渐变 + 强调色 + 徽章。银 → 金 → 钻 → 曜黑（超级）。
const TIER_VISUALS: Record<
  MembershipTier,
  {
    gradient: readonly string[];
    accent: string;
    badge: ImageSourcePropType;
    // 各档徽章内容占比不一(super.png 正方填满、盾徽竖版偏窄),按此系数缩放到视觉齐平。
    badgeScale: number;
  }
> = {
  silver: {
    gradient: ['#8E96A6', '#C4CAD6', '#6B7383'],
    accent: '#5B6472',
    badge: require('../../../../assets/badges/vip1.png'),
    badgeScale: 1.3,
  },
  gold: {
    gradient: ['#E7B34D', '#F8E09A', '#BB811A'],
    accent: '#A9741A',
    badge: require('../../../../assets/badges/vip2.png'),
    badgeScale: 1.3,
  },
  diamond: {
    gradient: ['#57ADF6', '#9DD8FF', '#2E6DE0'],
    accent: '#2563EB',
    badge: require('../../../../assets/badges/vip5.png'),
    badgeScale: 1.18,
  },
  super: {
    gradient: ['#4C3C74', '#241D3E', '#0B0912'],
    accent: '#C9A24B',
    badge: require('../../../../assets/badges/super.png'),
    badgeScale: 0.92,
  },
};

// 未开通（普通用户）时的中性 hero 渐变（品牌紫）。
const NEUTRAL_HERO_GRADIENT = ['#5B4BE6', '#7C5CF0', '#A86BF0'] as const;

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
    paddingTop: Spacing.md,
    gap: Spacing.lg,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Hero（当前身份，随档位换渐变）──
  hero: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    minHeight: 132,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  heroBadgeRing: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroBadge: {
    width: 40,
    height: 40,
  },
  heroTextCol: {
    flex: 1,
    gap: 4,
  },
  heroEyebrow: {
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  heroNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  sectionHeader: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  // ── 档位纵向列表（四档全展示）──
  tierStack: {
    gap: Spacing.sm,
  },
  tierCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    padding: Spacing.md,
    minHeight: 76,
  },
  tierMedallion: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tierMedallionBadge: {
    width: 34,
    height: 34,
  },
  tierInfo: {
    flex: 1,
    gap: 4,
  },
  tierNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  tierMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  tierMarker: {
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing.sm - 2,
    paddingVertical: 2,
  },
  tierPriceCol: {
    alignItems: 'flex-end',
    gap: 4,
    minWidth: 58,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 1,
  },
  benefitsPanel: {
    borderRadius: Radius.md,
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
    borderRadius: Radius.md,
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
  const programStatus = useMembershipProgramStore((state) => state.status);
  const programError = useMembershipProgramStore((state) => state.error);
  const fetchProgramStatus = useMembershipProgramStore(
    (state) => state.fetchStatus,
  );
  const supportConfig = useSupportConfigStore((state) => state.config);
  const fetchSupportConfigState = useSupportConfigStore(
    (state) => state.fetchConfig,
  );
  const programEnabled =
    programStatus?.enabled ?? (programError ? false : null);
  // 测试期绕过灰度：dev 构建直接展示会员中心正文（当前身份 + 档位 + 权益），方便本地核对；
  // jest（JEST_WORKER_ID 存在）与生产仍遵循后端 programEnabled（保留 staged rollout 行为，
  // 也让 marketing 态可测）。
  const showMembershipProgram =
    __DEV__ && !process.env.JEST_WORKER_ID ? true : programEnabled;

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

      void fetchProgramStatus({ force: true });
      // 必须 force:这套配置存在的意义就是「管理台换了人立刻生效」。命中缓存的话,
      // 首次拉取(哪怕拉到的是空列表)会被整个进程生命周期沿用,用户要么一直看到
      // 旧客服、要么一直看到「暂未配置」,直到重启 App。
      void fetchSupportConfigState({ force: true });

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
    }, [fetchProgramStatus, fetchSupportConfigState]),
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

  // 首屏 config 还没到时这次点击要等网络,期间用户完全可以再点一次。store 的
  // inFlight 去重只合并请求、不合并 await 之后的续跑:两次点击都会各自 push 一次,
  // 用户回退时要连按两下才退得出去。ref 是同步的,setState 的异步性挡不住连点。
  const contactingRef = useRef(false);

  // 会员客服 = 后端 membership 类的首个客服(管理台维护、按 sortOrder 排序)。
  // 没配就仍然弹原来那条 Alert —— 优雅降级,不回退到任何默认账号。
  const handleContactSupport = useCallback(async () => {
    if (contactingRef.current) return;
    contactingRef.current = true;
    try {
      // 首屏 config 还是 null 时直接判空,会把一次正常的网络往返误报成「客服暂未配置」。
      // store 的 inFlight 去重保证这里是并入同一个请求,而不是再发一次。
      const config =
        supportConfig ?? (await fetchSupportConfigState({ force: true }));
      const [agent] = selectSupportAgents(config, 'membership');
      if (agent) {
        router.push(
          getUserProfileHref(
            'profile',
            agent.userID,
            agent.nickname ||
              t('profile.membership.supportName', { defaultValue: '官方客服' }),
          ),
        );
        return;
      }

      // config === null 只可能是这次没拉到(成功时哪怕五类全空也是对象)。
      // 把网络故障说成「客服暂未配置」会让用户以为平台没客服而放弃咨询。
      if (!config) {
        Alert.alert(
          t('profile.customerService.loadFailed', {
            defaultValue: '客服信息加载失败',
          }),
          t('common.networkError'),
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
    } finally {
      contactingRef.current = false;
    }
  }, [fetchSupportConfigState, router, supportConfig, t]);

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
      heroEyebrow: {
        color: 'rgba(255,255,255,0.75)',
        ...Typography.tiny,
        fontWeight: '700' as const,
      },
      heroName: {
        color: '#FFFFFF',
        ...Typography.h1,
      },
      heroHint: {
        color: 'rgba(255,255,255,0.82)',
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
        ...Typography.caption,
        fontWeight: '700' as const,
      },
      price: {
        color: colors.text,
        fontSize: 20,
        fontWeight: '800' as const,
        fontVariant: ['tabular-nums'] as TextStyle['fontVariant'],
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
      {showMembershipProgram === null ? (
        <View style={s.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !showMembershipProgram ? (
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
            <Text style={d.marketingText}>
              {t('profile.membership.marketing.groupQuota', {
                defaultValue: '单群 400 人 · 最多加入 300 个群',
              })}
            </Text>
            <Text style={d.marketingText}>
              {t('profile.membership.marketing.noteQuota', {
                defaultValue: '笔记 500 条 · 城市筛选 10 个',
              })}
            </Text>
          </View>
        </ScrollView>
      ) : (
      <ScrollView
        contentContainerStyle={[s.content, d.content]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero：随当前档位换「贵金属」渐变；普通用户用品牌紫中性渐变 */}
        <View style={s.hero}>
          <GradientCover
            colors={
              currentTier
                ? TIER_VISUALS[currentTier].gradient
                : NEUTRAL_HERO_GRADIENT
            }
          />
          <View style={s.heroTopRow}>
            <View
              style={[
                s.heroBadgeRing,
                { backgroundColor: 'rgba(255,255,255,0.18)' },
              ]}
            >
              {currentTier ? (
                <Image
                  source={TIER_VISUALS[currentTier].badge}
                  style={[
                    s.heroBadge,
                    { transform: [{ scale: TIER_VISUALS[currentTier].badgeScale }] },
                  ]}
                  contentFit="contain"
                />
              ) : (
                <Ionicons name="sparkles" size={26} color="#FFFFFF" />
              )}
            </View>
            <View style={s.heroTextCol}>
              <Text style={[s.heroEyebrow, d.heroEyebrow]}>
                {t('profile.membership.currentIdentity', {
                  defaultValue: '当前身份',
                })}
              </Text>
              <View style={s.heroNameRow}>
                <Text style={d.heroName}>{currentMembershipName}</Text>
              </View>
            </View>
          </View>
          <Text style={d.heroHint}>
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

        {/* 四档纵向全展示；每档一枚随材质换渐变的奖章 + 强调色 */}
        <View style={s.tierStack}>
          {MEMBERSHIP_PLANS.map((plan) => {
            const selected = plan.tier === selectedPlan.tier;
            const isCurrentTier = plan.tier === currentTier;
            const visual = TIER_VISUALS[plan.tier];
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
                  selected && { borderColor: visual.accent, borderWidth: 2 },
                ]}
                onPress={() => setSelectedTier(plan.tier)}
              >
                <View style={s.tierMedallion}>
                  <GradientCover colors={visual.gradient} />
                  <Image
                    source={visual.badge}
                    style={[
                      s.tierMedallionBadge,
                      { transform: [{ scale: visual.badgeScale }] },
                    ]}
                    contentFit="contain"
                  />
                </View>
                <View style={s.tierInfo}>
                  <View style={s.tierNameRow}>
                    <Text style={d.tierName} numberOfLines={2}>
                      {planName}
                    </Text>
                    {isCurrentTier ? (
                      <View
                        style={[s.tierMarker, { backgroundColor: visual.accent }]}
                      >
                        <Text style={d.tierMarkerText}>
                          {t('profile.membership.currentTierBadge', {
                            defaultValue: '当前',
                          })}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={s.tierMetaRow}>
                    {plan.recommended ? (
                      <View style={[s.tierMarker, d.tierMarker]}>
                        <Text style={d.tierMarkerText}>
                          {t('profile.membership.recommended', {
                            defaultValue: '推荐',
                          })}
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
                    <Text style={d.duration}>{duration}</Text>
                  </View>
                </View>
                <View style={s.tierPriceCol}>
                  <View style={s.priceRow}>
                    <Text style={d.currency}>¥</Text>
                    <Text style={d.price} selectable>
                      {plan.price.amount}
                    </Text>
                  </View>
                  {selected ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={visual.accent}
                    />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>

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
                  color={TIER_VISUALS[selectedPlan.tier].accent}
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
            onPress={() => {
              void handleContactSupport();
            }}
          >
            <Text style={d.ctaText}>{contactLabel}</Text>
          </Pressable>
        </View>
      </ScrollView>
      )}
    </View>
  );
}
