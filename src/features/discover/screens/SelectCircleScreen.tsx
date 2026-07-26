import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { CircleAvatar } from '@/components/ui/circle-avatar';
import { Divider } from '@/components/ui/divider';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import { usePostFormStore } from '@/features/discover/store/use-post-form-store';
import {
  arePostFormCircleSelectionsEqual,
  filterAvailablePostFormCircles,
} from '@/features/discover/utils/post-form-circle-selection';
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
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  countText: {
    ...Typography.caption,
    textAlign: 'center',
    paddingBottom: Spacing.sm,
  },
  confirmBtn: {
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    ...Typography.body,
    fontWeight: '600',
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

  const selectedCircles = usePostFormStore((s) => s.selectedCircles);
  const setSelectedCircles = usePostFormStore((s) => s.setSelectedCircles);
  const [draftCircles, setDraftCircles] = useState(selectedCircles);

  // focus 回调要读「最新 circles」但不把 circles 列为依赖（否则列表刷新会触发它、用
  // committed 重置 draft，冲掉用户已勾的 toggle），故用 ref 读值。
  const circlesRef = useRef(circles);
  useEffect(() => {
    circlesRef.current = circles;
  }, [circles]);

  // focus 进入（或 committed 变化）：用 committed 初始化 draft，放弃上次未确定的编辑，
  // 并按当前可用圈子过滤。
  useFocusEffect(
    useCallback(() => {
      setDraftCircles(
        filterAvailablePostFormCircles(selectedCircles, circlesRef.current),
      );
    }, [selectedCircles]),
  );

  // 圈子列表刷新（fetchMyCircles 完成）：只从「当前 draft」剔除已不可用的，保留用户
  // 自 focus 以来勾选的 toggle —— 不用 committed 快照重置，否则会冲掉未确定的编辑。
  useEffect(() => {
    setDraftCircles((current) => {
      const next = filterAvailablePostFormCircles(current, circles);
      return arePostFormCircleSelectionsEqual(current, next) ? current : next;
    });
  }, [circles]);

  const selectedIds = useMemo(
    () => new Set(draftCircles.map((c) => c.id)),
    [draftCircles],
  );

  const handleToggle = useCallback(
    (circle: Circle) => {
      setDraftCircles((current) => {
        const exists = current.some((item) => item.id === circle.id);
        return exists
          ? current.filter((item) => item.id !== circle.id)
          : [...current, { id: circle.id, name: circle.name }];
      });
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    setSelectedCircles(draftCircles);
    router.back();
  }, [draftCircles, router, setSelectedCircles]);

  const renderItem = useCallback(
    ({ item }: { item: Circle }) => {
      const isSelected = selectedIds.has(item.id);
      return (
        <View>
          <Pressable style={s.row} onPress={() => handleToggle(item)}>
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
              name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={isSelected ? colors.primary : colors.surfaceBorder}
            />
          </Pressable>
          <Divider />
        </View>
      );
    },
    [handleToggle, selectedIds, d, colors],
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
          <Pressable style={d.retryButton} onPress={() => fetchMyCircles()}>
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
                <Pressable style={d.retryButton} onPress={() => fetchMyCircles()}>
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

      {circles.length > 0 ? (
        <View style={[s.footer, { paddingBottom: insets.bottom || 34 }]}>
          <Text style={[s.countText, { color: colors.textSecondary }]}>
            {t('plaza.circlePicker.selectedCount', {
              count: draftCircles.length,
              defaultValue: '已选 {{count}} 个圈子',
            })}
          </Text>
          <Pressable
            style={[
              s.confirmBtn,
              {
                backgroundColor:
                  draftCircles.length > 0
                    ? colors.primary
                    : colors.surfaceBorder,
              },
            ]}
            disabled={draftCircles.length === 0}
            onPress={handleConfirm}
          >
            <Text style={[s.confirmText, { color: colors.white }]}>
              {t('city.confirmSelection', { defaultValue: '确定' })}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
