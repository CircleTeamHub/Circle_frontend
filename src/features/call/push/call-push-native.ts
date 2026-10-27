import { Platform } from 'react-native';
import Constants from 'expo-constants';
import CallPush, {
  type CallPushNativeModule,
} from '../../../../modules/call-push';

/** 推送载荷协议版本，与 circle_be 的 CALL_PUSH_VERSION 对齐；登记 token 时声明。 */
export const CALL_PUSH_VERSION = 1;

/**
 * 没重新打原生包的安装（OTA 先到）、Web 都没有原生模块：整条推送来电链路降级为只靠 WS，
 * 行为与之前完全一样。
 */
export function getCallPushModule(): CallPushNativeModule | null {
  return Platform.OS === 'web' ? null : (CallPush ?? null);
}

export function supportsCallPush(): boolean {
  return getCallPushModule() !== null;
}

export type IosCallMode = 'callkit' | 'notification';

/**
 * iOS 来电走哪条路，构建期决定（app.config.js 的 EXPO_PUBLIC_IOS_CALL_MODE），不做运行时
 * 地区判断：callkit = PushKit + CallKit（默认）；notification = 将来的中国区包，CallKit 已被
 * 编译出去，来电是服务端经极光发的 time-sensitive 通知，点开后在应用内接听。
 */
export function iosCallMode(): IosCallMode {
  const configured = (Constants.expoConfig?.extra as { iosCallMode?: unknown } | undefined)
    ?.iosCallMode;
  return configured === 'notification' ? 'notification' : 'callkit';
}

/** iOS 走 PushKit 的 VoIP 推送（要单独登记 VoIP token）。 */
export function usesVoipPush(): boolean {
  return Platform.OS === 'ios' && supportsCallPush() && iosCallMode() === 'callkit';
}

/** iOS 的来电界面交给 CallKit（锁屏、前台都是系统界面），应用内来电弹窗不再出现。 */
export function nativeOwnsIncomingCallUi(): boolean {
  return usesVoipPush();
}

/**
 * 这台设备的极光 token 是否同时承载来电：安卓（透传 + 全屏通知），以及通知模式的 iOS
 * （time-sensitive 通知）。CallKit 模式的 iOS 绝不能声明 —— 它的来电走 VoIP token，
 * 两边都声明会响两次。
 */
export function jpushCarriesCalls(): boolean {
  if (!supportsCallPush()) return false;
  if (Platform.OS === 'android') return true;
  return Platform.OS === 'ios' && iosCallMode() === 'notification';
}
