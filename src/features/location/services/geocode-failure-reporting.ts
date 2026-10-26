import { reportHandledFailure } from '@/observability/report-failure';
import type { GeocodeFailureStage } from './reverse-geocode';

/**
 * 地名反查链路里被吞掉的失败 → reportHandledFailure（operation / kind 是字面量）。
 *
 * reverse-geocode.ts 要在纯 node 下跑测试，不能 import 观测层，所以由调用方把这个
 * 函数作为 onFailure 传进 resolvePlace。
 */

/**
 * 设备根本没有反查能力，不算故障：web 端 expo-location 抛 UnavailabilityError
 * （ERR_UNAVAILABLE），国内无 GMS 的 Android 机抛 NoGeocodeException（ERR_NO_GEOCODE）。
 * 报上去每次打开位置消息都是一条噪音，链路本来就会改问服务端。
 */
const PLATFORM_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'ERR_UNAVAILABLE',
  'ERR_NO_GEOCODE',
]);

function isPlatformUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && PLATFORM_UNAVAILABLE_CODES.has(code);
}

export function reportGeocodeFailure(stage: GeocodeFailureStage, error: unknown): void {
  if (stage === 'nativeResolver') {
    if (isPlatformUnavailable(error)) return;
    reportHandledFailure('location', 'nativeReverseGeocode', error);
  } else if (stage === 'geocoderConfig') {
    reportHandledFailure('location', 'geocoderConfig', error);
  } else {
    reportHandledFailure('location', 'reverseGeocode', error);
  }
}
