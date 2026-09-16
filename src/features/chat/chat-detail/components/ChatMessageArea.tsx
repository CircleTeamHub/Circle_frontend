import {
  FlatList,
  ImageBackground,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Text,
  View,
} from 'react-native';
import { chatDetailStyles as s } from '@/features/chat/chat-detail/styles';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { MAX_SCROLL_TO_INDEX_RETRIES } from '@/features/chat/chat-detail/constants';
import { type ThemeColors, Typography } from '@/theme';
import { type TFunction } from 'i18next';
import { type ReactElement, type RefObject } from 'react';
import {
  type ChatDetailThemedStyles,
} from '@/features/chat/chat-detail/hooks/use-chat-detail-themed-styles';
import { type ChatMessage } from '@/types';

export interface ChatMessageAreaProps {
  colors: ThemeColors;
  t: TFunction<"translation", undefined>;
  sendError: string | null;
  mountedRef: RefObject<boolean>;
  isPreviewMode: boolean;
  backgroundImageUri: string | null;
  d: ChatDetailThemedStyles;
  flatListRef: RefObject<FlatList<ChatMessage> | null>;
  scrollRetryCountRef: RefObject<number>;
  scrollRetryTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
  messagesLengthRef: RefObject<number>;
  handleLoadOlder: () => void;
  messages: ChatMessage[];
  displayMessages: ChatMessage[];
  handleMessageListScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  renderItem: (info: { item: ChatMessage }) => ReactElement | null;
  keyExtractor: (item: ChatMessage) => string;
  closeInputPanels: () => void;
  isVoiceRecording: boolean;
  voiceElapsedSeconds: number;
}

/**
 * 消息区:聊天背景(纯色/图片 + 蒙版)与倒序消息列表。搜索/引用定位时 scrollToIndex 可能落在
 * 还没测量的行上,失败后按上限重试并在开火时重新校验列表边界。
 */
export function ChatMessageArea({
  colors,
  t,
  sendError,
  mountedRef,
  isPreviewMode,
  backgroundImageUri,
  d,
  flatListRef,
  scrollRetryCountRef,
  scrollRetryTimerRef,
  messagesLengthRef,
  handleLoadOlder,
  messages,
  displayMessages,
  handleMessageListScroll,
  renderItem,
  keyExtractor,
  closeInputPanels,
  isVoiceRecording,
  voiceElapsedSeconds,
}: ChatMessageAreaProps) {
  return (
    <View style={[s.messageArea, d.messageArea]}>
      {backgroundImageUri ? (
        <View pointerEvents="none" style={s.messageAreaBackground}>
          <ImageBackground
            source={{ uri: backgroundImageUri }}
            style={s.messageAreaBackground}
            resizeMode="cover"
          >
            {/* 薄蒙版把壁纸往主题底色推一点，让浮在背景上的日期分隔和群昵称
                保住对比度。这里曾经用 colors.overlay（模态遮罩，40% 纯黑）——
                壁纸加载不出来时，画出来的就是用户看到的那一整片灰。 */}
            <View
              style={[
                s.messageAreaOverlay,
                { backgroundColor: colors.chatBackgroundScrim },
              ]}
            />
          </ImageBackground>
        </View>
      ) : null}
      <FlatList
        testID={E2E_TEST_IDS.chatMessageList}
        ref={flatListRef}
        style={s.messageListSurface}
        data={displayMessages}
        inverted
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        // 虚拟化调优：限制单批渲染数与窗口大小，降低活跃/长会话的渲染与内存压力。
        // 消息气泡高度可变，无法安全提供 getItemLayout，故只调这几个安全项；
        // removeClippedSubviews 仅在 Android 开启（iOS 上 inverted 列表可能出现空白格）。
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        // inverted:列表"末端"是最旧的一头,触底即向前翻页。
        onEndReached={handleLoadOlder}
        onEndReachedThreshold={0.4}
        windowSize={11}
        removeClippedSubviews={Platform.OS === 'android'}
        contentContainerStyle={[s.messageList, s.messageListContent, s.messageListInset]}
        showsVerticalScrollIndicator={false}
        // 下拉/滚动消息列表即收起底部面板与键盘（微信式）。on-drag 让键盘跟手滑落。
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScroll={handleMessageListScroll}
        scrollEventThrottle={32}
        onScrollBeginDrag={closeInputPanels}
        // scrollToIndex 在 inverted + 没设 getItemLayout 时，目标 index 超出已渲染窗口
        // 就会抛 "scrollToIndex out of range"。fallback：先滚到能测到的最远 index，
        // 等下一帧布局完再精确跳到目标位置，避免搜索定位时整页崩。
        //
        // 重试必须有上限：每次重试都可能再次失败并再排一次重试，构成自维持的循环。
        // 消息高度可变（无法提供 getItemLayout）、虚拟化又会回收已测量的行，所以
        // "多试几次总能测到" 并不成立。试满 MAX 次就退化为滚到能测到的最远处收手 ——
        // 定位不到最多是位置不准，而卡住数秒是功能故障。
        onScrollToIndexFailed={(info) => {
          const fallbackIndex = Math.max(
            0,
            Math.min(info.highestMeasuredFrameIndex ?? info.index, info.index),
          );
          flatListRef.current?.scrollToIndex({
            index: fallbackIndex,
            animated: false,
          });

          // 目标已经不在当前列表里（消息被 200 条上限截掉、或会话已切换）：
          // 再重试也只会反复失败。
          if (info.index >= messages.length) {
            scrollRetryCountRef.current = 0;
            return;
          }
          if (scrollRetryCountRef.current >= MAX_SCROLL_TO_INDEX_RETRIES) {
            scrollRetryCountRef.current = 0;
            return;
          }

          scrollRetryCountRef.current += 1;
          if (scrollRetryTimerRef.current) {
            clearTimeout(scrollRetryTimerRef.current);
          }
          scrollRetryTimerRef.current = setTimeout(() => {
            scrollRetryTimerRef.current = null;
            if (!mountedRef.current) return;
            // 必须在开火时重新校验边界，而不是只在排定时校验：这 250ms 里列表可能
            // 缩短（删除消息、清空聊天记录、切换会话）。scrollToIndex 对越界是
            // 同步抛 invariant、不会走 onScrollToIndexFailed —— 在 setTimeout 里
            // 抛出去就是 release 包的崩溃。读 ref 而非闭包里的 messages，
            // 闭包捕获的是排定那一刻的旧数组。
            const currentLength = messagesLengthRef.current;
            if (currentLength === 0 || info.index >= currentLength) return;
            flatListRef.current?.scrollToIndex({
              index: info.index,
              animated: true,
              viewPosition: 0.3,
            });
          }, 250);
        }}
      />
      {isPreviewMode ? (
        <Text style={[s.previewNotice, Typography.small, { color: colors.textSecondary }]}>
          {t('chat.detail.previewNotice', {
            defaultValue: '连接尚未完成，请稍后重试',
          })}
        </Text>
      ) : null}
      {sendError ? (
        <Text style={[s.sendError, Typography.small, { color: colors.error }]}>
          {sendError}
        </Text>
      ) : null}
      {isVoiceRecording ? (
        <Text style={[s.voiceStatus, { color: colors.primary }]}>
          {t('chat.detail.recordingSeconds', {
            defaultValue: '正在录音 {{seconds}} 秒',
            seconds: voiceElapsedSeconds,
          })}
        </Text>
      ) : null}
    </View>
  );
}
