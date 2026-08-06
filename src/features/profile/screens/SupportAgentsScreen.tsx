import { useCallback, useMemo, useRef } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { Spacing, Typography, useTheme } from '@/theme';
import { reportError } from '@/observability/sentry';
import { shouldOpenChatPreview } from '@/features/chat/chat-preview';
import { getChatDetailHref } from '@/features/user/utils/routes';
import { ensureDirectConversation } from '@/chat-core/client';
import { getSupportCategory } from '@/features/profile/support-categories';

const AVATAR_SIZE = 48;

interface SupportAgent {
  /** 原始账号 ID，用于发起单聊与列表 key。 */
  id: string;
  /** 在该类型中的序号（多客服时用于编号显示）。 */
  index: number;
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg },
  intro: { paddingVertical: Spacing.md },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
});

export default function SupportAgentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ category?: string }>();

  const category = getSupportCategory(
    typeof params.category === 'string' ? params.category : undefined,
  );
  const title = category
    ? t(category.labelKey)
    : t('profile.customerService.title');

  // 客服统一头像：不逐个拉账号真实头像/昵称/框——同类里的多个客服只是路由到不同的
  // OpenIM 账号，展示上用同一个客服头像（耳麦徽章）+ 名称（单个「在线客服」，多个则编号）。
  const agents = useMemo<SupportAgent[]>(
    () => (category?.accountIds ?? []).map((id, index) => ({ id, index })),
    [category?.accountIds],
  );
  const multiple = agents.length > 1;
  const agentName = useCallback(
    (agent: SupportAgent) =>
      multiple
        ? t('profile.customerService.agentIndexedName', {
            index: agent.index + 1,
          })
        : t('profile.customerService.agentFallbackName'),
    [multiple, t],
  );

  // 与客服中心同款守卫：ref 同步防连点双开会话；单调递增的 focus 代次让离场（哪怕又回来）
  // 期间迟到的会话解析结果判为过期、丢弃，不从非活跃屏幕误把聊天页推入栈。
  const openingRef = useRef(false);
  const focusGenerationRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      focusGenerationRef.current += 1;
      return () => {
        focusGenerationRef.current += 1;
      };
    }, []),
  );

  const handleOpenAgent = useCallback(
    async (agent: SupportAgent) => {
      if (openingRef.current) return;
      openingRef.current = true;
      const requestGeneration = focusGenerationRef.current;
      const isStale = () => focusGenerationRef.current !== requestGeneration;
      const chatTitle = agentName(agent);
      try {
        const conversation = await ensureDirectConversation(agent.id);
        if (isStale()) return;
        router.push(
          getChatDetailHref(
            'profile',
            agent.id,
            chatTitle,
            undefined,
            conversation.conversationID,
          ),
        );
      } catch (error) {
        if (isStale()) return;
        // IM 未接通 / 尚未建立好友关系等：仍以预览模式进入，保证入口始终可点开。
        if (shouldOpenChatPreview(error)) {
          router.push(getChatDetailHref('profile', agent.id, chatTitle));
          return;
        }
        // 不把原始 SDK/OpenIM 错误文案直接展示给用户；结构化上下文经 reportError 上报。
        reportError(error, {
          operation: 'customerService',
          kind: 'openAgentConversation',
          category: category?.id,
          agentIndex: agent.index,
        });
        Alert.alert(
          t('profile.customerService.openFailed'),
          t('common.networkError'),
        );
      } finally {
        openingRef.current = false;
      }
    },
    [agentName, category?.id, router, t],
  );

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      intro: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        lineHeight: 21,
      },
      avatar: { backgroundColor: colors.primary },
      name: { color: colors.text, ...Typography.body, fontWeight: '600' as const },
      hint: { color: colors.textSecondary, ...Typography.small },
      empty: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        textAlign: 'center' as const,
        lineHeight: 21,
      },
    }),
    [colors],
  );

  const renderAgent = useCallback(
    ({ item, index }: { item: SupportAgent; index: number }) => (
      <View>
        <Pressable
          style={s.row}
          onPress={() => {
            void handleOpenAgent(item);
          }}
        >
          <View style={[s.avatar, d.avatar]}>
            <Ionicons name="headset" size={AVATAR_SIZE * 0.5} color={colors.white} />
          </View>
          <View style={s.rowText}>
            <Text style={d.name} numberOfLines={1}>
              {agentName(item)}
            </Text>
            <Text style={d.hint} numberOfLines={1}>
              {t('profile.customerService.agentTapHint')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
        {index < agents.length - 1 ? <Divider /> : null}
      </View>
    ),
    [agentName, agents.length, colors.textSecondary, colors.white, d, handleOpenAgent, t],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={title} />
      {agents.length === 0 ? (
        <View style={s.center}>
          <Text style={d.empty}>{t('profile.customerService.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={agents}
          keyExtractor={(item) => item.id}
          renderItem={renderAgent}
          ListHeaderComponent={
            <Text style={[s.intro, d.intro]}>
              {t('profile.customerService.agentsSubtitle')}
            </Text>
          }
          contentContainerStyle={[
            s.content,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}
