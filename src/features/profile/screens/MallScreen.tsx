import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { useNetworkStatus } from '@/hooks/use-network-status';
import { fetchMallSections, type MallProduct, type MallSection } from '@/services/api/mall';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const FALLBACK_SECTIONS: MallSection[] = [
  {
    id: 'cards',
    titleKey: 'profile.mall.sections.coupons',
    products: [
      { id: 'fancy-number-card', nameKey: 'profile.mall.items.fancyNumberCard', icon: 'sparkles-outline', color: '#2563EB', action: 'fancy-number' },
      { id: 'group-expansion-card', nameKey: 'profile.mall.items.groupExpansionCard', icon: 'people-outline', color: '#E11D48', action: 'group-expansion' },
      { id: 'generate-recharge-card', nameKey: 'profile.mall.items.generateRechargeCard', icon: 'card-outline', color: '#2563EB', action: 'recharge-card-create' },
      { id: 'my-recharge-cards', nameKey: 'profile.mall.items.myRechargeCards', icon: 'receipt-outline', color: '#2563EB', action: 'recharge-card-list' },
    ],
  },
  {
    id: 'membership',
    titleKey: 'profile.mall.sections.membership',
    products: [
      { id: 'membership-upgrade', nameKey: 'profile.mall.items.membershipRecharge', icon: 'diamond-outline', color: '#F59E0B', action: 'membership' },
      { id: 'experience-exchange', nameKey: 'profile.mall.items.exchangeExperience', icon: 'trending-up-outline', color: '#F59E0B', action: 'experience' },
      { id: 'points-recharge', nameKey: 'profile.mall.items.pointsRecharge', icon: 'wallet-outline', color: '#F59E0B', action: 'wallet' },
    ],
  },
  {
    id: 'fancy-number',
    titleKey: 'profile.mall.sections.fancyNumber',
    products: [
      { id: 'choose-fancy-number', nameKey: 'profile.mall.items.chooseFancyNumber', icon: 'ribbon-outline', color: '#E11D48', action: 'fancy-number' },
      { id: 'renew-fancy-number', nameKey: 'profile.mall.items.renewFancyNumber', icon: 'bookmark-outline', color: '#E11D48', action: 'fancy-number-renew' },
    ],
  },
  {
    id: 'points',
    titleKey: 'profile.mall.sections.points',
    products: [
      { id: 'redeem-code', nameKey: 'profile.mall.items.redeemCode', icon: 'server-outline', color: '#2563EB', action: 'redeem-code' },
      { id: 'buy-code', nameKey: 'profile.mall.items.buyCode', icon: 'bag-handle-outline', color: '#2563EB', action: 'buy-code' },
    ],
  },
  {
    id: 'decoration',
    titleKey: 'profile.mall.sections.decoration',
    products: [
      { id: 'avatar-frame', nameKey: 'profile.mall.items.avatarFrame', icon: 'image-outline', color: '#94A3B8', action: 'avatar-frame' },
    ],
  },
];

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  section: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  sectionMark: {
    width: 4,
    height: 24,
    borderRadius: 999,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.lg,
  },
  product: {
    width: 76,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function MallScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isOffline } = useNetworkStatus();
  const [sections, setSections] = useState<MallSection[]>(FALLBACK_SECTIONS);
  const [statusText, setStatusText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSections() {
      setStatusText(null);
      try {
        const nextSections = await fetchMallSections();
        if (!cancelled && nextSections.length > 0) {
          setSections(nextSections);
        }
      } catch {
        if (!cancelled) {
          setStatusText(
            t('profile.mall.loadError', {
              defaultValue: '商城商品加载失败，已显示本地商品目录',
            }),
          );
        }
      }
    }

    loadSections();

    return () => {
      cancelled = true;
    };
  }, [t]);

  function handleProductPress(product: MallProduct) {
    if (product.action === 'membership') {
      router.push('/(tabs)/profile/member-center' as never);
      return;
    }
    if (product.action === 'wallet') {
      router.push('/(tabs)/profile/wallet' as never);
    }
  }

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
      section: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      sectionMark: {
        backgroundColor: colors.blue,
      },
      sectionTitle: {
        color: colors.text,
        ...Typography.h2,
      },
      productText: {
        color: colors.text,
        ...Typography.caption,
        textAlign: 'center' as const,
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
      <NavHeader title={t('profile.mall.title', { defaultValue: '管家商城' })} />
      <ScrollView contentContainerStyle={[s.content, d.content]}>
        {isOffline ? (
          <Text style={d.status}>
            {t('common.offline', { defaultValue: '当前无网络连接，部分功能可能不可用' })}
          </Text>
        ) : null}
        {statusText ? <Text style={d.status}>{statusText}</Text> : null}
        {sections.map((section) => (
          <View key={section.id} style={[s.section, d.section]}>
            <View style={s.sectionTitleRow}>
              <View style={[s.sectionMark, d.sectionMark]} />
              <Text style={d.sectionTitle}>{t(section.titleKey)}</Text>
            </View>
            <View style={s.grid}>
              {section.products.map((product) => (
                <Pressable
                  key={product.id}
                  style={s.product}
                  onPress={() => handleProductPress(product)}
                >
                  <View style={[s.iconWrap, { backgroundColor: `${product.color}22` }]}>
                    <Ionicons name={product.icon as any} size={28} color={product.color} />
                  </View>
                  <Text style={d.productText}>{t(product.nameKey)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
