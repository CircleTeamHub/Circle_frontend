import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapLocationPickerScreen } from '@/features/location/components/map-location-picker-screen';
import type { PickedLocation } from '@/features/location/types';
import { useChatLocationPickerStore } from '@/features/chat/store/use-chat-location-picker-store';

export default function ChatLocationPickerScreen() {
  const { t } = useTranslation();
  // 选点结果绑定发起它的会话；深链直接进来时这里是 undefined，结果就谁也消费不了。
  const { conversationID } = useLocalSearchParams<{ conversationID?: string }>();
  const setPickedLocation = useChatLocationPickerStore(
    (state) => state.setPickedLocation,
  );
  const labels = useMemo(
    () => ({
      title: t('chat.locationPicker.title', { defaultValue: '选择位置' }),
      searchPlaceholder: t('chat.locationPicker.searchPlaceholder', {
        defaultValue: '搜索地点',
      }),
      searchButton: t('common.search', { defaultValue: '搜索' }),
      confirmButton: t('chat.locationPicker.send', { defaultValue: '发送位置' }),
      selectedLabel: t('chat.locationPicker.selectedLabel', {
        defaultValue: '已选择位置',
      }),
      invalidTitle: t('chat.locationPicker.invalidTitle', {
        defaultValue: '位置无效',
      }),
      invalidMessage: t('chat.locationPicker.invalidMessage', {
        defaultValue: '请重新选择位置',
      }),
      unavailableMessage: t('location.mapUnavailable', {
        defaultValue: '地图加载失败，请检查网络后重试',
      }),
      retryButton: t('common.retry', { defaultValue: '重试' }),
    }),
    [t],
  );
  const handleConfirm = useCallback(
    (location: PickedLocation) => {
      setPickedLocation(
        location,
        typeof conversationID === 'string' && conversationID
          ? conversationID
          : null,
      );
      router.back();
    },
    [conversationID, setPickedLocation],
  );

  return (
    <MapLocationPickerScreen
      labels={labels}
      onBack={() => router.back()}
      onConfirm={handleConfirm}
    />
  );
}
