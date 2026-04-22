import { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
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
  cover: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
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
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const {
    joinedCircles,
    createdCircles,
    myCirclesLoading,
    myCirclesError,
    fetchMyCircles,
  } = useCirclesStore();

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
          <Image
            source={{ uri: item.avatarUrl ?? undefined }}
            style={[s.cover, d.cover]}
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
      <NavHeader title="选择圈子" />
      {myCirclesLoading ? (
        <View style={s.emptyContainer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : myCirclesError && circles.length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={d.emptyText}>{myCirclesError}</Text>
          <Pressable style={d.retryButton} onPress={fetchMyCircles}>
            <Text style={d.retryText}>重试</Text>
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
                  <Text style={d.retryText}>重试</Text>
                </Pressable>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={s.emptyContainer}>
              <Text style={d.emptyText}>还没有加入任何圈子</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
