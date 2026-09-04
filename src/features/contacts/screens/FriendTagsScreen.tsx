import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { NavHeader } from '@/components/ui/nav-header';
import { sortFriendTags } from '@/features/contacts/contact-friends';
import {
  createFriendTag,
  fetchFriendTags,
  fetchFriendsByTag,
  type FriendTag,
} from '@/services/api/friends';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getApiErrorMessage } from '@/services/api/errors';
import { Ionicons } from '@expo/vector-icons';

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
  headerAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  modalCard: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  modalTitle: {
    ...Typography.h3,
  },
  modalInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    ...Typography.bodyRegular,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.md,
  },
  modalButton: {
    minWidth: 76,
    height: 40,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
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
  const [refreshing, setRefreshing] = useState(false);
  const [createTagVisible, setCreateTagVisible] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);

  const loadTags = useCallback(async (signal?: { cancelled: boolean }) => {
    const isCancelled = () => Boolean(signal?.cancelled) || !mountedRef.current;
    setLoading(true);

    try {
      const nextTags = sortFriendTags(await fetchFriendTags());
      const counts = await Promise.all(
        nextTags.map(async (tag) => ({
          ...tag,
          friendCount: (await fetchFriendsByTag(tag.id)).length,
        })),
      );

      if (isCancelled()) return;
      setTags(counts);
      setError(null);
    } catch {
      if (isCancelled()) return;
      setError(t('contacts.tagsScreen.loadFailed'));
    } finally {
      if (!isCancelled()) {
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

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const handleRefreshTags = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await loadTags();
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
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
      modalCard: { backgroundColor: colors.surface },
      modalTitle: { color: colors.text },
      modalInput: {
        color: colors.text,
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.background,
      },
      modalCancel: { backgroundColor: colors.surfaceBorder },
      modalCreate: { backgroundColor: colors.primary },
      modalCancelText: { color: colors.text, ...Typography.bodyRegular },
      modalCreateText: { color: colors.white, ...Typography.bodyRegular },
    }),
    [colors],
  );

  const handleCreateTag = useCallback(async () => {
    const trimmed = newTagName.trim();
    if (!trimmed || creatingTag) return;
    setCreatingTag(true);
    try {
      const created = await createFriendTag(trimmed);
      if (!mountedRef.current) return;
      setTags((current) =>
        sortFriendTags([
          ...current,
          { ...created, friendCount: 0 },
        ]) as FriendTagSummary[],
      );
      setNewTagName('');
      setCreateTagVisible(false);
    } catch (caughtError) {
      if (!mountedRef.current) return;
      Alert.alert(
        t('contacts.tagsScreen.createFailedTitle', {
          defaultValue: '添加标签失败',
        }),
        getApiErrorMessage(caughtError, t('common.networkError')),
      );
    } finally {
      if (mountedRef.current) setCreatingTag(false);
    }
  }, [creatingTag, newTagName, t]);

  const stateBlock = loading && tags.length === 0 ? (
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
      <NavHeader
        title={t('contacts.tagsScreen.title')}
        rightSlot={
          <Pressable
            style={s.headerAction}
            onPress={() => setCreateTagVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={t('contacts.tagsScreen.addTag', {
              defaultValue: '添加标签',
            })}
          >
            <Ionicons name="add" size={26} color={colors.primary} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefreshTags}
            tintColor={colors.primary}
          />
        }
      >
        <View style={[s.introCard, d.introCard]}>
          <Text style={d.introTitle}>{t('contacts.tagsScreen.categoryTitle')}</Text>
          <Text style={d.introCopy}>{t('contacts.tagsScreen.categoryDesc')}</Text>
        </View>
        {stateBlock}
      </ScrollView>
      <Modal
        visible={createTagVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateTagVisible(false)}
      >
        <Pressable
          style={s.modalBackdrop}
          onPress={() => setCreateTagVisible(false)}
        >
          <Pressable style={[s.modalCard, d.modalCard]} onPress={() => undefined}>
            <Text style={[s.modalTitle, d.modalTitle]}>
              {t('contacts.tagsScreen.addTag', { defaultValue: '添加标签' })}
            </Text>
            <TextInput
              value={newTagName}
              onChangeText={setNewTagName}
              onSubmitEditing={() => void handleCreateTag()}
              autoFocus
              maxLength={24}
              returnKeyType="done"
              placeholder={t('contacts.tagsScreen.tagNamePlaceholder', {
                defaultValue: '填写标签名称',
              })}
              placeholderTextColor={colors.textSecondary}
              style={[s.modalInput, d.modalInput]}
            />
            <View style={s.modalActions}>
              <Pressable
                style={[s.modalButton, d.modalCancel]}
                onPress={() => setCreateTagVisible(false)}
                disabled={creatingTag}
              >
                <Text style={d.modalCancelText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                style={[s.modalButton, d.modalCreate]}
                onPress={() => void handleCreateTag()}
                disabled={!newTagName.trim() || creatingTag}
              >
                {creatingTag ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={d.modalCreateText}>
                    {t('common.create', { defaultValue: '创建' })}
                  </Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
