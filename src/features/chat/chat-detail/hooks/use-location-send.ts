import {
  useChatLocationPickerStore,
} from '@/features/chat/store/use-chat-location-picker-store';
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import { waitForSendSlot } from '@/features/chat/utils/send-slot';
import { sendLocationMessage } from '@/chat-core/client';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import {
  getCreditPolicyMessage,
  getLocalLowCreditDecision,
} from '@/services/api/credit-policy';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { type TFunction } from 'i18next';

export interface LocationSendParams {
  t: TFunction<"translation", undefined>;
  inFlightRef: RefObject<boolean>;
  setSendError: Dispatch<SetStateAction<string | null>>;
  mountedRef: RefObject<boolean>;
  sourceID: string;
  conversationID: string;
  isPreviewMode: boolean;
}

/**
 * 聊天页发送位置:打开选点页(权限、定位)、从选点页回来后发出选中的位置。
 */
export function useLocationSend({
  t,
  inFlightRef,
  setSendError,
  mountedRef,
  sourceID,
  conversationID,
  isPreviewMode,
}: LocationSendParams) {
  const consumePickedLocation = useChatLocationPickerStore(
    (state) => state.consumePickedLocation,
  );
  const clearPickedLocation = useChatLocationPickerStore(
    (state) => state.clearPickedLocation,
  );
  const handleSendPickedLocation = useCallback(async (
    picked: {
      title: string;
      address: string;
      latitude: number;
      longitude: number;
    },
  ) => {
    if (!sourceID || !conversationID || isPreviewMode) return;
    // 位置已经从 store 里消费掉了：这里直接 return 等于把用户选的点悄悄丢掉，
    // 既不发也不报错。等当前这一发结束再补上；真等不到就明确报错。
    if (inFlightRef.current) {
      const slotFree = await waitForSendSlot({
        isBusy: () => inFlightRef.current,
        isMounted: () => mountedRef.current,
      });
      if (!slotFree) {
        if (mountedRef.current) {
          setSendError(
            t('chat.detail.locationSendFailed', {
              defaultValue: '位置发送失败，请重试',
            }),
          );
        }
        return;
      }
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await sendLocationMessage({
        conversationId: conversationID,
        longitude: picked.longitude,
        latitude: picked.latitude,
        title: picked.title,
        address: picked.address,
      });
    } catch (error) {
      if (mountedRef.current) {
        setSendError(
          getChatSendErrorMessage(
            error,
            t('chat.detail.locationSendFailed', {
              defaultValue: '位置发送失败，请重试',
            }),
          ),
        );
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [conversationID, isPreviewMode, sourceID, t, inFlightRef, mountedRef, setSendError]);

  const handleOpenLocationPicker = useCallback(async () => {
    if (!sourceID || !conversationID || isPreviewMode) return;
    // 在申请精确定位权限前先走本地发送门禁；注定不能发时不读取隐私数据。
    const creditDenied = getLocalLowCreditDecision();
    if (creditDenied) {
      setSendError(getCreditPolicyMessage(creditDenied));
      return;
    }
    // 选点页自己支持搜索和手动拖动，定位权限只是用来把地图中心预置到「我的
    // 位置」。拒权就直接开图（用页面自带的默认中心），不能因此把分享公共地点
    // 这件事整个堵死。
    const openPickerAt = (params?: Record<string, string>) => {
      clearPickedLocation();
      router.push({
        pathname: '/(chat)/location-picker',
        // conversationID 一路带过去：确认的结果只有回到这个会话才会被消费。
        params: { ...params, conversationID },
      } as never);
    };
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      openPickerAt();
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        // 这个选项默认是 true：拿不到定位时 expo-location 会拉起 Google Play
        // Services 的定位设置弹窗，国内无 GMS 的机器上等于把用户甩去一个装不了
        // 的系统页。关掉它，取点失败就照下面的 catch 用默认中心开图。
        mayShowUserSettingsDialog: false,
      });
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const coordinateText = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      let title = t('chat.locationPicker.currentLocation', {
        defaultValue: '我的位置',
      });
      let address = coordinateText;
      try {
        const places = await Location.reverseGeocodeAsync({ latitude, longitude });
        const place = places[0];
        if (place) {
          title = place.name || place.street || title;
          const parts = [
            place.city ?? place.region,
            place.district ?? place.subregion,
            place.street,
            place.name,
          ].filter((part): part is string => Boolean(part));
          if (parts.length) address = parts.join(' ');
        }
      } catch {
        // 地址解析失败不阻塞选点，地图仍以真实坐标为中心。
      }
      openPickerAt({
        latitude: String(latitude),
        longitude: String(longitude),
        title,
        address,
      });
    } catch {
      // 取当前位置失败同样只影响初始中心：照常开图，让用户自己搜或拖。
      openPickerAt();
    }
  }, [clearPickedLocation, conversationID, isPreviewMode, sourceID, t, setSendError]);

  useFocusEffect(
    useCallback(() => {
      if (!conversationID) return;
      const picked = consumePickedLocation(conversationID);
      if (!picked) return;
      void handleSendPickedLocation(picked);
    }, [consumePickedLocation, conversationID, handleSendPickedLocation]),
  );

  return {
    handleOpenLocationPicker,
  };
}
