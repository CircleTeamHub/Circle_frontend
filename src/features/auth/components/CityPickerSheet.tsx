import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import {
  CITY_PROVINCES,
  findProvinceByCity,
} from '@/features/profile/city-options';
import { Radius, Spacing } from '@/theme';
import { useOnboardingStyles } from '../hooks/use-onboarding-styles';

interface CityPickerSheetProps {
  visible: boolean;
  /** The currently committed city; seeds the draft each time the sheet opens. */
  initialCity: string;
  onClose: () => void;
  onConfirm: (city: string) => void;
}

const s = StyleSheet.create({
  modalCard: {
    height: '82%',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    gap: Spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  pickerColumns: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  pickerColumn: {
    flex: 1,
  },
  pickerList: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  pickerListContent: {
    paddingVertical: Spacing.xs,
  },
  pickerItem: {
    minHeight: 46,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

/**
 * WeChat-style province → city bottom-sheet picker. Owns its draft selection so
 * the parent only learns the chosen city on confirm; cancel discards the draft.
 */
export function CityPickerSheet({
  visible,
  initialCity,
  onClose,
  onConfirm,
}: CityPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const d = useOnboardingStyles();

  const [draftRegion, setDraftRegion] = useState(
    () => findProvinceByCity(initialCity).name,
  );
  const [draftValue, setDraftValue] = useState(() => initialCity.trim());

  // Re-seed the draft from the committed city every time the sheet opens, so a
  // cancelled edit never leaks into the next open.
  useEffect(() => {
    if (!visible) return;
    const region = findProvinceByCity(initialCity);
    setDraftRegion(region.name);
    setDraftValue(initialCity.trim() || region.cities[0] || '');
  }, [visible, initialCity]);

  const region = useMemo(
    () =>
      CITY_PROVINCES.find((item) => item.name === draftRegion) ??
      CITY_PROVINCES[0],
    [draftRegion],
  );
  const cityOptions = region.cities;

  function handleConfirm() {
    onConfirm(draftValue.trim() || cityOptions[0] || '');
  }

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      backdropStyle={d.modalBackdrop}
      sheetStyle={[
        s.modalCard,
        d.modalCard,
        { paddingBottom: insets.bottom + Spacing.lg },
      ]}
    >
      <View style={s.modalHeader}>
        <Pressable onPress={onClose}>
          <Text style={d.actionText}>{t('common.cancel')}</Text>
        </Pressable>
        <Text style={d.modalTitle}>{t('profileFields.selectProvince')}</Text>
        <Pressable onPress={handleConfirm}>
          <Text style={d.actionText}>{t('common.confirm')}</Text>
        </Pressable>
      </View>

      <View style={s.pickerColumns}>
        <View style={s.pickerColumn}>
          <ScrollView
            style={[s.pickerList, d.pickerList]}
            contentContainerStyle={s.pickerListContent}
            showsVerticalScrollIndicator={false}
          >
            {CITY_PROVINCES.map((item) => {
              const isActive = draftRegion === item.name;
              return (
                <Pressable
                  key={item.name}
                  style={s.pickerItem}
                  onPress={() => {
                    setDraftRegion(item.name);
                    if (!item.cities.includes(draftValue)) {
                      setDraftValue(item.cities[0] ?? '');
                    }
                  }}
                >
                  <Text
                    style={[
                      d.pickerItemText,
                      isActive ? d.pickerItemTextActive : null,
                    ]}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={s.pickerColumn}>
          <ScrollView
            style={[s.pickerList, d.pickerList]}
            contentContainerStyle={s.pickerListContent}
            showsVerticalScrollIndicator={false}
          >
            {cityOptions.map((option) => {
              const isActive = draftValue === option;
              return (
                <Pressable
                  key={option}
                  style={s.pickerItem}
                  onPress={() => setDraftValue(option)}
                >
                  <Text
                    style={[
                      d.pickerItemText,
                      isActive ? d.pickerItemTextActive : null,
                    ]}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </BottomSheetModal>
  );
}
