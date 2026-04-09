import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { NavHeader } from '@/components/ui/nav-header';
import { sortFriendTags } from '@/features/contacts/contact-friends';
import {
  fetchFriendTags,
  fetchFriendsByTag,
  type FriendTag,
} from '@/services/api/friends';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type FriendTagSummary = FriendTag & {
  friendCount: number;
};

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.lg,
  },
  introCard: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: 6,
  },
  stateBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingVertical: 56,
  },
  retryButton: {
    minWidth: 96,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  listCard: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
  },
});

export default function FriendTagsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const [tags, setTags] = useState<FriendTagSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTags = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);

    try {
      const nextTags = sortFriendTags(await fetchFriendTags());
      const counts = await Promise.all(
        nextTags.map(async (tag) => ({
          ...tag,
          friendCount: (await fetchFriendsByTag(tag.id)).length,
        })),
      );

      if (signal?.cancelled) return;
      setTags(counts);
      setError(null);
    } catch {
      if (signal?.cancelled) return;
      setError('标签加载失败，请稍后重试');
    } finally {
      if (!signal?.cancelled) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    loadTags(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadTags]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      introCard: {
        backgroundColor: colors.surface,
      },
      introTitle: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      introCopy: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      listCard: {
        backgroundColor: colors.surface,
      },
      stateText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      retryButton: {
        backgroundColor: colors.primary,
      },
      retryButtonText: {
        color: colors.white,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  const stateBlock = loading ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>正在加载标签...</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
      <Pressable style={[s.retryButton, d.retryButton]} onPress={loadTags}>
        <Text style={d.retryButtonText}>重试</Text>
      </Pressable>
    </View>
  ) : tags.length === 0 ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>还没有设置好友标签</Text>
    </View>
  ) : (
    <View style={[s.listCard, d.listCard]}>
      {tags.map((tag, index) => (
        <View key={tag.id}>
          <MenuRow
            icon="pricetag"
            iconBgColor={tag.color ?? '#A855F7'}
            label={tag.name}
            subtitle="按标签查看好友"
            rightText={`${tag.friendCount} 位好友`}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/contacts/tags/[id]',
                params: { id: tag.id, name: tag.name },
              })
            }
          />
          {index < tags.length - 1 ? <Divider /> : null}
        </View>
      ))}
    </View>
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="标签" />
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.introCard, d.introCard]}>
          <Text style={d.introTitle}>好友分类</Text>
          <Text style={d.introCopy}>按标签分类查看好友，便于快速找到特定分组。</Text>
        </View>
        {stateBlock}
      </ScrollView>
    </View>
  );
}
