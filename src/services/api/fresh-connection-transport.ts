import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { FreshConnectionTransport } from '@/services/api/client';

type NativeGetResult = { status: number; headers: Record<string, string>; body: string };
type FreshConnectionNativeModule = {
  get(url: string, headers: Record<string, string>, timeoutMs: number): Promise<NativeGetResult>;
};

/**
 * 安卓上卡住的 GET 的备份请求通道：走 modules/fresh-connection 的独立连接池，一定是新连接
 * （为什么需要它见 client.ts 的 registerFreshConnectionTransport）。
 * iOS / web 不需要；还没有这个原生模块的旧包（OTA 只换了 JS）返回 null，备份照常走 fetch。
 */
export function createFreshConnectionTransport(): FreshConnectionTransport | null {
  if (Platform.OS !== 'android') return null;
  const native = requireOptionalNativeModule<FreshConnectionNativeModule>('FreshConnection');
  if (!native) return null;
  return async (url, { headers, timeoutMs }) => {
    const result = await native.get(url, headers, timeoutMs);
    return new Response(result.body.length > 0 ? result.body : null, {
      status: result.status,
      headers: result.headers,
    });
  };
}
