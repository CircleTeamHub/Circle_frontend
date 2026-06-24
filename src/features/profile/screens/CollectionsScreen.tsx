import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { useNetworkStatus } from '@/hooks/use-network-status';
import {
  createCollection,
  deleteCollection,
  fetchCollections,
  type CollectionType,
  type UserCollection,
} from '@/services/api/collections';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const COLLECTION_TYPES: { id: CollectionType; label: string; icon: string }[] = [
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
  tabs: {
    flexDirection: 'row',
    gap: Spacing.sm,
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
  examples: {
    gap: Spacing.sm,
  },
  exampleCard: {
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
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
  addButton: {
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function CollectionsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isOffline } = useNetworkStatus();
  const [activeType, setActiveType] = useState<CollectionType>('CHAT');
  const [items, setItems] = useState<UserCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const active = COLLECTION_TYPES.find((item) => item.id === activeType) ?? COLLECTION_TYPES[0];

  useEffect(() => {
    let cancelled = false;

    async function loadCollections() {
      setLoading(true);
      setStatusText(null);
      try {
        const nextItems = await fetchCollections(activeType);
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

  async function handleCreateSample() {
    if (saving) {
      return;
    }
    setSaving(true);
    setStatusText(null);
    try {
      const item = await createCollection({
        type: activeType,
        title: `${active.label}收藏`,
        summary: `来自${active.label}的示例收藏，可替换为真实聊天、媒体或笔记内容。`,
        sourceID: `sample-${activeType.toLowerCase()}`,
        payload: { source: 'profile-collections' },
      });
      setItems((current) => [item, ...current]);
    } catch {
      setStatusText('添加收藏失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  }

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
      tabActive: {
        borderColor: colors.primary,
        backgroundColor: colors.primaryLight,
      },
      tabText: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      tabTextActive: {
        color: colors.primary,
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
      emptyDesc: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        textAlign: 'center' as const,
        lineHeight: 22,
      },
      exampleCard: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
      },
      exampleTitle: {
        color: colors.text,
        ...Typography.body,
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
      addButton: {
        backgroundColor: colors.primary,
      },
      addButtonDisabled: {
        backgroundColor: colors.surfaceBorder,
      },
      addButtonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '700' as const,
      },
    }),
    [colors, insets.bottom, insets.top],
  );

  return (
    <View style={d.container}>
      <NavHeader title="我的收藏" />
      <ScrollView contentContainerStyle={[s.content, d.content]}>
        {isOffline ? <Text style={d.exampleDesc}>当前无网络连接，部分功能可能不可用</Text> : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabs}
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
                  color={selected ? colors.primary : colors.textSecondary}
                />
                <Text style={[d.tabText, selected && d.tabTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={[s.empty, d.empty]}>
          <Ionicons name={active.icon as any} size={44} color={colors.textSecondary} />
          <Text style={d.emptyTitle}>{active.label}收藏</Text>
          <Text style={d.emptyDesc}>
            {loading
              ? '正在加载收藏内容...'
              : `这里会展示你收藏的${active.label}内容。收藏可覆盖聊天记录、视频、语音、信息、笔记。`}
          </Text>
        </View>

        {statusText ? <Text style={d.exampleDesc}>{statusText}</Text> : null}

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

        <Pressable
          style={[s.addButton, saving ? d.addButtonDisabled : d.addButton]}
          disabled={saving}
          onPress={handleCreateSample}
        >
          <Text style={d.addButtonText}>{saving ? '添加中...' : `添加${active.label}收藏`}</Text>
        </Pressable>

        <View style={s.examples}>
          <View style={[s.exampleCard, d.exampleCard]}>
            <Text style={d.exampleTitle}>收藏聊天记录</Text>
            <Text style={d.exampleDesc}>从聊天长按消息后加入收藏，稍后可在这里统一查看。</Text>
          </View>
          <View style={[s.exampleCard, d.exampleCard]}>
            <Text style={d.exampleTitle}>收藏笔记和媒体</Text>
            <Text style={d.exampleDesc}>笔记、视频、语音、信息会按类型归档，方便回看。</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
