import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { useNetworkStatus } from '@/hooks/use-network-status';
import {
  deleteCollection,
  fetchCollections,
  type CollectionType,
  type UserCollection,
} from '@/services/api/collections';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

// 'ALL' 是「全部」伪类型：不按类型过滤，拉取所有收藏。其余对应后端 CollectionType。
type CollectionTab = 'ALL' | CollectionType;

const COLLECTION_TYPES: { id: CollectionTab; label: string; icon: string }[] = [
  { id: 'ALL', label: '全部', icon: 'albums-outline' },
  { id: 'CHAT', label: '聊天记录', icon: 'chatbubble-ellipses-outline' },
  { id: 'VIDEO', label: '视频', icon: 'videocam-outline' },
  { id: 'VOICE', label: '语音', icon: 'mic-outline' },
  { id: 'MESSAGE', label: '信息', icon: 'mail-outline' },
  { id: 'NOTE', label: '笔记', icon: 'document-text-outline' },
];

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
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
  list: {
    gap: Spacing.sm,
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
});

export default function CollectionsScreen() {
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
          setItems(nextItems);
        }
      } catch {
        if (!cancelled) {
          setStatusText('收藏加载失败，请稍后重试');
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
  }, [activeType]);

  function handleDelete(id: string) {
    Alert.alert('确认删除', '确定要删除这条收藏吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCollection(id);
            setItems((current) => current.filter((item) => item.id !== id));
          } catch {
            setStatusText('删除收藏失败，请稍后重试');
          }
        },
      },
    ]);
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
    }),
    [colors, insets.bottom, insets.top],
  );

  return (
    <View style={d.container}>
      <NavHeader title="" />
      <ScrollView contentContainerStyle={[s.content, d.content]}>
        {isOffline ? <Text style={d.exampleDesc}>当前无网络连接，部分功能可能不可用</Text> : null}
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
                  <Text style={[d.tabText, selected && d.tabTextActive]}>{item.label}</Text>
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

        {!loading && items.length === 0 ? (
          <View style={[s.empty, d.empty]}>
            <Ionicons name={active.icon as any} size={44} color={colors.textSecondary} />
            <Text style={d.emptyTitle}>还没有收藏</Text>
          </View>
        ) : null}

        <View style={s.list}>
          {items.map((item) => (
            <View key={item.id} style={[s.itemCard, d.exampleCard]}>
              <View style={s.itemTop}>
                <View style={s.itemText}>
                  <Text style={d.itemTitle}>{item.title}</Text>
                  {item.summary ? <Text style={d.itemDesc}>{item.summary}</Text> : null}
                </View>
                <Pressable onPress={() => handleDelete(item.id)}>
                  <Text style={d.deleteText}>删除</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
