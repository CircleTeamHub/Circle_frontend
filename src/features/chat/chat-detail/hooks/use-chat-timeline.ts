import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type FlatList as FlatListType,
  InteractionManager,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { type ChatMessage } from '@/types';
import { useFocusEffect } from 'expo-router';
import { useChatStore } from '@/chat-core/store';
import {
  hasMoreHistory,
  loadConversationMessages,
  loadOlderConversationMessages,
  markConversationAsRead,
  resetHistoryCursor,
} from '@/chat-core/client';
import { reportHandledFailure } from '@/observability/report-failure';
import { fetchChatBurnPolicy } from '@/chat-core/api';
import {
  markMatchingTargetNotificationsRead,
} from '@/features/notifications/utils/seen-target';
import {
  createChatMessageMapCache,
  mapChatMessageDtosToUI,
} from '@/chat-core/message-mappers';
import { getAvatarMergeKey } from '@/features/chat/chat-detail/helpers';
import { useIsFocused } from '@react-navigation/native';
import {
  HIGHLIGHT_VISIBLE_MS,
  LATEST_MESSAGE_SCROLL_THRESHOLD,
  QUOTE_PAGING_MAX,
} from '@/features/chat/chat-detail/constants';
import { type ChatMessageDto } from '@/chat-core/protocol';

export interface ChatTimelineParams {
  currentUserID: string | null;
  setActiveConversationId: (conversationId: string | null) => void;
  mountedRef: RefObject<boolean>;
  sourceID: string;
  conversationID: string;
  setRemoteBurnPolicy: Dispatch<SetStateAction<{ burnDurationSec: number | null; burnStartedAt: string | null } | null>>;
  conversationMessages: ChatMessageDto[];
  peerReadHeight: number;
  peerDeliveredHeight: number;
  searchedMsgID: string;
  mergeAvatar: boolean;
}

/**
 * 消息时间线:进入/离开会话(活跃标记、首屏历史、焚毁策略、已读上报)、向前翻页、
 * DTO → 气泡数据的映射与头像合并、贴底跟随新消息、搜索结果与引用原文的定位高亮。
 */
export function useChatTimeline({
  currentUserID,
  setActiveConversationId,
  mountedRef,
  sourceID,
  conversationID,
  setRemoteBurnPolicy,
  conversationMessages,
  peerReadHeight,
  peerDeliveredHeight,
  searchedMsgID,
  mergeAvatar,
}: ChatTimelineParams) {
  const flatListRef = useRef<FlatListType<ChatMessage>>(null);
  const isNearLatestMessageRef = useRef(true);
  const latestMessageIdentityRef = useRef<{
    conversationID: string;
    messageID: string;
  } | null>(null);
  const latestMessageScrollTaskRef = useRef<ReturnType<
    typeof InteractionManager.runAfterInteractions
  > | null>(null);
  const scrolledToSearchRef = useRef(false);
  // 为定位搜索目标而翻页时的在途标记:effect 会随 messages 变化重跑,
  // 不挡住的话每一页返回都会再打一次请求。
  const searchPagingRef = useRef(false);
  // scrollToIndex 失败重试的次数与在飞的定时器。没有上限时，一次失败的定位会
  // 每 250ms 重试同一个 index，而每次重试又可能再次触发 onScrollToIndexFailed —— 在
  // 变高气泡 + 虚拟化回收下能连续跳动好几秒，看起来就像进聊天页就卡住。
  const scrollRetryCountRef = useRef(0);
  const scrollRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 供延时重试读取的「当前列表长度」。定时器闭包捕获的是排定那一刻的 messages，
  // 用它判断边界会漏掉这 250ms 内发生的删除 / 清空。
  const messagesLengthRef = useRef(0);
  useEffect(() => {
    return () => {
      latestMessageScrollTaskRef.current?.cancel();
      latestMessageScrollTaskRef.current = null;
      if (scrollRetryTimerRef.current) {
        clearTimeout(scrollRetryTimerRef.current);
        scrollRetryTimerRef.current = null;
      }
    };
  }, []);

  /**
   * 活跃会话标记按「焦点」而不是「挂载」来管。
   *
   * 推开聊天信息 / 聊天记录 / 选择器等页面时 React Navigation 会把本屏留在
   * 栈里继续挂载着,靠 useEffect cleanup 的话标记不会撤 —— 于是用户人在别的
   * 页面,新到的消息仍被算作「正在看」:不计未读、还顺手把已读水位推上去。
   * 消息实际上没被看到,红点却已经消了。
   */
  useFocusEffect(
    useCallback(() => {
      if (!conversationID || !sourceID) return;
      setActiveConversationId(conversationID);
      return () => {
        setActiveConversationId(null);
        // 离开会话按「看过了」结算(微信语义):停在上面翻历史时新到的那些没当场
        // 报已读,不在这里补上的话,出了会话列表先显示 0、下一次快照又冒出红点。
        // 被移出的会话已经不在列表里,不替它报(服务端只会拒)。
        const store = useChatStore.getState();
        if (
          store.appForeground &&
          store.conversations.some((c) => c.id === conversationID)
        ) {
          markConversationAsRead(conversationID);
        }
      };
    }, [conversationID, setActiveConversationId, sourceID]),
  );

  useFocusEffect(
    useCallback(() => {
      // A deep-link fallback can mount the detail screen before the scoped
      // chat session is ready. Do not issue a request with an unknown viewer;
      // changing currentUserID while focused reruns this callback.
      if (!conversationID || !sourceID || !currentUserID) return;

      loadConversationMessages(conversationID)
        .then(() => {
          // 历史落库后按最新水位上报已读(拉取前上报会拿到 0 水位白跑一趟)。
          // 拉取期间锁了屏的话不报:人没看到。
          if (useChatStore.getState().appForeground) {
            markConversationAsRead(conversationID);
          }
        })
        .catch((err) => {
          reportHandledFailure('chatDetail', 'loadMessages', err);
        });

      let cancelled = false;
      fetchChatBurnPolicy(conversationID)
        .then((policy) => {
          if (cancelled) return;
          setRemoteBurnPolicy({
            burnDurationSec: policy.burnDurationSec,
            burnStartedAt: policy.burnStartedAt,
          });
          // 会话列表尚未回填时，媒体气泡等其它入口也要立即知道会话策略。
          useChatStore
            .getState()
            .applyBurnDuration(
              conversationID,
              policy.burnDurationSec,
              policy.burnStartedAt,
            );
        })
        .catch(() => {
          if (!cancelled) setRemoteBurnPolicy(null);
        });

      return () => {
        cancelled = true;
        setRemoteBurnPolicy(null);
        // 离开会话丢掉翻页游标:下次进入重新从最新一页开始。
        resetHistoryCursor(conversationID);
      };
    }, [conversationID, currentUserID, sourceID, setRemoteBurnPolicy]),
  );

  // inverted 列表触底 = 时间上更早:继续向前翻页。没有它的话超过一页的
  // 会话根本滚不到更早的消息,搜索也跳不到首页之外的目标。
  const handleLoadOlder = useCallback(() => {
    if (!conversationID) return;
    void loadOlderConversationMessages(conversationID).catch((err) => {
      reportHandledFailure('chatDetail', 'loadOlderMessages', err);
    });
  }, [conversationID]);

  // 深翻到内存窗口上限:更早的页装不下了,列表顶上改为提示去聊天记录里搜。
  const historyWindowFull = useChatStore(
    (state) => state.historyWindowFullByConversation[conversationID] === true,
  );

  // 离开会话(卸载、或切到另一个会话)把深翻涨大的窗口收回去。压在别的页面下面
  // (失焦)不收:从聊天信息页回来还要停在原来翻到的位置。
  useEffect(() => {
    if (!conversationID) return;
    return () => {
      useChatStore.getState().shrinkConversationWindow(conversationID);
    };
  }, [conversationID]);

  useEffect(() => {
    if (!conversationID && !sourceID) return;
    void markMatchingTargetNotificationsRead({
      conversationID,
      sourceID,
      messageID: searchedMsgID,
    });
  }, [conversationID, searchedMsgID, sourceID]);

  // FlatList 用 inverted 渲染：index 0 = 最新消息，自然停在底部。
  // 因此把按 height 升序的 messages 反转一次，新到旧排列。
  // 按 DTO 引用缓存映射结果：未变化的消息保持同一 ChatMessage 引用，
  // FlatList 的 CellRenderer 因此跳过未变行的重渲染（无需给气泡加 memo）。
  // 乐观消息确认/失败时对象被替换 → 缓存未命中 → 只有那一行重渲染。
  const messageMapCacheRef = useRef<ReturnType<
    typeof createChatMessageMapCache
  > | null>(null);

  const messages = useMemo(() => {
    const box =
      messageMapCacheRef.current ?? createChatMessageMapCache(currentUserID);
    messageMapCacheRef.current = box;
    const mapped = mapChatMessageDtosToUI(
      conversationMessages ?? [],
      currentUserID,
      peerReadHeight,
      box,
      peerDeliveredHeight,
    );
    return mapped;
  }, [currentUserID, conversationMessages, peerReadHeight, peerDeliveredHeight]);
  // 上游 mapChatMessageDtosToUI 用 WeakMap 保住了每条消息的对象身份，好让列表
  // 跳过没变的行。这里原来每次都 spread 一个新对象，等于把那份身份在「同一个人
  // 连着发的消息」上全部作废 —— 而群聊里那恰恰是多数行，来一条新消息或对端已读
  // 水位推进一次，整片都要重渲染。变体按源对象缓存，身份跟着源走。
  const avatarMergeCacheRef = useRef(new WeakMap<ChatMessage, ChatMessage>());
  const displayMessages = useMemo(() => {
    if (!mergeAvatar) return messages;
    const cache = avatarMergeCacheRef.current;
    return messages.map((message, index) => {
      const key = getAvatarMergeKey(message);
      const olderKey = getAvatarMergeKey(messages[index + 1]);
      if (!key || key !== olderKey) return message;
      const cached = cache.get(message);
      if (cached) return cached;
      const merged: ChatMessage = { ...message, suppressAvatar: true };
      cache.set(message, merged);
      return merged;
    });
  }, [mergeAvatar, messages]);
  messagesLengthRef.current = messages.length;

  // 在此会话页时来新消息 → 即时推进已读水位(socket pending 队列自带去重合并)。
  // 必须带 isFocused:本屏被压在聊天信息/记录页下面时仍然挂载着、store 订阅
  // 照常触发,不挡的话「人没在看」的消息会被直接标成已读。
  // 也必须带 appForeground:停在聊天页锁屏,后台里连接还活着、消息照收,
  // 不挡的话这段时间的消息全被标成已读、红点不涨、推送也不发。
  // 还要停在最新消息附近:往上翻着看历史时新到的消息不算读过,滚回来再报。
  const isFocused = useIsFocused();
  const appForeground = useChatStore((state) => state.appForeground);
  useEffect(() => {
    if (
      !isFocused ||
      !appForeground ||
      !conversationID ||
      !conversationMessages?.length
    ) {
      return;
    }
    if (!isNearLatestMessageRef.current) return;
    markConversationAsRead(conversationID);
  }, [appForeground, conversationID, conversationMessages, isFocused]);

  // 异步分页回来时闭包里的 messages 已经过期,滚动要按最新那份算 index。
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const handleMessageListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nearLatest =
        event.nativeEvent.contentOffset.y <= LATEST_MESSAGE_SCROLL_THRESHOLD;
      const wasNearLatest = isNearLatestMessageRef.current;
      isNearLatestMessageRef.current = nearLatest;
      // 翻完历史滚回最新:刚才没报的已读现在补上。
      if (
        nearLatest &&
        !wasNearLatest &&
        conversationID &&
        useChatStore.getState().appForeground
      ) {
        markConversationAsRead(conversationID);
      }
    },
    [conversationID],
  );

  // FlatList 不会保证插入 index 0 后仍回到 offset 0，尤其是从笔记选择页返回时，
  // 新卡片常在导航 pop 动画中到达。自己发送的消息始终带回最新位置；收到消息
  // 只在用户原本就在底部附近时跟随，避免翻看历史时被强制拉回。
  useEffect(() => {
    const latestMessage = messages[0];
    if (!latestMessage || !conversationID || !isFocused) return;

    const previous = latestMessageIdentityRef.current;
    latestMessageIdentityRef.current = {
      conversationID,
      messageID: latestMessage.id,
    };
    if (
      !previous ||
      previous.conversationID !== conversationID ||
      previous.messageID === latestMessage.id
    ) {
      return;
    }
    if (!latestMessage.outgoing && !isNearLatestMessageRef.current) return;

    latestMessageScrollTaskRef.current?.cancel();
    latestMessageScrollTaskRef.current = InteractionManager.runAfterInteractions(() => {
      latestMessageScrollTaskRef.current = null;
      if (!mountedRef.current) return;
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      isNearLatestMessageRef.current = true;
    });
  }, [conversationID, isFocused, messages, mountedRef]);

  // 搜索定位：在 inverted 列表里 scrollToIndex 仍然按 index 计数，找到就跳。
  useEffect(() => {
    if (messages.length === 0 || !searchedMsgID || scrolledToSearchRef.current) {
      return;
    }

    const idx = messages.findIndex((m) => m.id === searchedMsgID);
    if (idx !== -1) {
      scrolledToSearchRef.current = true;
      // 每次新的定位都是一轮全新的重试预算，否则上一次搜索用尽后，后续定位会
      // 一次重试都不做。
      scrollRetryCountRef.current = 0;
      flatListRef.current?.scrollToIndex({
        index: idx,
        animated: true,
        viewPosition: 0.3,
      });
      setHighlightedMessageID(searchedMsgID);
      const timer = setTimeout(() => {
        if (mountedRef.current) {
          setHighlightedMessageID(null);
        }
      }, HIGHLIGHT_VISIBLE_MS);
      return () => clearTimeout(timer);
    }

    // 目标不在当前窗口里:从全局搜索或一条陈旧通知跳进来时,目标往往比最新一页
    // 更早。原来只在已加载的 messages 里找,找不到就什么都不做 —— 用户落在最新
    // 一条上,除非自己手动往回翻够远。这里继续向前翻页,直到找到或到头。
    if (!conversationID || searchPagingRef.current) return;
    if (!hasMoreHistory(conversationID)) return;
    searchPagingRef.current = true;
    void loadOlderConversationMessages(conversationID)
      .catch((err) => {
        reportHandledFailure('chatDetail', 'pageToSearchedMessage', err);
      })
      .finally(() => {
        searchPagingRef.current = false;
      });
  }, [messages, searchedMsgID, conversationID, mountedRef]);

  const [highlightedMessageID, setHighlightedMessageID] = useState<string | null>(
    null,
  );
  // 引用跳转的高亮定时器(搜索跳转那条路径自带 effect 清理,这条是命令式的)。
  const highlightClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useEffect(
    () => () => {
      if (highlightClearTimerRef.current) {
        clearTimeout(highlightClearTimerRef.current);
      }
    },
    [],
  );

  // 真引用点击定位:原消息还在内存窗口就滚过去;不在窗口(更早的历史)先不跳,
  // 批 1 本地库落地后升级成「按 height 拉一页再滚」。
  /**
   * 引用块跳转:目标不在内存窗口里时,按 quoteHeight 往回翻到它出现为止。
   * 有界(QUOTE_PAGING_MAX 页),到头或翻满就放弃 —— 宁可不动,也不能一直翻。
   */
  const quotePagingRef = useRef(false);

  const loadUntilQuoteVisible = useCallback(
    async (item: ChatMessage) => {
      if (!conversationID || quotePagingRef.current) return;
      const targetId = item.quoteMessageId;
      if (!targetId) return;
      quotePagingRef.current = true;
      try {
        for (let page = 0; page < QUOTE_PAGING_MAX; page += 1) {
          if (!mountedRef.current) return;
          if (!hasMoreHistory(conversationID)) return;
          await loadOlderConversationMessages(conversationID);
          if (!mountedRef.current) return;
          const timeline =
            useChatStore.getState().messagesByConversation[conversationID] ?? [];
          if (timeline.some((m) => m.id === targetId)) {
            // 命中之后交给 searchedMsgID 那条既有的滚动路径:它已经处理好了
            // 「列表还没重新布局完」的重试与高亮。
            setHighlightedMessageID(targetId);
            // 高亮是「我带你跳到了这里」的一次性提示,不是选中态 —— 到点自动
            // 褪去(与 searchedMsgID / 朋友圈评论定位同一节奏)。漏了这一笔的话
            // 高亮会一直挂在那条消息上。
            if (highlightClearTimerRef.current) {
              clearTimeout(highlightClearTimerRef.current);
            }
            highlightClearTimerRef.current = setTimeout(() => {
              if (mountedRef.current) setHighlightedMessageID(null);
            }, HIGHLIGHT_VISIBLE_MS);
            const index = messagesRef.current.findIndex(
              (m) => m.id === targetId,
            );
            if (index >= 0) {
              flatListRef.current?.scrollToIndex({
                index,
                viewPosition: 0.5,
                animated: true,
              });
            }
            return;
          }
        }
      } catch (err) {
        reportHandledFailure('chatDetail', 'pageToQuotedMessage', err);
      } finally {
        quotePagingRef.current = false;
      }
    },
    [conversationID, mountedRef],
  );

  const handleQuotePress = useCallback(
    (item: ChatMessage) => {
      if (!item.quoteMessageId) return;
      // 读 ref 而不是依赖 messages:依赖的话每来一条消息这个回调就换一次,
      // 行渲染函数跟着换,列表里所有气泡都要重渲染。
      const index = messagesRef.current.findIndex(
        (m) => m.id === item.quoteMessageId,
      );
      if (index >= 0) {
        flatListRef.current?.scrollToIndex({
          index,
          viewPosition: 0.5,
          animated: true,
        });
        return;
      }
      // 原消息比当前内存窗口更早。原来直接 return —— 引用块照样是可点的,
      // 点下去却什么都不发生,而会话稍微长一点这就是常态。按 quoteHeight
      // 往回翻,翻到目标进窗口为止(有界),然后再滚过去。
      void loadUntilQuoteVisible(item);
    },
    [loadUntilQuoteVisible],
  );

  return {
    flatListRef,
    scrollRetryCountRef,
    scrollRetryTimerRef,
    messagesLengthRef,
    handleLoadOlder,
    historyWindowFull,
    messages,
    displayMessages,
    handleMessageListScroll,
    highlightedMessageID,
    handleQuotePress,
  };
}
