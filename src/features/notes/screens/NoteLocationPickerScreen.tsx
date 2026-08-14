import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapLocationPickerScreen } from '@/features/location/components/map-location-picker-screen';
import type { PickedLocation } from '@/features/location/types';
import { useNoteLocationPickerStore } from '@/features/notes/store/use-note-location-picker-store';

export default function NoteLocationPickerScreen() {
  const { t } = useTranslation();
  const setPickedLocation = useNoteLocationPickerStore(
    (state) => state.setPickedLocation,
  );
  const labels = useMemo(
    () => ({
      title: t('notes.location.selectTitle', { defaultValue: '选择位置' }),
      searchPlaceholder: t('notes.location.searchPlaceholder', {
        defaultValue: '搜索地点',
      }),
      searchButton: t('common.search', { defaultValue: '搜索' }),
      confirmButton: t('notes.location.usePlace', {
        defaultValue: '使用这个位置',
      }),
      selectedLabel: t('notes.location.selectedLabel', {
        defaultValue: '已选择位置',
      }),
      invalidTitle: t('notes.location.invalidTitle', {
        defaultValue: '位置无效',
      }),
      invalidMessage: t('notes.location.invalidMsg', {
        defaultValue: '请重新选择位置',
      }),
    }),
    [t],
  );
  const handleConfirm = useCallback(
    (location: PickedLocation) => {
      setPickedLocation(location);
      router.back();
    },
    [setPickedLocation],
  );

  return (
    <MapLocationPickerScreen
      labels={labels}
      onBack={() => router.back()}
      onConfirm={handleConfirm}
    />
  );
}
