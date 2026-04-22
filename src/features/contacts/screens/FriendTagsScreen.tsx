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
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      setError(t('contacts.tagsScreen.loadFailed'));
    } finally {
      if (!signal?.cancelled) {
        setLoading(false);
      }
    }
  }, [t]);

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
      <Text style={d.stateText}>{t('contacts.tagsScreen.loading')}</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
      <Pressable
        style={[s.retryButton, d.retryButton]}
        onPress={() => {
          void loadTags();
        }}
      >
        <Text style={d.retryButtonText}>{t('common.retry')}</Text>
      </Pressable>
    </View>
  ) : tags.length === 0 ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{t('contacts.tagsScreen.empty')}</Text>
    </View>
  ) : (
    <View style={[s.listCard, d.listCard]}>
      {tags.map((tag, index) => (
        <View key={tag.id}>
          <MenuRow
            icon="pricetag"
            iconBgColor={tag.color ?? '#A855F7'}
            label={tag.name}
            subtitle={t('contacts.tagsScreen.viewByTag')}
            rightText={t('contacts.tagsScreen.friendCount', { count: tag.friendCount })}
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
      <NavHeader title={t('contacts.tagsScreen.title')} />
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.introCard, d.introCard]}>
          <Text style={d.introTitle}>{t('contacts.tagsScreen.categoryTitle')}</Text>
          <Text style={d.introCopy}>{t('contacts.tagsScreen.categoryDesc')}</Text>
        </View>
        {stateBlock}
      </ScrollView>
    </View>
  );
}
