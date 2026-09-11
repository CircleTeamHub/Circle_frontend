import { Directory, File, Paths } from 'expo-file-system';
import { normalizeChatBackgroundImage } from '@/features/chat/utils/chat-background-normalize';
import {
  CHAT_BACKGROUND_DIR_NAME,
  CHAT_BACKGROUND_FILE_SCHEME,
  chatBackgroundFileName,
  newChatBackgroundFileName,
} from '@/features/chat/utils/chat-background-uri';

/**
 * 聊天背景图落在设备本地，不进对象存储（原生档；web 见 chat-background-image.web.ts）。
 *
 * 背景偏好只活在 MMKV 里（按设备、按会话），服务端从不读它，所以图片没有任何理由
 * 上传。此前这里走 /upload presign 把图 PUT 到 `chat/` 前缀再存直链，而 circle_be 的
 * buildPublicReadBucketPolicy 白名单里并没有 chat（自研聊天栈落地后刻意摘掉，聊天
 * 媒体一律 presign-on-read）——那条直链对匿名 GET 一律 403，ImageBackground 静默什么
 * 都不画，只剩上面那层蒙版，于是整块消息区变成一片灰。
 *
 * 本地化之后没有 403、没有签名过期、不吃上传配额，也不会把用户自己的壁纸变成一个
 * 拿到 URL 就能读的公开对象。
 *
 * ⚠️ 导出面必须与 chat-background-image.web.ts 保持一致（Metro 按平台择档，tsc 两份
 * 都查）：这边加导出那边要同步补，否则 web 构建在 import 处直接失败。
 */

function backgroundDirectory() {
  const directory = new Directory(Paths.document, CHAT_BACKGROUND_DIR_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/**
 * 把存下来的偏好换成 ImageBackground 能直接吃的 source uri。原生端在这里才拼绝对
 * 路径 —— 容器路径每次启动都可能不同，所以只能现拼，不能存。
 */
export async function resolveChatBackgroundImageSource(
  stored: string | null | undefined,
): Promise<string | null> {
  const name = chatBackgroundFileName(stored);
  if (!name) return null;

  try {
    const file = new File(
      new Directory(Paths.document, CHAT_BACKGROUND_DIR_NAME),
      name,
    );
    // 文件可能已被「清空数据」之类的路径删掉；给不存在的路径会静默画不出东西。
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/**
 * 把用户选的图收进应用的持久目录，返回要存进偏好的值。
 *
 * 目录选 Paths.document 而不是 Paths.cache：picker 给的临时 uri 和缓存目录都会被
 * 「清除缓存」以及系统低存储回收清掉，背景会在某天自己消失。
 */
export async function persistChatBackgroundImage(
  sourceUri: string,
  sourceWidth?: number,
): Promise<string> {
  const normalized = await normalizeChatBackgroundImage(sourceUri, sourceWidth);

  const name = newChatBackgroundFileName();
  const target = new File(backgroundDirectory(), name);
  const produced = new File(normalized.uri);

  // move 而不是 copy：manipulator 的产物落在 cache 里，copy 完不删就等于每换一次
  // 背景在缓存里多压一份同样大小的 JPEG，直到系统哪天回收。
  try {
    produced.move(target);
  } catch {
    // 个别平台/跨卷场景下 move 不可用；退回复制再删源，保持同样的「不留残渣」。
    produced.copy(target);
    try {
      produced.delete();
    } catch {
      // 源删不掉最多留一个缓存副本，系统仍会回收；不该让换背景失败。
    }
  }

  return `${CHAT_BACKGROUND_FILE_SCHEME}${name}`;
}

/**
 * 删掉目录里没人再引用的背景图。换背景和登出都会调；失败一律吞掉——清理不成功
 * 最多是留下一个孤儿文件，不该把换背景或登出弄失败。
 */
export async function pruneChatBackgroundImages(
  referencedUris: readonly string[],
): Promise<void> {
  try {
    const keep = new Set(
      referencedUris
        .map(chatBackgroundFileName)
        .filter((name): name is string => Boolean(name)),
    );
    for (const entry of backgroundDirectory().list()) {
      if (entry instanceof Directory) continue;
      if (keep.has(entry.name)) continue;
      try {
        entry.delete();
      } catch {
        // 单个文件删不掉不影响其余清理。
      }
    }
  } catch {
    // 目录不存在 / 无权限：没有需要清理的东西。
  }
}
