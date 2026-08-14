import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { FEATURE_FLAGS } from '@/constants/feature-flags';
import { useNetworkStatus } from '@/hooks/use-network-status';
import {
  fetchMallSections,
  FALLBACK_SECTIONS,
  type MallProduct,
  type MallSection,
} from '@/services/api/mall';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

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
  const visibleSections = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          products: section.products.filter((product) => {
            if (
              !FEATURE_FLAGS.avatarFrames &&
              product.action === 'avatar-frame'
            ) {
              return false;
            }
            if (
              !FEATURE_FLAGS.fancyNumbers &&
              (product.action === 'fancy-number' ||
                product.action === 'fancy-number-renew')
            ) {
              return false;
            }
            return true;
          }),
        }))
        .filter((section) => section.products.length > 0),
    [sections],
  );

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
    if (product.action === 'avatar-frame') {
      router.push('/(tabs)/profile/avatar-frames' as never);
      return;
    }
    if (product.action === 'fancy-number') {
      router.push('/(tabs)/profile/fancy-number' as never);
      return;
    }
    if (product.action === 'fancy-number-renew') {
      router.push({
        pathname: '/(tabs)/profile/fancy-number',
        params: { mode: 'renew' },
      } as never);
      return;
    }
    if (product.action === 'group-expansion') {
      router.push('/(tabs)/profile/group-expansion' as never);
      return;
    }
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
      <NavHeader title={t('profile.mall.title', { defaultValue: '商城' })} />
      <ScrollView contentContainerStyle={[s.content, d.content]}>
        {isOffline ? (
          <Text style={d.status}>
            {t('common.offline', { defaultValue: '当前无网络连接，部分功能可能不可用' })}
          </Text>
        ) : null}
        {statusText ? <Text style={d.status}>{statusText}</Text> : null}
        {visibleSections.map((section) => (
          <View key={section.id} style={[s.section, d.section]}>
            <View style={s.sectionTitleRow}>
              <View style={[s.sectionMark, d.sectionMark]} />
              <Text style={d.sectionTitle}>
                {t(section.titleKey, { defaultValue: section.defaultTitle })}
              </Text>
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
                  <Text style={d.productText}>
                    {t(product.nameKey, { defaultValue: product.defaultName })}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
