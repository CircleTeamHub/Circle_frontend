import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { fetchMallSections, type MallProduct, type MallSection } from '@/services/api/mall';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const FALLBACK_SECTIONS: MallSection[] = [
  {
    id: 'cards',
    title: '我的卡券',
    products: [
      { id: 'fancy-number-card', name: '靓号卡', icon: 'sparkles-outline', color: '#2563EB', action: 'fancy-number' },
      { id: 'group-expansion-card', name: '群扩容卡', icon: 'people-outline', color: '#E11D48', action: 'group-expansion' },
      { id: 'generate-recharge-card', name: '生成充值卡', icon: 'card-outline', color: '#2563EB', action: 'recharge-card-create' },
      { id: 'my-recharge-cards', name: '我的充值卡', icon: 'receipt-outline', color: '#2563EB', action: 'recharge-card-list' },
    ],
  },
  {
    id: 'membership',
    title: '会员专区',
    products: [
      { id: 'membership-upgrade', name: '会员充值', icon: 'diamond-outline', color: '#F59E0B', action: 'membership' },
      { id: 'experience-exchange', name: '兑换经验', icon: 'trending-up-outline', color: '#F59E0B', action: 'experience' },
      { id: 'points-recharge', name: '积分充值', icon: 'wallet-outline', color: '#F59E0B', action: 'wallet' },
    ],
  },
  {
    id: 'fancy-number',
    title: '靓号专区',
    products: [
      { id: 'choose-fancy-number', name: '自选靓号', icon: 'ribbon-outline', color: '#E11D48', action: 'fancy-number' },
      { id: 'renew-fancy-number', name: '续费靓号', icon: 'bookmark-outline', color: '#E11D48', action: 'fancy-number-renew' },
    ],
  },
  {
    id: 'points',
    title: '积分专区',
    products: [
      { id: 'redeem-code', name: '查询&兑换卡密', icon: 'server-outline', color: '#2563EB', action: 'redeem-code' },
      { id: 'buy-code', name: '购买卡密', icon: 'bag-handle-outline', color: '#2563EB', action: 'buy-code' },
    ],
  },
  {
    id: 'decoration',
    title: '装扮专区',
    products: [
      { id: 'avatar-frame', name: '头像框', icon: 'image-outline', color: '#94A3B8', action: 'avatar-frame' },
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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
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
          setStatusText('商城商品加载失败，已显示本地商品目录');
        }
      }
    }

    loadSections();

    return () => {
      cancelled = true;
    };
  }, []);

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
      <NavHeader title="管家商城" />
      <ScrollView contentContainerStyle={[s.content, d.content]}>
        {statusText ? <Text style={d.status}>{statusText}</Text> : null}
        {sections.map((section) => (
          <View key={section.title} style={[s.section, d.section]}>
            <View style={s.sectionTitleRow}>
              <View style={[s.sectionMark, d.sectionMark]} />
              <Text style={d.sectionTitle}>{section.title}</Text>
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
                  <Text style={d.productText}>{product.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
