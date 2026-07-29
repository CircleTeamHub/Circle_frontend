import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { getAvatarFrameSource } from '@/features/profile/membership-frames';
import { fetchAvatarFrameInventory } from '@/services/api/avatar-frames';
import { getApiErrorMessage } from '@/services/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type {
  AvatarFrameInventory,
  AvatarFrameInventoryItem,
  AvatarFrameOwnedSource,
} from '@/types';

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  listHeader: {
    gap: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  centered: {
    paddingVertical: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  preview: {
    minHeight: 180,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    overflow: 'hidden',
  },
  previewText: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  title: {
    ...Typography.h3,
    textAlign: 'center',
  },
  subtitle: {
    ...Typography.small,
    lineHeight: 18,
    textAlign: 'center',
  },
  separator: {
    height: Spacing.sm,
  },
  row: {
    minHeight: 92,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  thumbnail: {
    width: 58,
    height: 58,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameImage: {
    width: 58,
    height: 58,
  },
  rowText: {
    flex: 1,
    gap: Spacing.xs,
  },
  rowTitle: {
    ...Typography.body,
    fontWeight: '700',
  },
  metadata: {
    ...Typography.small,
    lineHeight: 17,
  },
  marker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  markerText: {
    ...Typography.tiny,
    fontWeight: '700',
  },
  retry: {
    minHeight: 44,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

function formatDate(value: string, language: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(language);
}

function getSourceSummary(
  sources: AvatarFrameOwnedSource[],
  t: TFunction,
): string {
  const labels = sources.map((source) =>
    source.type === 'MEMBERSHIP'
      ? t('profile.avatarFrames.source.membership', {
          level: source.minimumVipLevel,
        })
      : t('profile.avatarFrames.source.admin'),
  );
  return [...new Set(labels)].join(' · ') ||
    t('profile.avatarFrames.noSources');
}

function WardrobeRow({
  item,
  equipped,
  onPress,
}: {
  item: AvatarFrameInventoryItem | null;
  equipped: boolean;
  onPress: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const frameSource = item ? getAvatarFrameSource(item) : null;
  const title = item?.name ?? t('profile.avatarFrames.none');
  const sourceSummary = item
    ? getSourceSummary(item.ownedSources, t)
    : t('profile.avatarFrames.noneSubtitle');
  const availability = item?.availableUntil
    ? t('profile.avatarFrames.expires', {
        date: formatDate(item.availableUntil, i18n.language),
      })
    : t('profile.avatarFrames.permanent');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={`${sourceSummary}. ${availability}`}
      accessibilityState={{ selected: equipped }}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        {
          backgroundColor: colors.surface,
          borderColor: equipped ? colors.primary : colors.surfaceBorder,
        },
        pressed && { opacity: 0.72 },
      ]}
    >
      <View
        style={[
          s.thumbnail,
          { backgroundColor: colors.primaryLight },
        ]}
      >
        {frameSource ? (
          <Image
            source={frameSource}
            style={s.frameImage}
            contentFit="contain"
          />
        ) : (
          <Ionicons
            name={item ? 'image-outline' : 'ban-outline'}
            size={26}
            color={colors.primary}
          />
        )}
      </View>
      <View style={s.rowText}>
        <Text style={[s.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text
          style={[s.metadata, { color: colors.textSecondary }]}
          numberOfLines={2}
        >
          {sourceSummary}
        </Text>
        <Text style={[s.metadata, { color: colors.textSecondary }]}>
          {availability}
        </Text>
      </View>
      {equipped ? (
        <View style={[s.marker, { backgroundColor: colors.primaryLight }]}>
          <Ionicons name="checkmark" size={14} color={colors.primary} />
          <Text style={[s.markerText, { color: colors.primary }]}>
            {t('profile.avatarFrames.equipped')}
          </Text>
        </View>
      ) : (
        <Ionicons
          name="chevron-forward"
          size={20}
          color={colors.textSecondary}
        />
      )}
    </Pressable>
  );
}

export default function AvatarFramesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const user = useAuthStore((state) => state.user);
  const [inventory, setInventory] = useState<AvatarFrameInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const generationRef = useRef(0);
  const refreshPendingRef = useRef(false);

  const loadInventory = useCallback(
    async (refresh = false) => {
      if (refresh && refreshPendingRef.current) return;
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      if (refresh) {
        refreshPendingRef.current = true;
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setErrorText(null);
      try {
        const nextInventory = await fetchAvatarFrameInventory();
        if (generation === generationRef.current) {
          setInventory(nextInventory);
        }
      } catch (error) {
        if (generation === generationRef.current) {
          setErrorText(
            getApiErrorMessage(
              error,
              t('profile.avatarFrames.loadError'),
            ),
          );
        }
      } finally {
        if (generation === generationRef.current) {
          setLoading(false);
          setRefreshing(false);
          refreshPendingRef.current = false;
        }
      }
    },
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      void loadInventory();
      return () => {
        generationRef.current += 1;
        refreshPendingRef.current = false;
      };
    }, [loadInventory]),
  );

  const openDetail = useCallback(
    (id: string) => {
      router.push({
        pathname: '/(tabs)/profile/avatar-frame/[id]',
        params: { id },
      } as never);
    },
    [router],
  );

  const equippedFrame =
    inventory?.items.find(
      (item) => item.id === inventory.equippedFrameId,
    ) ?? null;
  const effectiveFrameSource = getAvatarFrameSource(equippedFrame);
  const renderWardrobeItem = useCallback(
    ({ item }: { item: AvatarFrameInventoryItem }) => (
      <WardrobeRow
        item={item}
        equipped={item.id === inventory?.equippedFrameId}
        onPress={() => openDetail(item.id)}
      />
    ),
    [inventory?.equippedFrameId, openDetail],
  );
  const keyExtractor = useCallback(
    (item: AvatarFrameInventoryItem) => item.id,
    [],
  );

  const themed = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      preview: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
    }),
    [colors],
  );

  return (
    <View style={[s.container, themed.container]}>
      <View style={{ paddingTop: insets.top }}>
        <NavHeader
          title={t('profile.avatarFrames.title')}
          fallbackHref="/(tabs)/profile/decorations"
        />
      </View>
      <FlatList
        data={inventory?.items ?? []}
        renderItem={renderWardrobeItem}
        keyExtractor={keyExtractor}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadInventory(true)}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={[
          s.content,
          { paddingBottom: Math.max(insets.bottom, Spacing.xl) },
        ]}
        ItemSeparatorComponent={() => <View style={s.separator} />}
        ListHeaderComponent={
          loading && !inventory ? (
          <View style={s.centered}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : errorText && !inventory ? (
          <View style={s.centered}>
            <Ionicons
              name="cloud-offline-outline"
              size={36}
              color={colors.textSecondary}
            />
            <Text
              selectable
              style={[s.subtitle, { color: colors.textSecondary }]}
            >
              {errorText}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void loadInventory()}
              style={[s.retry, { backgroundColor: colors.primary }]}
            >
              <Text style={[s.rowTitle, { color: colors.white }]}>
                {t('profile.avatarFrames.retry')}
              </Text>
            </Pressable>
          </View>
        ) : inventory ? (
          <View style={s.listHeader}>
            <View style={[s.preview, themed.preview]}>
              <Avatar
                size={82}
                name={user?.nickname || user?.accountId}
                uri={user?.avatarUrl ?? undefined}
                bgColor={colors.primaryLight}
                frameSource={effectiveFrameSource ?? undefined}
              />
              <View style={s.previewText}>
                <Text style={[s.title, { color: colors.text }]}>
                  {t('profile.avatarFrames.previewTitle')}
                </Text>
                <Text
                  style={[s.subtitle, { color: colors.textSecondary }]}
                >
                  {equippedFrame?.name ??
                    t('profile.avatarFrames.none')}
                </Text>
              </View>
            </View>

            {errorText ? (
              <Text
                selectable
                style={[s.subtitle, { color: colors.error }]}
              >
                {errorText}
              </Text>
            ) : null}

            <WardrobeRow
              item={null}
              equipped={inventory.equippedFrameId === null}
              onPress={() => openDetail('none')}
            />
          </View>
        ) : null}
        ListEmptyComponent={
          inventory ? (
            <View style={s.centered}>
              <Text
                style={[s.subtitle, { color: colors.textSecondary }]}
              >
                {t('profile.avatarFrames.empty')}
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
