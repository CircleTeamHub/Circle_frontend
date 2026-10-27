import { requireOptionalNativeModule } from 'expo';
import type { CallPushNativeModule } from './CallPush.types';

/**
 * 没重新打原生包的安装（OTA 先到）、Web、Expo Go 都没有这个模块：返回 null，
 * 调用方整条推送来电链路降级为只靠 WS。
 */
export default requireOptionalNativeModule<CallPushNativeModule>('CallPush');
