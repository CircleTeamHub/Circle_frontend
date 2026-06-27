import { useCallback, useEffect, useMemo } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import { useDiscoverFilterStore } from '@/features/discover/store/use-discover-filter-store';
import { useDiscoverStore } from '@/features/discover/store/use-discover-store';

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  card: {
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  sectionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    flex: 1,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingBottom: Spacing.md,
    paddingLeft: 60,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs + 2,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  chipRemove: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    marginLeft: 60,
  },
  emptyHint: {
    paddingLeft: 60,
    paddingBottom: Spacing.md,
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  actionBtn: {
    flex: 1,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
  },
});

export default function FilterScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const joinedCircles = useCirclesStore((st) => st.joinedCircles);
  const createdCircles = useCirclesStore((st) => st.createdCircles);
  const fetchMyCircles = useCirclesStore((st) => st.fetchMyCircles);
  const setPlazaFilter = useDiscoverStore((st) => st.setPlazaFilter);

  const draftCircleIds = useDiscoverFilterStore((st) => st.draftCircleIds);
  const draftCities = useDiscoverFilterStore((st) => st.draftCities);
  const loadDraftFromApplied = useDiscoverFilterStore(
    (st) => st.loadDraftFromApplied,
  );
  const removeDraftCircle = useDiscoverFilterStore((st) => st.removeDraftCircle);
  const removeDraftCity = useDiscoverFilterStore((st) => st.removeDraftCity);
  const clearDraft = useDiscoverFilterStore((st) => st.clearDraft);
  const saveFilter = useDiscoverFilterStore((st) => st.saveFilter);

  useEffect(() => {
    fetchMyCircles();
  }, [fetchMyCircles]);

  useEffect(() => {
    loadDraftFromApplied();
  }, [loadDraftFromApplied]);

  const myFilterCircles = useMemo(() => {
    const byId = new Map(joinedCircles.map((circle) => [circle.id, circle]));
    for (const circle of createdCircles) {
      byId.set(circle.id, circle);
    }
    return [...byId.values()];
  }, [createdCircles, joinedCircles]);

  const circleNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const circle of myFilterCircles) {
      map.set(circle.id, circle.name);
    }
    return map;
  }, [myFilterCircles]);

  const selectedCircles = useMemo(
    () =>
      draftCircleIds.map((id) => ({
        id,
        name: circleNameById.get(id) ?? id,
      })),
    [draftCircleIds, circleNameById],
  );

  const handleOpenCircles = useCallback(() => {
    router.push('/(tabs)/discover/select-filter-circles');
  }, [router]);

  const handleOpenCities = useCallback(() => {
    router.push({
      pathname: '/(tabs)/discover/select-city',
      params: { multiSelect: 'true', target: 'filter' },
    });
  }, [router]);

  const handleClear = useCallback(() => {
    clearDraft();
  }, [clearDraft]);

  const handleSave = useCallback(() => {
    saveFilter();
    setPlazaFilter(null, null);
    // Android 用 Toast 给即时反馈；iOS 没有 Toast API，依赖 router.back() 的导航动画
    // 作为「保存成功」的隐式反馈。Toast 视觉跨平台对齐留作后续 UI 决策（#50）。
    if (Platform.OS === 'android') {
      ToastAndroid.show(t('discover.filter.saved'), ToastAndroid.SHORT);
    }
    router.back();
  }, [router, saveFilter, setPlazaFilter, t]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      card: { backgroundColor: colors.surface },
      sectionIcon: { backgroundColor: colors.text },
      sectionTitle: {
        color: colors.text,
        ...Typography.h3,
      },
      chip: { backgroundColor: colors.primary },
      chipText: {
        color: colors.white,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
      chipRemove: { backgroundColor: colors.white },
      emptyHint: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      divider: { backgroundColor: colors.divider },
      clearBtn: {
        backgroundColor: colors.primary,
      },
      clearText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      saveBtn: {
        backgroundColor: colors.primary,
      },
      saveText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('discover.filter.title')}
        rightIcon="help-circle-outline"
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.card, d.card]}>
          <Pressable style={s.sectionRow} onPress={handleOpenCircles}>
            <View style={[s.sectionIcon, d.sectionIcon]}>
              <Ionicons name="apps" size={22} color={colors.white} />
            </View>
            <Text style={[s.sectionTitle, d.sectionTitle]}>
              {t('discover.filter.selectCircles')}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>

          {selectedCircles.length > 0 ? (
            <View style={s.chipsWrap}>
              {selectedCircles.map((circle) => (
                <View key={circle.id} style={[s.chip, d.chip]}>
                  <Text style={d.chipText} numberOfLines={1}>
                    {circle.name}
                  </Text>
                  <Pressable
                    style={[s.chipRemove, d.chipRemove]}
                    onPress={() => removeDraftCircle(circle.id)}
                    hitSlop={6}
                  >
                    <Ionicons name="close" size={13} color={colors.primary} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[s.emptyHint, d.emptyHint]}>
              {t('discover.filter.noCirclesSelected')}
            </Text>
          )}

          <View style={[s.divider, d.divider]} />

          <Pressable style={s.sectionRow} onPress={handleOpenCities}>
            <View style={[s.sectionIcon, d.sectionIcon]}>
              <Ionicons name="business" size={22} color={colors.white} />
            </View>
            <Text style={[s.sectionTitle, d.sectionTitle]}>
              {t('discover.filter.selectRegions')}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>

          {draftCities.length > 0 ? (
            <View style={s.chipsWrap}>
              {draftCities.map((city) => (
                <View key={city} style={[s.chip, d.chip]}>
                  <Ionicons
                    name="location-outline"
                    size={12}
                    color={colors.white}
                  />
                  <Text style={d.chipText} numberOfLines={1}>
                    {city}
                  </Text>
                  <Pressable
                    style={[s.chipRemove, d.chipRemove]}
                    onPress={() => removeDraftCity(city)}
                    hitSlop={6}
                  >
                    <Ionicons name="close" size={13} color={colors.primary} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[s.emptyHint, d.emptyHint]}>
              {t('discover.filter.noCitiesSelected')}
            </Text>
          )}
        </View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom || Spacing.md }]}>
        <Pressable
          style={[s.actionBtn, d.clearBtn]}
          onPress={handleClear}
        >
          <Ionicons name="trash-outline" size={18} color={colors.primary} />
          <Text style={d.clearText}>{t('discover.filter.clear')}</Text>
        </Pressable>
        <Pressable style={[s.actionBtn, d.saveBtn]} onPress={handleSave}>
          <Ionicons name="save-outline" size={18} color={colors.white} />
          <Text style={d.saveText}>{t('discover.filter.save')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
