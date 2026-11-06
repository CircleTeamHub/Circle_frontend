import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useRef,
} from 'react';
import { type NoteSummary } from '@/features/notes/types';
import {
  appendNoteBatchRun,
  type NoteSendOptions,
} from '@/features/chat/utils/note-batch-send';
import { sendNotesToConversation } from '@/features/chat/utils/send-notes-to-conversation';
import { fetchNoteDetail } from '@/services/api/notes';
import { reportHandledFailure } from '@/observability/report-failure';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import { type TFunction } from 'i18next';
import { type AuthUser } from '@/stores/authStore';

/** 笔记卡片下方能直接发出的三块内容;「笔记」那块仍然是打开详情。 */
export type NoteCardSendSection = 'media' | 'showcase' | 'location';

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
      const { failures, firstError } = await sendNotesToConversation({
        conversationId: conversationID,
        notes,
        options,
        ownerId: authUser?.id ?? null,
        sendTimestamps: noteSendTimestampsRef,
        isActive: () => mountedRef.current,
      });

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
      const run = appendNoteBatchRun(noteBatchQueueRef.current, async () => {
        if (!mountedRef.current) return;
        await runNoteBatchSend(notes, options);
      });
      // 队列尾永不 reject,后续批次才接得上。
      noteBatchQueueRef.current = run.catch(() => undefined);
      return run;
    },
    [isPreviewMode, mountedRef, runNoteBatchSend, sourceID],
  );

  /**
   * 聊天里笔记卡片下方的「视频 / 展示 / 位置」:以我的名义把这条笔记对应的那一块
   * 发到当前聊天。卡片上只有计数,先拉详情拿到真实的媒体数和地址,再走同一条
   * 批量发送管线(媒体由服务端拷进我的 chat/ 命名空间,和批量发笔记同一套限流)。
   */
  const handleSendNoteSection = useCallback(
    (noteId: string, section: NoteCardSendSection) => {
      if (!sourceID || isPreviewMode) return Promise.resolve();
      const run = appendNoteBatchRun(noteBatchQueueRef.current, async () => {
        if (!mountedRef.current) return;
        let note: NoteSummary;
        try {
          note = await fetchNoteDetail(noteId);
        } catch (error) {
          reportHandledFailure('chatDetail', 'fetchNoteForSection', error);
          if (mountedRef.current) {
            setSendError(
              getChatSendErrorMessage(
                error,
                t('chat.noteCard.sectionSendFailed', { defaultValue: '发送失败，请重试' }),
              ),
            );
          }
          return;
        }
        if (!mountedRef.current) return;
        await runNoteBatchSend([note], {
          card: false,
          media: section === 'media',
          showcase: section === 'showcase',
          location: section === 'location',
        });
      });
      noteBatchQueueRef.current = run.catch(() => undefined);
      return run;
    },
    [isPreviewMode, mountedRef, runNoteBatchSend, setSendError, sourceID, t],
  );

  return {
    handlePickNoteBatch,
    handleSendNoteSection,
  };
}
