import type * as SecureStoreModule from 'expo-secure-store';

/**
 * SecureStore 的平台间接层（原生档）。
 *
 * secure-auth-storage 的全部凭证读写走这里拿实现：原生仍是懒加载的
 * expo-secure-store（把原生模块初始化挡在启动关键路径之外，行为与
 * 之前直接 import 完全一致）；Web 由 secure-kv.web.ts 换成 localStorage
 * 档。降级读、互斥队列、多账号 token 等上层逻辑两端共用，不做分叉。
 *
 * ⚠️ 与 secure-kv.web.ts 的导出面必须保持一致（Metro 按平台择档，
 * tsc 两份都查）。
 */
export type SecureKvApi = Pick<
  typeof SecureStoreModule,
  | 'getItemAsync'
  | 'setItemAsync'
  | 'deleteItemAsync'
  | 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY'
>;

let modulePromise: Promise<SecureKvApi> | null = null;

export function getSecureKv(): Promise<SecureKvApi> {
  modulePromise ??= import('expo-secure-store');
  return modulePromise;
}
