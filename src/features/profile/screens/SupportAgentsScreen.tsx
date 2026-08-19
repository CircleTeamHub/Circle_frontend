import { useCallback, useMemo, useRef } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { reportError } from '@/observability/sentry';
import { getChatDetailHref } from '@/features/user/utils/routes';
import { ensureDirectConversation } from '@/chat-core/client';
import { getSupportCategory } from '@/features/profile/support-categories';
import { Avatar } from '@/components/ui/avatar';
import { useSupportConfigStore } from '@/stores/supportConfigStore';
import { selectSupportAgents } from '@/stores/support-config-selectors';
import type { SupportAgent } from '@/services/api/support';

const AVATAR_SIZE = 48;

/** 列表项 = 后端下发的客服 + 它在本类中的序号（多客服且无昵称时用于编号显示）。 */
type SupportAgentRow = SupportAgent & { index: number };

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
  retry: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
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

  // 客服账号由后端下发(管理台维护),不再是编译期常量。
  const config = useSupportConfigStore((state) => state.config);
  const loading = useSupportConfigStore((state) => state.loading);
  const error = useSupportConfigStore((state) => state.error);
  const fetchConfig = useSupportConfigStore((state) => state.fetchConfig);

  const agents = useMemo<SupportAgentRow[]>(
    () =>
      (category
        ? selectSupportAgents(config, category.id)
        : []
      ).map((agent, index) => ({ ...agent, index })),
    [category, config],
  );
  const multiple = agents.length > 1;
  // 后端带了真实昵称就用真实昵称;没有(理论上不会,nickname 非空)才回落到
  // 通用名称,多客服时编号以免几行长得一模一样。
  const agentName = useCallback(
    (agent: SupportAgentRow) => {
      if (agent.nickname.trim()) return agent.nickname;
      return multiple
        ? t('profile.customerService.agentIndexedName', {
            index: agent.index + 1,
          })
        : t('profile.customerService.agentFallbackName');
    },
    [multiple, t],
  );

  // 与客服中心同款守卫：ref 同步防连点双开会话；单调递增的 focus 代次让离场（哪怕又回来）
  // 期间迟到的会话解析结果判为过期、丢弃，不从非活跃屏幕误把聊天页推入栈。
  const openingRef = useRef(false);
  const focusGenerationRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      focusGenerationRef.current += 1;
      // 每次进入都重拉:管理台换了客服之后,用户不该需要重启 App 才看到。
      // store 的 inFlight 去重保证并发进入只发一次请求。
      void fetchConfig({ force: true });
      return () => {
        focusGenerationRef.current += 1;
      };
    }, [fetchConfig]),
  );

  const handleOpenAgent = useCallback(
    async (agent: SupportAgentRow) => {
      if (openingRef.current) return;
      openingRef.current = true;
      const requestGeneration = focusGenerationRef.current;
      const isStale = () => focusGenerationRef.current !== requestGeneration;
      const chatTitle = agentName(agent);
      try {
        const conversation = await ensureDirectConversation(agent.userID);
        if (isStale()) return;
        router.push(
          getChatDetailHref(
            'profile',
            agent.userID,
            chatTitle,
            undefined,
            conversation.conversationID,
          ),
        );
      } catch (error) {
        if (isStale()) return;        // 不把原始 SDK/OpenIM 错误文案直接展示给用户；结构化上下文经 reportError 上报。
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
      retryButton: { borderColor: colors.primary },
      retryText: {
        color: colors.primary,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  const renderAgent = useCallback(
    ({ item, index }: { item: SupportAgentRow; index: number }) => (
      <View>
        <Pressable
          style={s.row}
          onPress={() => {
            void handleOpenAgent(item);
          }}
        >
          {item.avatarUrl ? (
            <Avatar size={AVATAR_SIZE} uri={item.avatarUrl} name={item.nickname} />
          ) : (
            // 没设头像的客服账号仍用耳麦徽章,而不是昵称首字母 —— 这一屏里
            // 「这是客服」比「这是谁」更重要。
            <View style={[s.avatar, d.avatar]}>
              <Ionicons name="headset" size={AVATAR_SIZE * 0.5} color={colors.white} />
            </View>
          )}
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
          {/* 首次加载时先不喊「暂无客服」——那会在一次正常的网络往返里闪一下误导文案。 */}
          {loading && !config ? (
            <Text style={d.empty}>
              {t('common.loading', { defaultValue: '加载中…' })}
            </Text>
          ) : error && !config ? (
            // 拉取失败 ≠ 后端没配客服。前者告诉用户「没有客服」会让他直接放弃咨询,
            // 而且他手上没有任何可操作的下一步 —— 所以这里给网络文案 + 重试按钮。
            <>
              <Text style={d.empty}>
                {t('profile.customerService.loadFailed', {
                  defaultValue: '客服信息加载失败',
                })}
              </Text>
              <Text style={d.empty}>{t('common.networkError')}</Text>
              <Pressable
                accessibilityRole="button"
                style={[s.retry, d.retryButton]}
                onPress={() => {
                  void fetchConfig({ force: true });
                }}
              >
                <Text style={d.retryText}>{t('common.retry')}</Text>
              </Pressable>
            </>
          ) : (
            <Text style={d.empty}>{t('profile.customerService.empty')}</Text>
          )}
        </View>
      ) : (
        <FlatList
          data={agents}
          keyExtractor={(item) => item.userID}
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
