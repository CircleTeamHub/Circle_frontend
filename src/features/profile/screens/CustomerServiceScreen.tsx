import { useCallback, useMemo, useRef } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { NavHeader } from '@/components/ui/nav-header';
import { MenuRow } from '@/components/ui/menu-row';
import { Divider } from '@/components/ui/divider';
import { Spacing, Typography, useTheme } from '@/theme';
import { reportError } from '@/observability/sentry';
import { shouldOpenChatPreview } from '@/features/chat/chat-preview';
import { getChatDetailHref } from '@/features/user/utils/routes';
import { getOrCreateSingleConversation } from '@/im/client';
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

  // ref 守卫同步生效，避免连点两类客服触发两次会话解析 / 两次入栈。
  const openingRef = useRef(false);

  // 屏幕失焦/离场后丢弃迟到的会话解析结果：会话解析可能较慢，若用户在解析完成前退出客服
  // 中心或跳去别处（甚至离开又回来），不应再把聊天页推入栈。用**单调递增的 focus 代次**而非
  // 布尔守卫——布尔在重新聚焦后又变回 true，会让「离开→回来」期间的迟到解析误判为仍在当次。
  const focusGenerationRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      focusGenerationRef.current += 1;
      return () => {};
    }, []),
  );

  const handleOpenCategory = useCallback(
    async (category: SupportCategory) => {
      if (openingRef.current) return;
      openingRef.current = true;
      // 捕获本次请求发起时的 focus 代次；完成时精确比对，离场（哪怕又回来）都算过期、丢弃。
      const requestGeneration = focusGenerationRef.current;
      const isStale = () => focusGenerationRef.current !== requestGeneration;
      // 会话标题用该类客服名（如「充值客服」），客服侧一眼看清用户走的是哪个入口。
      const title = t(category.labelKey);
      try {
        const conversation = await getOrCreateSingleConversation(
          category.accountId,
        );
        // 解析期间用户已离场（或离开又回来）：丢弃结果，不再跳转。
        if (isStale()) return;
        router.push(
          getChatDetailHref(
            'profile',
            category.accountId,
            title,
            undefined,
            conversation.conversationID,
          ),
        );
      } catch (error) {
        // 解析期间用户已离场（或离开又回来）：不再弹窗、不再跳转。
        if (isStale()) return;
        // IM 未接通 / 客服账号尚未建立好友关系等：仍以预览模式进入，保证入口始终可点开。
        if (shouldOpenChatPreview(error)) {
          router.push(getChatDetailHref('profile', category.accountId, title));
          return;
        }
        // 不把原始 SDK/OpenIM 错误文案直接展示给用户——可能含未本地化的实现/端点细节。
        // 只给通用可读提示;结构化上下文另经 reportError 上报(Sentry 侧已脱敏)。
        reportError(error, {
          operation: 'customerService',
          kind: 'openConversation',
          category: category.id,
        });
        Alert.alert(
          t('profile.customerService.openFailed'),
          t('common.networkError'),
        );
      } finally {
        openingRef.current = false;
      }
    },
    [router, t],
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
