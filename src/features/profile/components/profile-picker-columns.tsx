import { memo, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { CITY_PROVINCES } from '@/features/profile/city-options';
import {
  getBirthdayYears,
  getDaysInMonth,
  updateBirthdayDraft,
  type BirthdayDraft,
} from '@/features/profile/utils/profile-field-pickers';

const s = StyleSheet.create({
  columns: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  column: {
    flex: 1,
  },
  list: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    maxHeight: 260,
  },
  item: {
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

interface PickerOption<T> {
  value: T;
  label: string;
}

interface PickerColumnProps<T> {
  options: PickerOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
}

function PickerColumnInner<T extends string | number>({
  options,
  selected,
  onSelect,
}: PickerColumnProps<T>) {
  const { colors } = useTheme();
  return (
    <View style={s.column}>
      <ScrollView
        style={[s.list, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}
        nestedScrollEnabled
      >
        {options.map((option) => {
          const isActive = option.value === selected;
          return (
            <Pressable
              key={option.value}
              style={s.item}
              onPress={() => onSelect(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
            >
              <Text
                style={[
                  Typography.bodyRegular,
                  isActive
                    ? { color: colors.primary, fontWeight: '700' }
                    : { color: colors.textSecondary },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const PickerColumn = memo(PickerColumnInner) as typeof PickerColumnInner;

interface BirthdayColumnsProps {
  draft: BirthdayDraft;
  onChange: (draft: BirthdayDraft) => void;
}

export const BirthdayColumns: React.FC<BirthdayColumnsProps> = ({ draft, onChange }) => {
  const { t } = useTranslation();
  const years = useMemo(
    () => getBirthdayYears().map((year) => ({ value: year, label: t('profileFields.year', { year }) })),
    [t],
  );
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => index + 1).map((month) => ({
        value: month,
        label: t('profileFields.month', { month }),
      })),
    [t],
  );
  const days = useMemo(
    () =>
      Array.from({ length: getDaysInMonth(draft.year, draft.month) }, (_, index) => index + 1).map(
        (day) => ({ value: day, label: t('profileFields.day', { day }) }),
      ),
    [draft.month, draft.year, t],
  );

  return (
    <View style={s.columns}>
      <PickerColumn
        options={years}
        selected={draft.year}
        onSelect={(year) => onChange(updateBirthdayDraft(draft, { year }))}
      />
      <PickerColumn
        options={months}
        selected={draft.month}
        onSelect={(month) => onChange(updateBirthdayDraft(draft, { month }))}
      />
      <PickerColumn
        options={days}
        selected={draft.day}
        onSelect={(day) => onChange(updateBirthdayDraft(draft, { day }))}
      />
    </View>
  );
};

export interface CityDraft {
  region: string;
  city: string;
}

interface CityColumnsProps {
  draft: CityDraft;
  onChange: (draft: CityDraft) => void;
}

const REGION_OPTIONS = CITY_PROVINCES.map((region) => ({
  value: region.name,
  label: region.name,
}));

export const CityColumns: React.FC<CityColumnsProps> = ({ draft, onChange }) => {
  const region =
    CITY_PROVINCES.find((item) => item.name === draft.region) ?? CITY_PROVINCES[0];
  const cityOptions = useMemo(
    () => region.cities.map((city) => ({ value: city, label: city })),
    [region],
  );

  return (
    <View style={s.columns}>
      <PickerColumn
        options={REGION_OPTIONS}
        selected={region.name}
        onSelect={(name) => {
          const next = CITY_PROVINCES.find((item) => item.name === name) ?? CITY_PROVINCES[0];
          // 换省时原来的城市不在新省里,就落到新省第一个城市。
          onChange({
            region: next.name,
            city: next.cities.includes(draft.city) ? draft.city : next.cities[0] ?? '',
          });
        }}
      />
      <PickerColumn
        options={cityOptions}
        selected={draft.city}
        onSelect={(city) => onChange({ region: region.name, city })}
      />
    </View>
  );
};
