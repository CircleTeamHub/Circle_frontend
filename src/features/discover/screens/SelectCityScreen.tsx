import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { CITY_PROVINCES } from '@/features/profile/city-options';
import { useAuthStore } from '@/stores/authStore';
import { useCreateCircleFormStore } from '@/features/discover/store/use-create-circle-form-store';
import { useDiscoverFilterStore } from '@/features/discover/store/use-discover-filter-store';
import { usePostFormStore } from '@/features/discover/store/use-post-form-store';
import {
  MAX_CITY_SELECTION,
  buildInitialCityPickerState,
  resolveMultiCitySelection,
  toggleCitySelection,
} from '@/features/discover/utils/city-selection';
import { getCityFilterLimit } from '@/features/profile/membership-plans';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

interface CitySection {
  title: string;
  data: string[];
}

const s = StyleSheet.create({
  searchWrap: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  searchInput: {
    height: 40,
    borderRadius: Radius.xxl,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    ...Typography.bodyRegular,
  },
  topBar: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  countText: {
    ...Typography.caption,
    textAlign: 'center',
  },
  nationwideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  nationwideLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  selectedBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  sectionHeader: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.h3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingLeft: Spacing.lg + Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  cityText: {
    ...Typography.bodyRegular,
  },
  checkIcon: {
    width: 20,
    alignItems: 'center',
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
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

export default function SelectCityScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const user = useAuthStore((st) => st.user);
  const params = useLocalSearchParams<{ multiSelect?: string; target?: string }>();
  // 三个入口都走多选：发帖(post)、建圈(circle)、筛选(filter)。
  // circle-form 仅传 multiSelect=true（无 target）→ 归为 circle，保持原行为。
  const target: 'post' | 'circle' | 'filter' =
    params.target === 'filter'
      ? 'filter'
      : params.target === 'post'
        ? 'post'
        : params.multiSelect === 'true'
          ? 'circle'
          : 'post';
  const isMultiSelect = params.multiSelect === 'true';
  const formCities = usePostFormStore((st) => st.selectedCities);
  const setFormCities = usePostFormStore((st) => st.setSelectedCities);
  const circleCities = useCreateCircleFormStore((st) => st.selectedCities);
  const setCircleCities = useCreateCircleFormStore((st) => st.setSelectedCities);
  const filterCities = useDiscoverFilterStore((st) => st.draftCities);
  const setFilterCities = useDiscoverFilterStore((st) => st.setDraftCities);
  const filterNationwide = useDiscoverFilterStore((st) => st.draftNationwide);
  const setFilterNationwide = useDiscoverFilterStore(
    (st) => st.setDraftNationwide,
  );

  const isVip = (user?.vipLevel ?? 0) >= 1;

  // 城市筛选可选数上限按会员档位（评审 P1：钻石 50 / 超级无限，此前被全局 10 误封顶）。
  // 仅作用于发现页筛选（city-filters 权益）；建圈/发帖沿用通用上限。非会员用通用默认。
  const cityLimitEntitlement = getCityFilterLimit(user?.vipLevel ?? 0);
  const maxCities =
    target === 'filter'
      ? cityLimitEntitlement === 'unlimited'
        ? Number.POSITIVE_INFINITY
        : (cityLimitEntitlement ?? MAX_CITY_SELECTION)
      : MAX_CITY_SELECTION;
  const maxCitiesLabel =
    maxCities === Number.POSITIVE_INFINITY ? '∞' : String(maxCities);

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [isNationwide, setIsNationwide] = useState(false);

  useEffect(() => {
    const multiCities =
      target === 'filter'
        ? filterCities
        : target === 'post'
          ? formCities
          : circleCities;
    const nextState = buildInitialCityPickerState({
      isMultiSelect,
      singleCity: null,
      multiCities,
      // 发帖城市为可选标签，空 = 不限定（非「全国」）；仅建圈空选才视为全国。
      emptyMultiSelectIsNationwide: target === 'circle',
    });

    setSelected(nextState.selected);
    // 筛选的「全国」态由独立标记驱动（cities 为空时不代表全国）；建圈/发帖仍按 cities 推断。
    setIsNationwide(
      target === 'filter' ? filterNationwide : nextState.isNationwide,
    );
  }, [
    circleCities,
    filterCities,
    filterNationwide,
    formCities,
    isMultiSelect,
    target,
  ]);

  const sections: CitySection[] = useMemo(() => {
    if (!search.trim()) {
      return CITY_PROVINCES.map((p) => ({
        title: p.name,
        data: p.cities,
      }));
    }
    const q = search.trim().toLowerCase();
    return CITY_PROVINCES.map((p) => ({
      title: p.name,
      data: p.cities.filter(
        (c) => c.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
      ),
    })).filter((sec) => sec.data.length > 0);
  }, [search]);

  const toggleCity = useCallback(
    (city: string) => {
      if (isNationwide) return;
      setSelected((prev) => {
        const result = toggleCitySelection({
          current: prev,
          city,
          isMultiSelect,
          maxCities,
        });

        if (result.reachedLimit) {
          Alert.alert(t('city.hint'), t('city.maxCities', { max: maxCities }));
        }

        return result.nextSelected;
      });
    },
    [isMultiSelect, isNationwide, maxCities, t],
  );

  const toggleNationwide = useCallback(() => {
    if (!isVip) {
      Alert.alert(t('city.vipOnly'), t('city.vipOnlyMessage'));
      return;
    }
    setIsNationwide((prev) => {
      if (!prev) setSelected([]);
      return !prev;
    });
  }, [isVip, t]);

  const handleConfirm = useCallback(() => {
    const resolved = resolveMultiCitySelection(selected, isNationwide);
    if (target === 'filter') {
      // 「全国」= 不限地区、展示全部，不塞进 cities（保持为空、不参与筛选），改用独立标记记住，
      // 仅用于筛选页回显。这样才能区分「全国」与「未选择」，且不用每个下游都剔除哨兵城市。
      setFilterCities(resolved);
      setFilterNationwide(isNationwide);
    } else if (target === 'circle') {
      setCircleCities(resolved);
    } else {
      setFormCities(resolved); // post
    }
    router.back();
  }, [
    isNationwide,
    router,
    selected,
    setCircleCities,
    setFilterCities,
    setFilterNationwide,
    setFormCities,
    target,
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <NavHeader title={t('city.title')} />

      {/* Search */}
      <View style={s.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('city.searchPlaceholder')}
          placeholderTextColor={colors.textSecondary}
          style={[
            s.searchInput,
            {
              backgroundColor: colors.surface,
              borderColor: colors.surfaceBorder,
              color: colors.text,
            },
          ]}
        />
      </View>

      {/* Count + Nationwide */}
      <View style={s.topBar}>
        <Text style={[s.countText, { color: colors.textSecondary }]}>
          {isNationwide
            ? t('city.selectedNationwide')
            : isMultiSelect
              ? t('city.selectedCount', { count: selected.length, max: maxCitiesLabel })
              : selected[0] ? t('city.selectedSingle', { city: selected[0] }) : t('city.notSelected')}
        </Text>
      </View>

      {/* Selected chips */}
      {selected.length > 0 && !isNationwide ? (
        <View style={s.selectedBar}>
          {selected.map((city) => (
            <Pressable
              key={city}
              onPress={() => toggleCity(city)}
              style={[s.selectedChip, { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: colors.white, ...Typography.caption }}>{city}</Text>
              <Ionicons name="close" size={12} color={colors.white} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Nationwide option */}
      <Pressable style={s.nationwideRow} onPress={toggleNationwide}>
        <View style={s.nationwideLeft}>
          <Ionicons name="globe-outline" size={20} color={colors.text} />
          <Text style={{ color: colors.text, ...Typography.body, fontWeight: '600' }}>
            {t('city.nationwide')}
          </Text>
          {!isVip ? (
            <View style={{ backgroundColor: '#F59E0B', paddingHorizontal: 6, paddingVertical: 1, borderRadius: Radius.full }}>
              <Text style={{ color: colors.white, ...Typography.tinyRegular, fontWeight: '600' }}>VIP</Text>
            </View>
          ) : null}
        </View>
        <View style={s.checkIcon}>
          {isNationwide ? (
            <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
          ) : null}
        </View>
      </Pressable>
      <Divider />

      {/* City list */}
      <SectionList
        sections={sections}
        keyExtractor={(item, index) => `${item}-${index}`}
        {...keyboardDismissOnDragProps}
        renderSectionHeader={({ section }) => (
          <View style={[s.sectionHeader, { backgroundColor: colors.background }]}>
            <Text style={[s.sectionTitle, { color: colors.text }]}>
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item }) => {
          const isSelected = selected.includes(item);
          return (
            <Pressable
              style={[s.row, isNationwide && { opacity: 0.3 }]}
              onPress={() => toggleCity(item)}
              disabled={isNationwide}
            >
              <Text
                style={[
                  s.cityText,
                  { color: isSelected ? colors.primary : colors.textSecondary },
                ]}
              >
                {item}
              </Text>
              <View style={s.checkIcon}>
                {isSelected ? (
                  <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                ) : null}
              </View>
            </Pressable>
          );
        }}
        stickySectionHeadersEnabled
      />

      {/* Confirm button */}
      <View style={[s.footer, { paddingBottom: insets.bottom || 34 }]}>
        <Pressable
          style={[
            s.confirmBtn,
            {
              backgroundColor:
                selected.length > 0 || isNationwide
                  ? colors.primary
                  : colors.surfaceBorder,
            },
          ]}
          onPress={handleConfirm}
        >
          <Text style={[s.confirmText, { color: colors.white }]}>
            {t('city.confirmSelection')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
