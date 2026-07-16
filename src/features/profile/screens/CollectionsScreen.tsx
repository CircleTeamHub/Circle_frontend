import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { getCollectedOpenIMMessagePayload } from '@/features/chat/utils/message-collection';
import {
  getChatDetailHref,
  getUserProfileHref,
} from '@/features/user/utils/routes';
import { useNetworkStatus } from '@/hooks/use-network-status';
import {
  deleteCollection,
  fetchCollections,
  type CollectionType,
  type UserCollection,
} from '@/services/api/collections';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { ConversationType } from '@/types';

// 'ALL' 是「全部」伪类型：不按类型过滤，拉取所有收藏。其余对应后端 CollectionType。
// NOTE 不再展示：收藏笔记已改为直接复制进「我的笔记」（collectNote）。
type CollectionTab = 'ALL' | Exclude<CollectionType, 'NOTE'>;

const COLLECTION_TYPES: { id: CollectionTab; labelKey: string; icon: string }[] = [
  { id: 'ALL', labelKey: 'profile.collections.tabs.all', icon: 'albums-outline' },
  { id: 'CHAT', labelKey: 'profile.collections.tabs.chat', icon: 'chatbubble-ellipses-outline' },
  { id: 'VIDEO', labelKey: 'profile.collections.tabs.video', icon: 'videocam-outline' },
  { id: 'VOICE', labelKey: 'profile.collections.tabs.voice', icon: 'mic-outline' },
  { id: 'MESSAGE', labelKey: 'profile.collections.tabs.message', icon: 'mail-outline' },
];

type CollectionSource = {
  messageID: string;
  conversationID: string;
  conversationTitle: string;
  sourceID?: string;
  conversationType?: ConversationType;
  senderID?: string;
  senderName?: string;
  time?: string;
};

function inferSourceFromConversationID(conversationID: string) {
  if (conversationID.startsWith('sg_')) {
    return {
      sourceID: conversationID.slice(3),
      conversationType: 'group' as const,
    };
  }
  return {
    sourceID: undefined,
    conversationType: undefined,
  };
}

function resolveCollectionSource(item: UserCollection, t: TFunction): CollectionSource | null {
  const payload = getCollectedOpenIMMessagePayload(item.payload);
  if (!payload?.messageID || !payload.conversationID) return null;
  const inferred = inferSourceFromConversationID(payload.conversationID);
  return {
    messageID: payload.messageID,
    conversationID: payload.conversationID,
    conversationTitle:
      payload.conversationTitle ||
      t('profile.collections.conversationFallback', { defaultValue: '聊天' }),
    sourceID: payload.sourceID || inferred.sourceID,
    conversationType: payload.conversationType || inferred.conversationType,
    senderID: payload.senderID,
    senderName: payload.senderName,
    time: payload.time,
  };
}

function formatCollectionSource(source: CollectionSource, t: TFunction) {
  return [
    t('profile.collections.fromSource', {
      defaultValue: '来自 {{title}}',
      title: source.conversationTitle,
    }),
    source.senderName,
    source.time,
  ]
    .filter(Boolean)
    .join(' · ');
}

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
  },
  // 头部各块之间的间距（原先由 content 的 gap 提供）；末尾的 lg 隔开首个列表项。
  listHeader: {
    gap: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  // 列表项之间比头部更紧（原 s.list 的 gap）。
  separator: {
    height: Spacing.sm,
  },
  tabsRow: {
    position: 'relative',
  },
  tabs: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingRight: Spacing.lg,
  },
  tabsHint: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 2,
  },
  tab: {
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  empty: {
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  itemCard: {
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  itemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  itemText: {
    flex: 1,
    gap: Spacing.xs,
  },
  sourceRow: {
    marginTop: Spacing.xs,
  },
  sourceActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  sourceAction: {
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
});

// 模块级：引用稳定，不会每次渲染都让 FlatList 重建分隔件。
function ItemSeparator() {
  return <View style={s.separator} />;
}

export default function CollectionsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isOffline } = useNetworkStatus();
  const [activeType, setActiveType] = useState<CollectionTab>('ALL');
  const [items, setItems] = useState<UserCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState<string | null>(null);
  // 标签横向可滚动时，在右侧显示「更多」箭头提示；滚到末尾自动隐藏。
  const [showTabsHint, setShowTabsHint] = useState(false);
  const tabsViewportWidth = useRef(0);
  const tabsContentWidth = useRef(0);
  const active = COLLECTION_TYPES.find((item) => item.id === activeType) ?? COLLECTION_TYPES[0];

  // 内容比视口宽 → 有可滚动空间 → 显示提示。onLayout 与 onContentSizeChange 触发顺序
  // 不定，都走这里用 ref 重算，避免某次事件时另一个尺寸还是 0 导致误判。
  const recomputeTabsHint = useCallback(() => {
    setShowTabsHint(tabsContentWidth.current > tabsViewportWidth.current + 8);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCollections() {
      setLoading(true);
      setStatusText(null);
      try {
        const nextItems = await fetchCollections(
          activeType === 'ALL' ? undefined : activeType,
        );
        if (!cancelled) {
          // 历史遗留的 NOTE 收藏不再展示（笔记收藏已迁到「我的笔记」）。
          setItems(nextItems.filter((item) => item.type !== 'NOTE'));
        }
      } catch {
        if (!cancelled) {
          setStatusText(
            t('profile.collections.loadError', {
              defaultValue: '收藏加载失败，请稍后重试',
            }),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadCollections();

    return () => {
      cancelled = true;
    };
  }, [activeType, t]);

  // useCallback：作为 prop 传进列表行，引用稳定 renderItem 的 memo 才有意义。
  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert(
        t('profile.collections.deleteTitle', { defaultValue: '确认删除' }),
        t('profile.collections.deleteConfirm', { defaultValue: '确定要删除这条收藏吗？' }),
        [
          { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
          {
            text: t('common.delete', { defaultValue: '删除' }),
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteCollection(id);
                setItems((current) => current.filter((item) => item.id !== id));
              } catch {
                setStatusText(
                  t('profile.collections.deleteError', {
                    defaultValue: '删除收藏失败，请稍后重试',
                  }),
                );
              }
            },
          },
        ],
      );
    },
    [t],
  );

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
      tab: {
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.surface,
      },
      tabsHint: {
        // 用页面背景色遮住最右侧标签的边缘，形成「淡出 + 箭头」的可滚动提示。
        backgroundColor: colors.background,
      },
      tabActive: {
        borderColor: colors.primary,
        backgroundColor: colors.primary,
      },
      tabText: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      tabTextActive: {
        color: colors.white,
        fontWeight: '700' as const,
      },
      empty: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
      },
      emptyTitle: {
        color: colors.text,
        ...Typography.h2,
      },
      exampleCard: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
      },
      exampleDesc: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      itemTitle: {
        color: colors.text,
        ...Typography.body,
      },
      itemDesc: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      deleteText: {
        color: colors.error,
        ...Typography.caption,
        fontWeight: '700' as const,
      },
      sourceAction: {
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.background,
      },
      sourceActionText: {
        color: colors.text,
        ...Typography.caption,
        fontWeight: '700' as const,
      },
    }),
    [colors, insets.bottom, insets.top],
  );

  const openSourceMessage = useCallback((source: CollectionSource) => {
    if (!source.sourceID || !source.conversationType) return;
    router.push(
      getChatDetailHref(
        'profile',
        source.sourceID,
        source.conversationTitle,
        undefined,
        source.conversationID,
        source.messageID,
        source.conversationType,
      ),
    );
  }, []);

  const openSenderProfile = useCallback((source: CollectionSource) => {
    if (!source.senderID) return;
    router.push(getUserProfileHref('profile', source.senderID, source.senderName));
  }, []);

  const renderSource = useCallback(
    (source: CollectionSource | null) => {
      if (!source) return null;
      const canOpenMessage = Boolean(source.sourceID && source.conversationType);
      return (
        <View style={s.sourceRow}>
          <Text style={d.itemDesc}>{formatCollectionSource(source, t)}</Text>
          <View style={s.sourceActions}>
            {canOpenMessage ? (
              <Pressable
                style={[s.sourceAction, d.sourceAction]}
                onPress={(event) => {
                  event.stopPropagation();
                  openSourceMessage(source);
                }}
              >
                <Ionicons name="navigate-outline" size={13} color={colors.text} />
                <Text style={d.sourceActionText}>
                  {t('profile.collections.backToMessages', { defaultValue: '回到消息' })}
                </Text>
              </Pressable>
            ) : null}
            {source.senderID ? (
              <Pressable
                style={[s.sourceAction, d.sourceAction]}
                onPress={(event) => {
                  event.stopPropagation();
                  openSenderProfile(source);
                }}
              >
                <Ionicons name="person-outline" size={13} color={colors.text} />
                <Text style={d.sourceActionText}>
                  {t('profile.collections.sender', { defaultValue: '发送人' })}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      );
    },
    [
      colors.text,
      d.itemDesc,
      d.sourceAction,
      d.sourceActionText,
      openSenderProfile,
      openSourceMessage,
      t,
    ],
  );

  const renderItem = useCallback(
    ({ item }: { item: UserCollection }) => {
      const source = resolveCollectionSource(item, t);
      return (
        <View style={[s.itemCard, d.exampleCard]}>
          <View style={s.itemTop}>
            <View style={s.itemText}>
              <Text style={d.itemTitle}>{item.title}</Text>
              {item.summary ? (
                <Text style={d.itemDesc}>{item.summary}</Text>
              ) : null}
              {renderSource(source)}
            </View>
            <Pressable
              onPress={(event) => {
                event.stopPropagation();
                handleDelete(item.id);
              }}
            >
              <Text style={d.deleteText}>
                {t('common.delete', { defaultValue: '删除' })}
              </Text>
            </Pressable>
          </View>
        </View>
      );
    },
    [d, handleDelete, renderSource, t],
  );

  const listHeader = (
    <View style={s.listHeader}>
      {isOffline ? (
        <Text style={d.exampleDesc}>
          {t('common.offline', { defaultValue: '当前无网络连接，部分功能可能不可用' })}
        </Text>
      ) : null}
      <View style={s.tabsRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabs}
          scrollEventThrottle={16}
          onLayout={(e) => {
            tabsViewportWidth.current = e.nativeEvent.layout.width;
            recomputeTabsHint();
          }}
          onContentSizeChange={(contentWidth) => {
            tabsContentWidth.current = contentWidth;
            recomputeTabsHint();
          }}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } =
              e.nativeEvent;
            // 还有内容在右侧未露出 → 显示提示；滚到末尾（留 8px 容差）隐藏。
            setShowTabsHint(
              contentOffset.x + layoutMeasurement.width < contentSize.width - 8,
            );
          }}
        >
          {COLLECTION_TYPES.map((item) => {
            const selected = activeType === item.id;
            return (
              <Pressable
                key={item.id}
                style={[s.tab, d.tab, selected && d.tabActive]}
                onPress={() => setActiveType(item.id)}
              >
                <Ionicons
                  name={item.icon as any}
                  size={16}
                  color={selected ? colors.white : colors.textSecondary}
                />
                <Text style={[d.tabText, selected && d.tabTextActive]}>
                  {t(item.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {showTabsHint ? (
          <View style={[s.tabsHint, d.tabsHint]} pointerEvents="none">
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </View>
        ) : null}
      </View>

      {statusText ? <Text style={d.exampleDesc}>{statusText}</Text> : null}
    </View>
  );

  return (
    <View style={d.container}>
      <NavHeader title="" />
      {/* 收藏无分页、随使用无限增长 —— 必须虚拟化，不能 ScrollView + map 全量挂载。 */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[s.content, d.content]}
        ListHeaderComponent={listHeader}
        ItemSeparatorComponent={ItemSeparator}
        ListEmptyComponent={
          loading ? null : (
            <View style={[s.empty, d.empty]}>
              <Ionicons name={active.icon as any} size={44} color={colors.textSecondary} />
              <Text style={d.emptyTitle}>
                {t('profile.collections.empty', { defaultValue: '还没有收藏' })}
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}
