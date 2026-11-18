import {
  buildNoteSendTasks,
  type ImportedNoteChatMedia,
  type NoteSendOptions,
  type NoteSendTask,
  noteSendWindowDelayMs,
  recordNoteSendAttempt,
  resolveSendableNoteLocation,
  sectionsToImport,
} from '@/features/chat/utils/note-batch-send';
import { buildNoteCardPayloadFromSummary } from '@/features/chat/utils/note-card-payload';
import {
  sendCardMessage,
  sendImageMessage,
  sendLocationMessage,
  sendVideoMessage,
} from '@/chat-core/client';
import { startChatSend } from '@/chat-core/send-handle';
import { reportChatSendFailure } from '@/chat-core/send-errors';
import { uploadChatVideoPoster } from '@/features/chat/utils/chat-video-poster';
import type { NoteDetail, NoteSummary } from '@/features/notes/types';
import { withThumbnailTimeout } from '@/features/notes/utils/thumbnail-timeout';
import { reportHandledFailure } from '@/observability/report-failure';
import { fetchNoteDetail, importNoteChatMedia } from '@/services/api/notes';
import { devWarn } from '@/utils/dev-log';

/**
 * 从笔记的远端视频现截一帧要先把视频拉下来一截,大视频在弱网下能拖十几秒。封面可有可无
 * (气泡没封面时会在本机补截一帧),所以每条最多等这么久,超时就不带封面照发。
 */
const NOTE_VIDEO_POSTER_TIMEOUT_MS = 10_000;

/**
 * 服务端拷进聊天的笔记视频不带封面(笔记里本来也没存),直接发出去气泡是一块黑。
 * 按笔记媒体 id 找到笔记里这条视频的签名地址,截一帧传到自己的 chat/ 目录当封面。
 * 拉不到详情、截帧失败或超时都返回 undefined:视频照常发,只是没有封面。
 */
async function captureNoteVideoPoster(
  task: Extract<NoteSendTask, { kind: 'video' }>,
  detail: Promise<NoteDetail | null>,
): Promise<string | undefined> {
  const source = await detail;
  const url = source?.media.find((media) => media.id === task.mediaId)?.url;
  if (!url) return undefined;
  let abandoned = false;
  const poster = await withThumbnailTimeout(
    uploadChatVideoPoster(
      url,
      task.duration,
      task.key.split('/').pop() ?? 'video',
      'chat',
      // The capture keeps running after the timeout; one that lands late must not
      // upload a poster no message will ever reference.
      () => {
        if (abandoned) throw new Error('Note video poster abandoned after timeout');
      },
    ),
    () => undefined,
    NOTE_VIDEO_POSTER_TIMEOUT_MS,
  );
  abandoned = true;
  return poster?.key;
}

export interface SendNotesToConversationInput {
  conversationId: string;
  notes: readonly NoteSummary[];
  options: NoteSendOptions;
  /** 笔记摘要没带作者时用它(当前登录用户)兜底。 */
  ownerId: string | null;
  /** 滚动限流窗口,跨批次复用同一个(用户级 20 条/10s 的发送桶)。 */
  sendTimestamps: { current: number[] };
  /** 返回 false 就停发剩余任务(离开会话、关掉面板)。 */
  isActive: () => boolean;
}

export interface SendNotesToConversationResult {
  failures: number;
  firstError: unknown;
  /** 确认送达的条数:一条都没送达时,调用方不该再单独把附言发过去。 */
  sent: number;
}

/**
 * 把笔记按勾选的分块发到一个会话:每条笔记按 卡片 → 图片·视频/展示 → 地址 展开;
 * 媒体先经 POST /note/:id/chat-media 由服务端拷进自己的 chat/ 命名空间(发送校验
 * 只认发送者自己的 key),地址只在笔记详情里,摘要拿不到坐标时按需拉详情。
 *
 * 一条笔记拷完就开始发,视频各自截完封面就发,不等整批都准备好 —— 大视频的封面要好几秒,
 * 等齐了再发的话第一条消息要很久才出现,用户会以为没发出去。笔记详情(封面要用里面的
 * 视频地址)和服务端拷贝同时进行。
 * 单条失败不中断整批,失败数和首个错误交给调用方汇总提示。
 */
export async function sendNotesToConversation({
  conversationId,
  notes,
  options,
  ownerId,
  sendTimestamps,
  isActive,
}: SendNotesToConversationInput): Promise<SendNotesToConversationResult> {
  const sections = sectionsToImport(options);
  let failures = 0;
  let firstError: unknown = null;
  let sent = 0;

  // 进了发送队列就接着排下一条,不逐条等送达:断线时队列会等重连(最长一分钟),
  // 逐条等的话一批几十条要一分钟一分钟地挨个超时。节奏照旧按进队时刻控制,
  // 失败等全部有了结果再汇总。
  const deliveries: Promise<void>[] = [];
  const recordFailure = (kind: NoteSendTask['kind'], error: unknown) => {
    failures += 1;
    firstError ??= error;
    reportChatSendFailure(kind, error);
    devWarn('[ChatDetail] note batch send failed', error);
  };

  const sendTask = async (task: NoteSendTask) => {
    while (isActive()) {
      const now = Date.now();
      const delay = noteSendWindowDelayMs(sendTimestamps.current, now);
      if (delay <= 0) {
        sendTimestamps.current = recordNoteSendAttempt(sendTimestamps.current, now);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (!isActive()) return;
    const handle = startChatSend((onCreate) => {
      switch (task.kind) {
        case 'note-card':
          return sendCardMessage({
            conversationId,
            type: 'note-card',
            payload: {
              ...buildNoteCardPayloadFromSummary(task.note, task.note.ownerId ?? ownerId),
              ownerId: task.note.ownerId ?? ownerId,
            },
            onCreate,
          });
        case 'image':
          return sendImageMessage({
            conversationId,
            key: task.key,
            width: task.width,
            height: task.height,
            onCreate,
          });
        case 'video':
          return sendVideoMessage({
            conversationId,
            key: task.key,
            thumbKey: task.thumbKey,
            width: task.width,
            height: task.height,
            duration: task.duration,
            size: task.size,
            onCreate,
          });
        case 'location':
          return sendLocationMessage({
            conversationId,
            latitude: task.latitude,
            longitude: task.longitude,
            title: task.title,
            address: task.address,
            onCreate,
          });
      }
    });
    if (handle.queued) {
      deliveries.push(
        handle.delivered.then(
          () => {
            sent += 1;
          },
          (error: unknown) => recordFailure(task.kind, error),
        ),
      );
      return;
    }
    try {
      await handle.delivered;
      sent += 1;
    } catch (error) {
      recordFailure(task.kind, error);
    }
  };

  for (const note of notes) {
    if (!isActive()) break;
    // mediaCount=0 的笔记没有任何可拷对象,别浪费服务端 20 次/分钟的拷贝配额。
    const copiesMedia = sections.length > 0 && note.mediaCount > 0;
    // 视频封面要用笔记里的视频地址:和拷贝同时拉详情,不让两者排队。没有视频就不拉。
    // 失败记成 null:封面可有可无,视频照常发。
    const posterSource: Promise<NoteDetail | null> =
      copiesMedia && note.videoCount > 0
        ? fetchNoteDetail(note.id).catch((error: unknown) => {
            reportHandledFailure('chatDetail', 'fetchNoteVideoPosterSource', error);
            return null;
          })
        : Promise.resolve(null);

    let imported: ImportedNoteChatMedia[] = [];
    if (copiesMedia) {
      try {
        const importedResult = await importNoteChatMedia(note.id, sections);
        failures += importedResult.failedCount ?? 0;
        imported = importedResult.items;
      } catch (error) {
        failures += 1;
        firstError ??= error;
        reportHandledFailure('chatDetail', 'importNoteMedia', error);
      }
    }
    let location = note.sections?.location ?? null;
    if (
      options.location &&
      !resolveSendableNoteLocation(location) &&
      // 摘要只带 hasLocation 布尔;明确没有地址的笔记不值得为它拉详情。
      note.hasLocation !== false
    ) {
      try {
        location = (await fetchNoteDetail(note.id)).sections?.location ?? null;
      } catch (error) {
        // 拉不到详情=这条的地址发不出去。必须计入失败,否则「只勾了地址,
        // 网络一抖」会变成什么都没发还零提示的静默丢失。
        failures += 1;
        firstError ??= error;
        location = null;
        reportHandledFailure('chatDetail', 'fetchNoteLocation', error);
      }
    }

    for (const task of buildNoteSendTasks(note, options, imported, location)) {
      if (!isActive()) break;
      if (task.kind === 'video') {
        // 逐条截:每次都要起一个解码器,并发起来手机吃不消。
        const thumbKey = await captureNoteVideoPoster(task, posterSource);
        if (!isActive()) break;
        await sendTask(thumbKey ? { ...task, thumbKey } : task);
      } else {
        await sendTask(task);
      }
    }
  }

  await Promise.all(deliveries);
  return { failures, firstError, sent };
}
