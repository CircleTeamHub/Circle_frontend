import { Platform } from 'react-native';
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

/** iOS 的来电界面交给 CallKit（锁屏、前台都是系统界面），应用内来电弹窗不再出现。 */
export function nativeOwnsIncomingCallUi(): boolean {
  return Platform.OS === 'ios' && supportsCallPush();
}
