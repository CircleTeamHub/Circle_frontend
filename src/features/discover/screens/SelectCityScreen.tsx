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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { CITY_PROVINCES } from '@/features/profile/city-options';
import { useAuthStore } from '@/stores/authStore';
import { useCreateCircleFormStore } from '@/features/discover/store/use-create-circle-form-store';
import { usePostFormStore } from '@/features/discover/store/use-post-form-store';
import {
  MAX_CITY_SELECTION,
  buildInitialCityPickerState,
  resolveMultiCitySelection,
  resolveSingleCitySelection,
  toggleCitySelection,
} from '@/features/discover/utils/city-selection';

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
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const user = useAuthStore((st) => st.user);
  const params = useLocalSearchParams<{ multiSelect?: string }>();
  const isMultiSelect = params.multiSelect === 'true';
  const formCity = usePostFormStore((st) => st.selectedCity);
  const setFormCity = usePostFormStore((st) => st.setSelectedCity);
  const circleCities = useCreateCircleFormStore((st) => st.selectedCities);
  const setCircleCities = useCreateCircleFormStore((st) => st.setSelectedCities);

  const isVip = (user?.vipLevel ?? 0) >= 1;

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [isNationwide, setIsNationwide] = useState(false);

  useEffect(() => {
    const nextState = buildInitialCityPickerState({
      isMultiSelect,
      singleCity: formCity,
      multiCities: circleCities,
    });

    setSelected(nextState.selected);
    setIsNationwide(nextState.isNationwide);
  }, [circleCities, formCity, isMultiSelect]);

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
        });

        if (result.reachedLimit) {
          Alert.alert('提示', `最多选择${MAX_CITY_SELECTION}个城市`);
        }

        return result.nextSelected;
      });
    },
    [isMultiSelect, isNationwide],
  );

  const toggleNationwide = useCallback(() => {
    if (!isVip) {
      Alert.alert('VIP专属', '全国范围仅VIP用户可选');
      return;
    }
    setIsNationwide((prev) => {
      if (!prev) setSelected([]);
      return !prev;
    });
  }, [isVip]);

  const handleConfirm = useCallback(() => {
    if (isMultiSelect) {
      setCircleCities(resolveMultiCitySelection(selected, isNationwide));
    } else {
      setFormCity(resolveSingleCitySelection(selected, isNationwide));
    }
    router.back();
  }, [
    isMultiSelect,
    isNationwide,
    router,
    selected,
    setCircleCities,
    setFormCity,
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <NavHeader title="选择城市" />

      {/* Search */}
      <View style={s.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="搜索城市"
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
            ? '已选：全国'
            : isMultiSelect
              ? `已选 ${selected.length}/${MAX_CITY_SELECTION} 个城市`
              : `已选：${selected[0] ?? '未选择城市'}`}
        </Text>
      </View>

      {/* Selected chips */}
      {selected.length > 0 && !isNationwide ? (
        <View style={s.selectedBar}>
          {selected.map((city) => (
            <Pressable
              key={city}
              onPress={() => toggleCity(city)}
              style={[s.selectedChip, { backgroundColor: colors.primaryLight }]}
            >
              <Text style={{ color: colors.primary, ...Typography.caption }}>{city}</Text>
              <Ionicons name="close" size={12} color={colors.primary} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Nationwide option */}
      <Pressable style={s.nationwideRow} onPress={toggleNationwide}>
        <View style={s.nationwideLeft}>
          <Ionicons name="globe-outline" size={20} color={colors.text} />
          <Text style={{ color: colors.text, ...Typography.body, fontWeight: '600' }}>
            全国
          </Text>
          {!isVip ? (
            <View style={{ backgroundColor: '#F59E0B20', paddingHorizontal: 6, paddingVertical: 1, borderRadius: Radius.full }}>
              <Text style={{ color: '#F59E0B', ...Typography.tinyRegular, fontWeight: '600' }}>VIP</Text>
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
            确认选择
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
