import { useCallback, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { NavHeader } from '@/components/ui/nav-header';
import { MenuRow } from '@/components/ui/menu-row';
import { Divider } from '@/components/ui/divider';
import { Spacing, Typography, useTheme } from '@/theme';
import {
  SUPPORT_CATEGORIES,
  type SupportCategory,
} from '@/features/profile/support-categories';

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg },
  intro: { paddingVertical: Spacing.md },
});

export default function CustomerServiceScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();

  // 同步守卫防连点：跳转是同步的，双击同一行不应压两次栈。返回本页（重新聚焦）时解锁。
  const navigatingRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false;
    }, []),
  );

  const handleOpenCategory = useCallback(
    (category: SupportCategory) => {
      if (navigatingRef.current) return;
      navigatingRef.current = true;
      // 点类型进入「客服头像页」：展示该类型下的客服（头像+会员框），点头像再发起会话。
      router.push({
        pathname: '/(tabs)/profile/support-agents',
        params: { category: category.id },
      });
    },
    [router],
  );

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      intro: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        lineHeight: 21,
      },
    }),
    [colors],
  );

  const renderCategory = useCallback(
    ({ item, index }: { item: SupportCategory; index: number }) => (
      <View>
        <MenuRow
          icon={item.icon as keyof typeof Ionicons.glyphMap}
          label={t(item.labelKey)}
          subtitle={t(item.descriptionKey)}
          onPress={() => handleOpenCategory(item)}
        />
        {index < SUPPORT_CATEGORIES.length - 1 ? <Divider /> : null}
      </View>
    ),
    [handleOpenCategory, t],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('profile.customerService.title')} />
      <FlatList
        data={SUPPORT_CATEGORIES}
        keyExtractor={(item) => item.id}
        renderItem={renderCategory}
        ListHeaderComponent={
          <Text style={[s.intro, d.intro]}>
            {t('profile.customerService.subtitle')}
          </Text>
        }
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
