import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useRef,
} from 'react';
import { type NoteSummary } from '@/features/notes/types';
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
import { fetchNoteDetail, importNoteChatMedia } from '@/services/api/notes';
import { reportHandledFailure } from '@/observability/report-failure';
import {
  sendCardMessage,
  sendImageMessage,
  sendLocationMessage,
  sendVideoMessage,
} from '@/chat-core/client';
import { buildNoteCardPayloadFromSummary } from '@/features/chat/utils/note-card-payload';
import { getChatSendErrorMessage, reportChatSendFailure } from '@/chat-core/send-errors';
import { devWarn } from '@/utils/dev-log';
import { type TFunction } from 'i18next';
import { type AuthUser } from '@/stores/authStore';

export interface NoteBatchSendParams {
  t: TFunction<"translation", undefined>;
  authUser: AuthUser | null;
  setSendError: Dispatch<SetStateAction<string | null>>;
  mountedRef: RefObject<boolean>;
  sourceID: string;
  conversationID: string;
  isPreviewMode: boolean;
}

/**
 * 批量发送笔记(分享选择页多选 + 发送选项的执行端):按笔记展开成卡片/媒体/地址,
 * 批与批串行、按服务端限流节奏发,离开会话即停。
 */
export function useNoteBatchSend({
  t,
  authUser,
  setSendError,
  mountedRef,
  sourceID,
  conversationID,
  isPreviewMode,
}: NoteBatchSendParams) {
  // 批量发笔记的串行队列:第二批在上一批发完之前不开跑,避免两次突发叠进
  // 服务端同一个 20 条/10s 的用户级 send 桶(消息触限会被直接拒收)。
  const noteBatchQueueRef = useRef<Promise<void>>(Promise.resolve());
  // 真实滚动窗口跨批保留；批量最多用 17/20 个槽位，余下 3 个留给手动发送。
  const noteSendTimestampsRef = useRef<number[]>([]);
  /**
   * 批量发笔记(SharePicker 多选 + 发送选项 sheet 的执行端)。
   *
   * 每条笔记按 卡片 → 图片·视频/展示 → 地址 的顺序展开;媒体必须先经
   * POST /note/:id/chat-media 由服务端拷进自己的 chat/ 命名空间(发送校验
   * 只认发送者自己的 key)。地址只在笔记详情里,摘要拿不到坐标时按需拉详情。
   *
   * 不整批持有 inFlightRef:大批次能发几分钟,不该锁死输入栏;重复消费由
   * share-picker store 的 consume() 一次性语义兜底,批与批之间由
   * noteBatchQueueRef 串行(两次突发不能叠进同一个服务端限流桶)。
   * 离开会话(卸载)即停发剩余任务 —— 发错聊天时用户退出就是止损。
   * 单条失败不中断整批,发完汇总一次错误提示;首个错误保留语义映射
   * (敏感词/被拉黑等确定性拒绝要说清原因,不能伪装成可重试的网络问题)。
   */
  const runNoteBatchSend = useCallback(
    async (notes: NoteSummary[], options: NoteSendOptions) => {
      const sections = sectionsToImport(options);
      let failures = 0;
      let firstError: unknown = null;

      const perNote: NoteSendTask[][] = [];
      for (const note of notes) {
        if (!mountedRef.current) return;
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
      for (let i = 0; i < tasks.length; i += 1) {
        if (!mountedRef.current) return;
        while (mountedRef.current) {
          const now = Date.now();
          const delay = noteSendWindowDelayMs(noteSendTimestampsRef.current, now);
          if (delay <= 0) {
            noteSendTimestampsRef.current = recordNoteSendAttempt(
              noteSendTimestampsRef.current,
              now,
            );
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        if (!mountedRef.current) return;
        const task = tasks[i];
        try {
          switch (task.kind) {
            case 'note-card':
              await sendCardMessage({
                conversationId: conversationID,
                type: 'note-card',
                payload: {
                  ...buildNoteCardPayloadFromSummary(
                    task.note,
                    authUser?.id ?? null,
                  ),
                  ownerId: authUser?.id ?? null,
                },
              });
              break;
            case 'image':
              await sendImageMessage({
                conversationId: conversationID,
                key: task.key,
                width: task.width,
                height: task.height,
              });
              break;
            case 'video':
              await sendVideoMessage({
                conversationId: conversationID,
                key: task.key,
                width: task.width,
                height: task.height,
                duration: task.duration,
                size: task.size,
              });
              break;
            case 'location':
              await sendLocationMessage({
                conversationId: conversationID,
                latitude: task.latitude,
                longitude: task.longitude,
                title: task.title,
                address: task.address,
              });
              break;
          }
        } catch (error) {
          failures += 1;
          firstError ??= error;
          reportChatSendFailure(task.kind, error);
          devWarn('[ChatDetail] note batch send failed', error);
        }
      }

      if (failures > 0 && mountedRef.current) {
        const countMessage = t('chat.detail.noteBatchPartialFailed', {
          defaultValue: '{{count}} 条内容发送失败',
          count: failures,
        });
        // 首个错误若映射得出确切原因(敏感词/被拉黑/限流),优先展示它 ——
        // 这些是重试一万次也不会成功的确定性拒绝,笼统计数只会诱导人狂点重试。
        setSendError(
          firstError
            ? getChatSendErrorMessage(firstError, countMessage)
            : countMessage,
        );
      }
    },
    [authUser?.id, conversationID, t, mountedRef, setSendError],
  );

  const handlePickNoteBatch = useCallback(
    (notes: NoteSummary[], options: NoteSendOptions) => {
      if (!sourceID || isPreviewMode || notes.length === 0) {
        return Promise.resolve();
      }
      const previous = noteBatchQueueRef.current;
      const run = previous
        .catch(() => undefined)
        .then(() => runNoteBatchSend(notes, options));
      // 队列尾永不 reject,后续批次才接得上。
      noteBatchQueueRef.current = run.catch(() => undefined);
      return run;
    },
    [isPreviewMode, runNoteBatchSend, sourceID],
  );

  return {
    handlePickNoteBatch,
  };
}
