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
import type { NoteSummary } from '@/features/notes/types';
import { reportHandledFailure } from '@/observability/report-failure';
import { fetchNoteDetail, importNoteChatMedia } from '@/services/api/notes';
import { devWarn } from '@/utils/dev-log';

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

  const perNote: NoteSendTask[][] = [];
  for (const note of notes) {
    if (!isActive()) return { failures, firstError, sent };
    let imported: ImportedNoteChatMedia[] = [];
    // mediaCount=0 的笔记没有任何可拷对象,别浪费服务端 20 次/分钟的拷贝配额。
    if (sections.length > 0 && note.mediaCount > 0) {
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
    perNote.push(buildNoteSendTasks(note, options, imported, location));
  }

  const tasks = perNote.flat();
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
  for (let i = 0; i < tasks.length; i += 1) {
    if (!isActive()) return { failures, firstError, sent };
    while (isActive()) {
      const now = Date.now();
      const delay = noteSendWindowDelayMs(sendTimestamps.current, now);
      if (delay <= 0) {
        sendTimestamps.current = recordNoteSendAttempt(
          sendTimestamps.current,
          now,
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (!isActive()) return { failures, firstError, sent };
    const task = tasks[i];
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
    } else {
      try {
        await handle.delivered;
        sent += 1;
      } catch (error) {
        recordFailure(task.kind, error);
      }
    }
  }
  await Promise.all(deliveries);
  return { failures, firstError, sent };
}
