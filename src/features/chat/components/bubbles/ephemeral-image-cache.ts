import { useEffect } from 'react';
import { Image } from 'expo-image';
import { storage } from '@/storage';

/**
 * 「在这个焚毁策略下已经清过一次磁盘缓存」的记录(最近几个策略指纹)。
 *
 * 必须落盘、且记的是跨冷启动稳定的策略指纹(见 useChatConversation 的
 * selfDestructCacheKey):原来记在内存里、用的是每次冷启动都从 0 重新数的策略编号,
 * 结果每次打开 App、第一次看到阅后即焚图片就把所有图片的磁盘缓存清空重下。
 * 键名沿用图片气泡最早的那个,已经记下的策略升级后照样认。
 */
const CLEARED_POLICIES_STORAGE_KEY = 'chat.imageDiskCacheClearedPolicies';
const CLEARED_POLICIES_MAX = 50;
/** 同一个策略的清理正在进行:一屏多个阅后即焚气泡同时挂载时只清一次。 */
const clearingPolicies = new Set<string>();

function readClearedPolicies(): string[] {
  try {
    const raw = storage.getString(CLEARED_POLICIES_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function rememberClearedPolicy(policy: string): void {
  try {
    const next = [
      policy,
      ...readClearedPolicies().filter((item) => item !== policy),
    ].slice(0, CLEARED_POLICIES_MAX);
    storage.set(CLEARED_POLICIES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 记不下来只会让下次再清一遍,不影响正确性。
  }
}

/**
 * 阅后即焚气泡挂载时,在每个新的焚毁策略下清一次图片磁盘缓存。
 *
 * expo-image 不能按 URI 移除已落盘的内容:开启焚毁之前按普通图片落盘的聊天图片、
 * 视频封面,只能整体清一次,之后的内存缓存策略才不会被绕过。图片气泡和视频气泡都要
 * 挂上 —— 只挂在图片上的话,只发视频的会话开启焚毁以后,之前的封面会一直留在磁盘上。
 * 清完才记下:清到一半被杀掉的话下次还会再清。
 */
export function useEphemeralImageDiskCacheSweep(
  ephemeral: boolean,
  selfDestructCacheKey: string,
): void {
  useEffect(() => {
    if (!ephemeral || !selfDestructCacheKey) return;
    const policy = selfDestructCacheKey;
    if (
      clearingPolicies.has(policy) ||
      readClearedPolicies().includes(policy)
    ) {
      return;
    }
    clearingPolicies.add(policy);
    void Image.clearDiskCache()
      .then(() => rememberClearedPolicy(policy))
      .catch(() => undefined)
      .finally(() => clearingPolicies.delete(policy));
    void Image.clearMemoryCache().catch(() => undefined);
  }, [ephemeral, selfDestructCacheKey]);
}
