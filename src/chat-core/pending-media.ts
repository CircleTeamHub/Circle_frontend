import { Platform } from 'react-native';
import type * as NativeFS from 'react-native-fs';
import { reportHandledFailure } from '@/observability/report-failure';

/**
 * 还没发出去的聊天媒体(语音/图片/视频)的持久副本(原生档;web 见 pending-media.web.ts)。
 *
 * 媒体是「先上屏、后上传」:上传完成之前服务端没有这条消息,outbox 里也没有
 * object key 可以重发。原来重试闭包只活在内存里,App 被杀,红气泡和那段录音/
 * 那张图一起消失。现在点发送时把源文件拷进持久目录,outbox 记下文件名,
 * 重启后失败气泡照常还原,长按重发从这份副本重新上传。
 *
 * 为什么要拷而不是记住原路径:picker 与录音文件都在缓存目录,设置页「清除缓存」
 * 和系统低存储回收都会清掉它们。拷贝走 react-native-fs 的原生异步接口,不占 JS
 * 线程;iOS 的 APFS 上同卷拷贝是克隆,不额外占空间。
 *
 * 目录按账号分:`Documents/chat-outbox/<userId>/<d>/<文件名>`。一条消息一个子目录,
 * 删除时只凭 d 就能删干净(不必知道当初的文件名);iOS 上整个根目录排除出 iCloud
 * 备份(#88 同款)—— 这是用户还没发出去的私人照片和录音。
 *
 * ⚠️ 导出面必须与 pending-media.web.ts 保持一致(Metro 按平台择档,tsc 两份都查)。
 */

const ROOT_DIR_NAME = 'chat-outbox';
/** 冷启动清孤儿时不碰最近这么久内建的目录:可能是本次启动刚点的发送。 */
const PRUNE_GRACE_MS = 10 * 60_000;

type NativeFSModule = typeof NativeFS & { default?: typeof NativeFS };

function loadNativeFS(): typeof NativeFS {
  // 与 services/api/upload 同款懒加载:把 react-native-fs 挡在 web/静态渲染路径之外。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require('react-native-fs') as NativeFSModule;
  return loaded.default ?? loaded;
}

/**
 * 本进程里正在拷贝/发送的 d → 发起它的登录会话(authStore.sessionEpoch)。
 * 清孤儿时一律跳过,哪怕目录已经过了宽限期;登出清理只跳过比被清会话更新的
 * 会话发起的(见 clearPendingMediaFiles)。
 */
const activeDeliveries = new Map<string, number>();

function rootPath(RNFS: typeof NativeFS): string {
  return `${RNFS.DocumentDirectoryPath}/${ROOT_DIR_NAME}`;
}

function isSafeSegment(segment: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(segment);
}

function deliveryPath(RNFS: typeof NativeFS, userId: string, d: string): string {
  return `${rootPath(RNFS)}/${userId}/${d}`;
}

function toFilePath(uri: string): string | null {
  if (uri.startsWith('file://')) {
    try {
      return decodeURIComponent(uri.slice('file://'.length));
    } catch {
      return uri.slice('file://'.length);
    }
  }
  return uri.startsWith('/') ? uri : null;
}

/** 副本的文件名:保留扩展名(AVPlayer 靠它认格式),其余字符收窄成安全子集。 */
export function pendingMediaFileName(uploadName: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(uploadName);
  return match ? `media.${match[1].toLowerCase()}` : 'media';
}

/**
 * 把源文件拷进持久目录,返回副本文件名;拷不了(web 地址、content://、磁盘满)
 * 返回 null —— 发送照常进行,只是 App 被杀后这条没法恢复,和改造前一样。
 */
export async function persistPendingMediaFile(
  userId: string,
  d: string,
  sourceUri: string,
  uploadName: string,
  sessionEpoch: number,
): Promise<string | null> {
  const sourcePath = toFilePath(sourceUri);
  if (!sourcePath || !isSafeSegment(userId) || !isSafeSegment(d)) return null;
  activeDeliveries.set(d, sessionEpoch);
  try {
    const RNFS = loadNativeFS();
    const root = rootPath(RNFS);
    await RNFS.mkdir(
      root,
      Platform.OS === 'ios' ? { NSURLIsExcludedFromBackupKey: true } : undefined,
    );
    const directory = deliveryPath(RNFS, userId, d);
    await RNFS.mkdir(directory);
    const fileName = pendingMediaFileName(uploadName);
    const target = `${directory}/${fileName}`;
    if (await RNFS.exists(target)) await RNFS.unlink(target);
    await RNFS.copyFile(sourcePath, target);
    return fileName;
  } catch (error) {
    reportHandledFailure('chatOutbox', 'persistPendingMedia', error);
    return null;
  }
}

/** 副本还在就给出可直接渲染/上传的 file:// 地址。容器路径每次启动都可能变,只能现拼。 */
export async function resolvePendingMediaUri(
  userId: string,
  d: string,
  fileName: string,
): Promise<string | null> {
  if (!isSafeSegment(userId) || !isSafeSegment(d) || fileName.includes('/')) {
    return null;
  }
  try {
    const RNFS = loadNativeFS();
    const path = `${deliveryPath(RNFS, userId, d)}/${fileName}`;
    return (await RNFS.exists(path)) ? `file://${path}` : null;
  } catch {
    return null;
  }
}

/** 发出去了或者不要了:整个 d 子目录删掉。失败吞掉,下次冷启动清孤儿会再删。 */
export async function deletePendingMedia(userId: string, d: string): Promise<void> {
  activeDeliveries.delete(d);
  if (!isSafeSegment(userId) || !isSafeSegment(d)) return;
  try {
    const RNFS = loadNativeFS();
    const directory = deliveryPath(RNFS, userId, d);
    if (await RNFS.exists(directory)) await RNFS.unlink(directory);
  } catch {
    // 清理不成功最多留一个孤儿目录,不该把发送弄失败。
  }
}

/**
 * 冷启动对账:删掉 outbox 里已经没人引用的副本(发送成功时删失败、消息被删除、
 * 阅后即焚清理、「清空全部聊天」都会留下这种目录)。
 */
export async function prunePendingMedia(
  userId: string,
  referencedDeliveries: ReadonlySet<string>,
): Promise<void> {
  if (!isSafeSegment(userId)) return;
  try {
    const RNFS = loadNativeFS();
    const directory = `${rootPath(RNFS)}/${userId}`;
    if (!(await RNFS.exists(directory))) return;
    const now = Date.now();
    for (const entry of await RNFS.readDir(directory)) {
      if (referencedDeliveries.has(entry.name)) continue;
      if (activeDeliveries.has(entry.name)) continue;
      const modifiedAt = entry.mtime?.getTime() ?? 0;
      if (now - modifiedAt < PRUNE_GRACE_MS) continue;
      try {
        await RNFS.unlink(entry.path);
      } catch {
        // 单个删不掉不影响其余清理。
      }
    }
  } catch (error) {
    reportHandledFailure('chatOutbox', 'prunePendingMedia', error);
  }
}

/**
 * 登出:刚登出账号还没发出去的照片/录音不留在设备上。
 *
 * clearedSessionEpoch 是 clearSession 之后的会话编号。只跳过比它更新的会话发起的
 * 发送(登出被抢占、清理跑到一半时新会话刚点的发送);被登出的会话自己的一律删,
 * 包括上传失败、红气泡还留着的 —— 原来凡是「进行中」的都跳过,那种照片就留在了
 * 设备上。
 *
 * 不只清刚登出的账号:换账号一律先走完整的登出清理,按设计此刻不该有别的账号的
 * 待发副本,真留下的(那次清理删失败)也是本该删掉的残留。
 */
export async function clearPendingMediaFiles(
  clearedSessionEpoch: number,
): Promise<void> {
  try {
    const RNFS = loadNativeFS();
    const root = rootPath(RNFS);
    if (!(await RNFS.exists(root))) return;
    for (const account of await RNFS.readDir(root)) {
      if (!account.isDirectory()) {
        await RNFS.unlink(account.path).catch(() => undefined);
        continue;
      }
      for (const delivery of await RNFS.readDir(account.path)) {
        const startedIn = activeDeliveries.get(delivery.name);
        if (startedIn !== undefined && startedIn > clearedSessionEpoch) continue;
        activeDeliveries.delete(delivery.name);
        await RNFS.unlink(delivery.path).catch(() => undefined);
      }
    }
  } catch (error) {
    reportHandledFailure('chatOutbox', 'clearPendingMedia', error);
  }
}
