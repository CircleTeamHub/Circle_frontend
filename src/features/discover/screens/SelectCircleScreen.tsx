import { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { CircleAvatar } from '@/components/ui/circle-avatar';
import { Divider } from '@/components/ui/divider';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import { usePostFormStore } from '@/features/discover/store/use-post-form-store';
import type { Circle } from '@/types';

const s = StyleSheet.create({
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  info: {
    flex: 1,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
  },
});

export default function SelectCircleScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const {
    joinedCircles,
    createdCircles,
    myCirclesLoading,
    myCirclesError,
    fetchMyCircles,
  } = useCirclesStore(
    useShallow((s) => ({
      joinedCircles: s.joinedCircles,
      createdCircles: s.createdCircles,
      myCirclesLoading: s.myCirclesLoading,
      myCirclesError: s.myCirclesError,
      fetchMyCircles: s.fetchMyCircles,
    })),
  );

  useEffect(() => {
    fetchMyCircles();
  }, [fetchMyCircles]);

  const circles = useMemo(() => {
    const map = new Map<string, Circle>();
    for (const c of createdCircles) map.set(c.id, c);
    for (const c of joinedCircles) map.set(c.id, c);
    return Array.from(map.values());
  }, [joinedCircles, createdCircles]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      name: { color: colors.text, ...Typography.body, fontWeight: '600' as const },
      desc: { color: colors.textSecondary, ...Typography.caption },
      cover: { backgroundColor: colors.surfaceBorder },
      emptyText: { color: colors.textSecondary, ...Typography.body },
      retryButton: {
        marginTop: Spacing.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.full,
        backgroundColor: colors.primary,
      },
      retryText: { color: colors.white, ...Typography.caption },
    }),
    [colors],
  );

  const setSelectedCircle = usePostFormStore((s) => s.setSelectedCircle);

  const handleSelect = useCallback(
    (circle: Circle) => {
      setSelectedCircle({ id: circle.id, name: circle.name });
      router.back();
    },
    [router, setSelectedCircle],
  );

  const renderItem = useCallback(
    ({ item }: { item: Circle }) => (
      <View>
        <Pressable style={s.row} onPress={() => handleSelect(item)}>
          <CircleAvatar
            uri={item.avatarUrl}
            size={44}
            borderRadius={Radius.sm}
            style={d.cover}
          />
          <View style={s.info}>
            <Text style={d.name}>{item.name}</Text>
            {item.description ? (
              <Text style={d.desc} numberOfLines={1}>
                {item.description}
              </Text>
            ) : null}
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textSecondary}
          />
        </Pressable>
        <Divider />
      </View>
    ),
    [handleSelect, d, colors],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('plaza.selectCircle')} />
      {myCirclesLoading ? (
        <View style={s.emptyContainer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : myCirclesError && circles.length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={d.emptyText}>{myCirclesError}</Text>
          <Pressable style={d.retryButton} onPress={fetchMyCircles}>
            <Text style={d.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={circles}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          ListHeaderComponent={
            myCirclesError ? (
              <View style={s.emptyContainer}>
                <Text style={d.emptyText}>{myCirclesError}</Text>
                <Pressable style={d.retryButton} onPress={fetchMyCircles}>
                  <Text style={d.retryText}>{t('common.retry')}</Text>
                </Pressable>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={s.emptyContainer}>
              <Text style={d.emptyText}>{t('plaza.noCirclesJoined')}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
