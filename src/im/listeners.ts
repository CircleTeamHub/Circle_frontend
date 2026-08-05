/**
 * im/listeners.ts — OpenIM SDK 全局事件监听器
 *
 * 由 client.ts 在 initSDK 成功后调用 bindOpenIMListeners() 完成绑定，
 * 不在 React 层 useEffect 里绑定 —— 因为部分 native 事件会在 initSDK
 * 即将完成时立刻触发，useEffect 的延迟挂载会让 JS 端错过它们。
 *
 * 监听器与 client.ts 之间不互相 import（防止循环依赖）：
 * - 收到新消息时直接通过 SDK 拉一次活动会话的最新历史，避免再回调 client。
 * - 连接成功时直接调 OpenIMSDK.getConversationListSplit。
 */
import OpenIMSDK, {
  SessionType,
  type ConversationItem,
  type MessageItem,
  type UserOnlineState,
} from '@openim/rn-client-sdk';
import i18n from '@/i18n';
import { cancelIMSessionRecovery, recoverIMSession } from '@/im/token-recovery';
import { clearIMLoginRetryPending } from '@/im/login-retry-pending';
import { buildChatSnackbar } from '@/im/snackbar';
import { useNotificationSnackbarStore } from '@/features/notifications/store/use-notification-snackbar-store';
import { useIMStore } from '@/stores/imStore';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';

let unbindAll: (() => void) | null = null;

function isMessageForActiveConversation(
  message: MessageItem,
  active: { sourceID: string; sessionType: SessionType },
  currentUserID: string | null,
) {
  if (active.sessionType === SessionType.Group) {
    return message.groupID === active.sourceID;
  }

  const peerID =
    message.sendID === currentUserID ? message.recvID : message.sendID;
  return (
    message.sessionType === SessionType.Single && peerID === active.sourceID
  );
}

function enqueueChatSnackbar(
  message: MessageItem,
  conversations: ConversationItem[],
  currentUserID: string | null,
) {
  const payload = buildChatSnackbar(
    message,
    conversations,
    currentUserID,
    message.sessionType === SessionType.Group,
    {
      title: i18n.t('chat.snackbarNewMessage'),
      preview: i18n.t('chat.snackbarPreviewFallback'),
    },
  );

  if (payload) {
    useNotificationSnackbarStore.getState().enqueueChatMessage(payload);
  }
}

export function bindOpenIMListeners() {
  if (unbindAll) {
    return unbindAll;
  }

  const handleConnecting = () => {
    useIMStore.getState().setConnecting(true);
    useIMStore.getState().setConnected(false);
    useIMStore.getState().setError(null);
  };
  OpenIMSDK.on('onConnecting', handleConnecting);

  const handleConnected = async () => {
    // 迟到的连接成功:此刻没有当前身份(登录已因就绪超时/失败放弃、currentUserID 被清为
    // null)时,别把 connected 翻真、也别拉会话——否则会留下「已连接但身份为 null」的僵尸
    // 会话,读回执 / 消息归属会错到下次前台重登才纠正。正常登录在 login() 前就乐观写入
    // currentUserID(client.ts),真正的登录 / 重连都带得着身份,不受此守卫影响。
    if (!useIMStore.getState().currentUserID) {
      useIMStore.getState().setConnecting(false);
      return;
    }
    useIMStore.getState().setConnecting(false);
    useIMStore.getState().setConnected(true);
    useIMStore.getState().setError(null);

    try {
      const conversations = await OpenIMSDK.getConversationListSplit({
        offset: 0,
        count: 100,
      });
      useIMStore.getState().setConversations(conversations);
    } catch (error) {
      useIMStore
        .getState()
        .setError(error instanceof Error ? error.message : '拉取会话列表失败');
    }
  };
  OpenIMSDK.on('onConnectSuccess', handleConnected);

  const handleConnectFailed = (error: { errMsg?: string }) => {
    useIMStore.getState().setConnecting(false);
    useIMStore.getState().setConnected(false);
    useIMStore.getState().setError(error?.errMsg ?? 'OpenIM 连接失败');
  };
  OpenIMSDK.on('onConnectFailed', handleConnectFailed);

  const handleTokenExpired = async () => {
    useIMStore.getState().setConnecting(false);
    useIMStore.getState().setConnected(false);
    // IM token 失效 ≠ 业务会话失效（#83）：先用业务凭证向 GET /auth/im-token 换新
    // IM token 原地重登，用户无感。只有业务凭证也被服务端明确拒绝时，
    // recoverIMSession 内部才会清 session 跳登录页；瞬时失败（网络 / 503 / 限流）
    // 会记欠账，由 SessionBootstrap 回前台时补登。
    const recovered = await recoverIMSession();
    if (!recovered) {
      // 不写「登录已过期」——业务会话可能还活着，错误文案会误导用户去重登。
      // connected=false 已让 UI 呈现断连态；恢复由前台补登接手。
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[openim] token expired; in-place recovery deferred');
      }
    }
  };
  OpenIMSDK.on('onUserTokenExpired', handleTokenExpired);
  // SDK 也可能发 onUserTokenInvalid（token 不被服务器接受），统一按 expired 处理
  OpenIMSDK.on('onUserTokenInvalid', handleTokenExpired);

  // 同账号在另一端以相同 platform 登录时，OpenIM 把本端长连接踢下线——这是对端「有意」
  // 顶替，不是 token 失效。若像 expired 那样换 token 原地重登，本端会立刻把新端再踢下线，
  // 两端来回抢登陷入风暴。故按终态断连处理、给用户可读解释、不自动恢复；用户如需可自行
  // 重新进入以重新登录（届时轮到对端被踢，是用户的显式选择）。
  const handleKickedOffline = () => {
    useIMStore.getState().setConnecting(false);
    useIMStore.getState().setConnected(false);
    useIMStore.getState().setError('您的账号已在其他设备登录');
    // 关键：取消所有补登 / 恢复欠账。否则回前台时排队的欠账
    // (isIMLoginRetryPending / reloginPending)或在飞的 recoverIMSession 会把本端又登
    // 回去、把顶替本端的新设备再踢下线，重演本应避免的互踢风暴。
    clearIMLoginRetryPending();
    cancelIMSessionRecovery();
  };
  OpenIMSDK.on('onKickedOffline', handleKickedOffline);

  // ——— 入站事件合并缓冲 ———
  //
  // 活跃群刷屏 / 登录后同步爆发时，onRecvNewMessages、onConversationChanged、
  // onTotalUnreadMessageCountChanged 都可能每秒触发几十上百次，逐条落 store 就是
  // 逐条重渲染。三者共用同一个定时器：同一 tick 内的多次 setState 会被 React 合成
  // 一次渲染，而三个各自错开的定时器就是三次。
  //
  // 折叠是语义等价的，不是近似：
  // - 会话按 conversationID 存进 Map，mergeConversationList 本来就是「按 ID 整体替换」，
  //   所以同一会话的 N 次更新只保留最后一次，与逐条 merge 结果完全一致。
  // - 未读是服务端下发的绝对总数（不是增量），后值覆盖前值同样无损。
  const FLUSH_INTERVAL_MS = 120;
  let pendingByConversation = new Map<string, MessageItem[]>();
  let pendingConversations = new Map<string, ConversationItem>();
  // null = 本轮没有未读事件。不能用 0 当哨兵：0 本身就是合法的未读数（全部已读）。
  let pendingTotalUnread: number | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushPendingConversations = () => {
    if (pendingConversations.size === 0) return;
    const conversations = [...pendingConversations.values()];
    pendingConversations = new Map();
    useIMStore.getState().mergeConversations(conversations);
  };

  const flushPendingUnread = () => {
    if (pendingTotalUnread === null) return;
    const totalUnread = pendingTotalUnread;
    pendingTotalUnread = null;
    useIMStore.getState().setTotalUnread(totalUnread);
    useTabBadgeStore.getState().setMessagesUnread(totalUnread);
  };

  const flushPending = () => {
    flushTimer = null;
    flushPendingConversations();
    flushPendingMessages();
    flushPendingUnread();
  };

  const scheduleFlush = () => {
    if (!flushTimer) {
      flushTimer = setTimeout(flushPending, FLUSH_INTERVAL_MS);
    }
  };

  // 会话现在最多延迟 FLUSH_INTERVAL_MS 才进 store，但消息横幅和 C2C 读回执都要靠
  // 「按 groupID / userID 查得到会话」才能路由，查不到时它们不是降级而是**直接丢弃**
  // （群横幅 buildChatSnackbar 返回 null；读回执打个 warn 就 continue）。只读 store
  // 的话，新会话在缓冲窗口内到达的首条消息会静默没有横幅 —— 批处理前是同步 merge，
  // 不存在这个窗口。所以路由用的列表必须把缓冲中的会话叠上去。
  //
  // 每次事件调用一次（不是每条消息一次），且缓冲为空时零成本直接返回原数组 ——
  // 下游本来就是 O(n) 的 .find()，这里不会让热路径变得更差。
  const readConversationsWithPending = (): ConversationItem[] => {
    const { conversations } = useIMStore.getState();
    if (pendingConversations.size === 0) return conversations;
    const merged = new Map(
      conversations.map((item) => [item.conversationID, item]),
    );
    for (const [conversationID, item] of pendingConversations) {
      merged.set(conversationID, item);
    }
    return [...merged.values()];
  };

  // onConversationChanged 与 onNewConversation 共享同一个 handler 引用：
  // 行为相同 + 共享 ref 便于 off 时一一对应、也少一份闭包。
  const handleConversationsBatched = (conversations: ConversationItem[]) => {
    for (const conversation of conversations) {
      if (!conversation?.conversationID) continue;
      pendingConversations.set(conversation.conversationID, conversation);
    }
    if (pendingConversations.size > 0) scheduleFlush();
  };
  OpenIMSDK.on('onConversationChanged', handleConversationsBatched);
  OpenIMSDK.on('onNewConversation', handleConversationsBatched);

  const handleUnreadChanged = (totalUnread: number) => {
    pendingTotalUnread = totalUnread;
    scheduleFlush();
  };
  OpenIMSDK.on('onTotalUnreadMessageCountChanged', handleUnreadChanged);

  // C2C 已读回执：对方阅读消息后，SDK 把读到的 clientMsgID 列表回推给发送方。
  // payload 形如 [{ userID, conversationID, msgIDList }, ...]，不同 SDK 版本字段
  // 命名略不同（msgIDList / clientMsgIDList / readMsgIDList），都兼容下。
  const handleC2CReadReceipt = (
    receipts: readonly {
      userID?: string;
      conversationID?: string;
      msgIDList?: string[];
      clientMsgIDList?: string[];
      readMsgIDList?: string[];
    }[],
  ) => {
    if (!Array.isArray(receipts)) return;
    const conversations = readConversationsWithPending();
    for (const receipt of receipts) {
      const ids =
        receipt.msgIDList ??
        receipt.clientMsgIDList ??
        receipt.readMsgIDList ??
        [];
      if (ids.length === 0) continue;
      // 优先用 receipt 自带的 conversationID；否则按 userID 在已加载的会话里查。
      // 移除 activeConversation 兜底 —— 如果 receipt 既无 conversationID 又
      // 找不到匹配的 userID，盲目套到当前会话会把消息标到错的人头上。
      let conversationID = receipt.conversationID;
      if (!conversationID && receipt.userID) {
        const conv = conversations.find(
          (c) => c.userID === receipt.userID,
        );
        conversationID = conv?.conversationID;
      }
      if (!conversationID) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[openim] unrouted C2C read receipt — dropped', receipt);
        }
        continue;
      }
      useIMStore.getState().markMessagesRead(conversationID, ids);
    }
  };
  OpenIMSDK.on('onRecvC2CReadReceipt', handleC2CReadReceipt);

  // 按会话分桶攒消息，随共用的 flush 定时器一起落库（unbind 时也会 flush，不丢消息）。
  function flushPendingMessages() {
    if (pendingByConversation.size === 0) return;
    const batches = pendingByConversation;
    pendingByConversation = new Map();
    const { appendMessages, activeConversation } = useIMStore.getState();
    batches.forEach((msgs, conversationID) => {
      if (msgs.length === 0) return;
      appendMessages(conversationID, msgs);
      // 用户此刻正停留在这个会话页：把刚落地的消息立即标记已读。ChatDetailScreen
      // 只在挂载时标一次，覆盖不了「页面已打开、对方又发消息」——这里补上，既清掉
      // 会话列表未读 badge 和 tab 总未读，也给发送方回一条已读回执。只对当前活跃
      // 会话执行；直接调 OpenIMSDK，避免与 client.ts 形成循环依赖。
      if (conversationID === activeConversation?.conversationID) {
        void OpenIMSDK.markConversationMessageAsRead(conversationID).catch(
          (err) => {
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
              console.warn('[openim] mark active conversation read failed', err);
            }
          },
        );
      }
    });
  }

  const bufferMessages = (conversationID: string, msgs: MessageItem[]) => {
    const existing = pendingByConversation.get(conversationID);
    pendingByConversation.set(
      conversationID,
      existing ? [...existing, ...msgs] : msgs,
    );
    scheduleFlush();
  };

  const handleNewMessages = (messages: MessageItem[]) => {
    const { activeConversation, currentUserID } = useIMStore.getState();
    const conversations = readConversationsWithPending();

    if (!activeConversation) {
      messages.forEach((message) =>
        enqueueChatSnackbar(message, conversations, currentUserID),
      );
      return;
    }

    const matched = messages.filter((message) =>
      isMessageForActiveConversation(message, activeConversation, currentUserID),
    );

    messages
      .filter(
        (message) =>
          !isMessageForActiveConversation(
            message,
            activeConversation,
            currentUserID,
          ),
      )
      .forEach((message) =>
        enqueueChatSnackbar(message, conversations, currentUserID),
      );

    if (matched.length > 0) {
      bufferMessages(activeConversation.conversationID, matched);
    }
  };
  OpenIMSDK.on('onRecvNewMessages', handleNewMessages);

  // 订阅过的用户状态变化时 SDK 会回推一条记录，转写到 store。
  const handleUserStatusChanged = (status: UserOnlineState) => {
    if (!status?.userID) return;
    useIMStore
      .getState()
      .setUserOnlineStatuses([{ userID: status.userID, status: status.status }]);
  };
  OpenIMSDK.on('onUserStatusChanged', handleUserStatusChanged);

  unbindAll = () => {
    // 卸载前 flush 缓冲，避免丢失最后一批还没落 store 的消息 / 会话 / 未读数。
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushPending();
    OpenIMSDK.off('onConnecting', handleConnecting);
    OpenIMSDK.off('onConnectSuccess', handleConnected);
    OpenIMSDK.off('onConnectFailed', handleConnectFailed);
    OpenIMSDK.off('onUserTokenExpired', handleTokenExpired);
    OpenIMSDK.off('onUserTokenInvalid', handleTokenExpired);
    OpenIMSDK.off('onKickedOffline', handleKickedOffline);
    OpenIMSDK.off('onConversationChanged', handleConversationsBatched);
    OpenIMSDK.off('onNewConversation', handleConversationsBatched);
    OpenIMSDK.off('onTotalUnreadMessageCountChanged', handleUnreadChanged);
    OpenIMSDK.off('onRecvNewMessages', handleNewMessages);
    OpenIMSDK.off('onRecvC2CReadReceipt', handleC2CReadReceipt);
    OpenIMSDK.off('onUserStatusChanged', handleUserStatusChanged);
    unbindAll = null;
  };

  return unbindAll;
}

/**
 * 解绑所有 OpenIM 监听器（登出 teardown 调用）。
 * bindOpenIMListeners 在 unbindAll 存在时会早返回；解绑并置 null 后，下一次
 * ensureOpenIMInitialized → bindOpenIMListeners 会针对新 SDK 会话重新注册，
 * 避免账号 A 的 handler 常驻进账号 B 的会话。幂等：未绑定时为 no-op。
 */
export function unbindOpenIMListeners(): void {
  unbindAll?.();
}
