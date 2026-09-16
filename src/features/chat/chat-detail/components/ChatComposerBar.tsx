import {
  LayoutAnimation,
  type NativeSyntheticEvent,
  type PanResponderInstance,
  Platform,
  Pressable,
  Text,
  TextInput,
  type TextInputKeyPressEventData,
  View,
} from 'react-native';
import { chatDetailStyles as s } from '@/features/chat/chat-detail/styles';
import { Spacing, type ThemeColors } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { PANEL_LAYOUT_ANIM } from '@/features/chat/chat-detail/constants';
import { type EdgeInsets } from 'react-native-safe-area-context';
import { type TFunction } from 'i18next';
import { type Dispatch, type SetStateAction } from 'react';
import {
  type ChatDetailThemedStyles,
} from '@/features/chat/chat-detail/hooks/use-chat-detail-themed-styles';
import { type PlazaPostCardData } from '@/types';

export interface ChatComposerBarProps {
  insets: EdgeInsets;
  colors: ThemeColors;
  t: TFunction<"translation", undefined>;
  draft: string;
  setMentionPickerVisible: Dispatch<SetStateAction<boolean>>;
  selfSilenced: boolean;
  composerLocked: boolean;
  isPreviewMode: boolean;
  keyboardVisible: boolean;
  d: ChatDetailThemedStyles;
  attachmentOpen: boolean;
  setAttachmentOpen: Dispatch<SetStateAction<boolean>>;
  emojiOpen: boolean;
  setEmojiOpen: Dispatch<SetStateAction<boolean>>;
  handleAttachmentToggle: () => void;
  handleEmojiToggle: () => void;
  selection: { start: number; end: number; } | undefined;
  handleSelectionChange: (event: { nativeEvent: { selection: { start: number; end: number; }; }; }) => void;
  handleDraftChange: (next: string) => void;
  voiceInputMode: boolean;
  cancelArmed: boolean;
  isVoiceRecording: boolean;
  voiceElapsedSeconds: number;
  toggleVoiceInputMode: () => void;
  voicePanResponder: PanResponderInstance;
  sending: boolean;
  pendingCard: PlazaPostCardData | null;
  handleSend: () => Promise<void>;
}

/**
 * 输入栏:语音/文字切换、输入框(或按住说话条)、表情与「+」面板开关、发送按钮。
 */
export function ChatComposerBar({
  insets,
  colors,
  t,
  draft,
  setMentionPickerVisible,
  selfSilenced,
  composerLocked,
  isPreviewMode,
  keyboardVisible,
  d,
  attachmentOpen,
  setAttachmentOpen,
  emojiOpen,
  setEmojiOpen,
  handleAttachmentToggle,
  handleEmojiToggle,
  selection,
  handleSelectionChange,
  handleDraftChange,
  voiceInputMode,
  cancelArmed,
  isVoiceRecording,
  voiceElapsedSeconds,
  toggleVoiceInputMode,
  voicePanResponder,
  sending,
  pendingCard,
  handleSend,
}: ChatComposerBarProps) {
  return (
    <View
      style={[
        s.inputBar,
        d.inputBar,
        {
          // 键盘弹起 / 面板展开时无需安全区 padding（键盘或面板已占住底部），紧贴即可；
          // 仅在底部裸露时留 insets.bottom 让输入栏避开 home indicator。
          paddingBottom:
            attachmentOpen || emojiOpen || keyboardVisible
              ? Spacing.sm
              : insets.bottom || 28,
        },
      ]}
    >
      {/* 左侧：语音模式→切回键盘；文本模式→话筒。录音中由全屏浮层接管，禁用。
          Web 直接不放录音入口：MediaRecorder 只出 webm/opus，原生端播不了，
          跨端语音格式没对齐前先砍（微信桌面版同款取舍）；语音**播放**不受影响。 */}
      {Platform.OS === 'web' ? null : (
        <Pressable
          key="voice-left"
          style={[s.circleBtn, d.circleBtn]}
          onPress={toggleVoiceInputMode}
          disabled={isPreviewMode || isVoiceRecording || composerLocked}
          hitSlop={8}
        >
          <Ionicons
            name={voiceInputMode ? 'create-outline' : 'mic'}
            size={22}
            color={colors.textSecondary}
          />
        </Pressable>
      )}

      {/* 中间：文本模式=输入框；语音模式=按住说话（gesture 元素全程保持挂载）。 */}
      {voiceInputMode ? (
        <View
          key="voice-hold-bar"
          style={[
            s.voiceHoldBar,
            isVoiceRecording ? d.voiceHoldBarActive : d.voiceHoldBarIdle,
          ]}
          {...voicePanResponder.panHandlers}
        >
          <Text
            style={[
              s.voiceHoldText,
              { color: isVoiceRecording ? colors.white : colors.text },
            ]}
          >
            {isVoiceRecording
              ? cancelArmed
                ? t('chat.detail.voiceReleaseCancel', {
                    defaultValue: '松开 取消',
                  })
                : t('chat.detail.voiceReleaseSend', {
                    defaultValue: '松开发送 {{seconds}}"',
                    seconds: voiceElapsedSeconds,
                  })
              : t('chat.detail.voiceHoldToTalk', {
                  defaultValue: '按住 说话',
                })}
          </Text>
        </View>
      ) : (
        <View key="text-shell" style={[s.composerShell, d.composerShell]}>
          <TextInput
            testID={E2E_TEST_IDS.chatInput}
            style={[s.composerInput, d.composerInput]}
            placeholder={
              composerLocked
                ? selfSilenced
                  ? t('chat.youAreSilenced', { defaultValue: '你已被禁言' })
                  : t('chat.muteAll', { defaultValue: '全员禁言' })
                : isPreviewMode
                  ? t('chat.detail.previewPlaceholder', {
                      defaultValue: '连接尚未完成',
                    })
                  : t('chat.detail.inputPlaceholder', {
                      defaultValue: '输入消息...',
                    })
            }
            placeholderTextColor={colors.textSecondary}
            value={draft}
            onChangeText={handleDraftChange}
            selection={selection}
            onSelectionChange={handleSelectionChange}
            onSubmitEditing={handleSend}
            // Web：Enter 发送。onKeyPress 在 RNW 内部先于它自己的 submit 分支
            // 执行，我们 preventDefault 之后那条分支就不会再走（它带
            // !isDefaultPrevented 判断），因此不会重复发送。
            // 原生端保持 undefined、行为不变。
            onKeyPress={
              Platform.OS === 'web'
                ? (
                    event: NativeSyntheticEvent<TextInputKeyPressEventData>,
                  ) => {
                    // DOM 的 KeyboardEvent 带这两个字段，RN 的类型里没有。
                    const native = event.nativeEvent as
                      & TextInputKeyPressEventData
                      & { isComposing?: boolean; keyCode?: number };
                    if (native.key !== 'Enter') return;
                    // 中日韩输入法「回车确认候选词」也会发一个 Enter —— 不挡住的话
                    // 每选一次词就把半截草稿发出去，中文用户几乎每句话都中招。
                    // 判据与 RNW 内部的 isEventComposing 一致（见 TextInput：
                    // isComposing || keyCode === 229），它自己的 submit 分支
                    // 也是这么挡的，我们别把它绕过去。
                    if (native.isComposing || native.keyCode === 229) return;
                    event.preventDefault();
                    void handleSend();
                  }
                : undefined
            }
            onFocus={() => {
              LayoutAnimation.configureNext(PANEL_LAYOUT_ANIM);
              setAttachmentOpen(false);
              setEmojiOpen(false);
              setMentionPickerVisible(false);
            }}
            editable={!isPreviewMode && !composerLocked}
          />
          <Pressable onPress={handleEmojiToggle} hitSlop={8} disabled={isPreviewMode}>
            <Ionicons
              name="happy-outline"
              size={22}
              color={emojiOpen ? colors.iconAccent : colors.textSecondary}
            />
          </Pressable>
        </View>
      )}

      {/* 右侧：发送/附件。录音中由全屏浮层接管，禁用。 */}
      <Pressable
        key="voice-right"
        testID={E2E_TEST_IDS.chatSend}
        style={[s.circleBtn, s.composerActionBtn, d.circleBtn, d.composerActionBtn]}
        onPress={draft.trim() || pendingCard ? handleSend : handleAttachmentToggle}
        disabled={sending || isPreviewMode || isVoiceRecording || composerLocked}
        accessibilityRole="button"
        accessibilityLabel={
          draft.trim() || pendingCard
            ? t('common.send')
            : t('chat.detail.attachmentPanelLabel', {
                defaultValue: '打开附件面板',
              })
        }
      >
        <Ionicons
          name={draft.trim() || pendingCard ? 'send' : 'add'}
          size={22}
          color={colors.textSecondary}
        />
      </Pressable>
    </View>
  );
}
