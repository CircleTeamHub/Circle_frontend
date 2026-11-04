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
import { GlassSurface } from '@/components/ui/glass-surface';
import { Spacing, useTheme, withAlpha, type ThemeColors } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { PANEL_LAYOUT_ANIM } from '@/features/chat/chat-detail/constants';
import { type EdgeInsets } from 'react-native-safe-area-context';
import { type TFunction } from 'i18next';
import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
  type ChatDetailThemedStyles,
} from '@/features/chat/chat-detail/hooks/use-chat-detail-themed-styles';
import { type PlazaPostCardData } from '@/types';

export interface ChatComposerBarProps {
  insets: EdgeInsets;
  blurTarget?: RefObject<View | null>;
  colors: ThemeColors;
  t: TFunction<"translation", undefined>;
  draft: string;
  inputRef?: RefObject<TextInput | null>;
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
  blurTarget,
  colors,
  t,
  draft,
  inputRef,
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
  const { resolvedMode } = useTheme();
  const dark = resolvedMode === 'dark';
  const hasContent = Boolean(draft.trim() || pendingCard);
  const compactButton = hasContent ? { width: 44, height: 44, borderRadius: 22 } : undefined;
  const mutedInk = withAlpha(colors.text, dark ? 0.5 : 0.55);
  const buttonFill = withAlpha(colors.text, dark ? 0.09 : 0.05);
  return (
    <View
      pointerEvents="box-none"
      style={[
        s.inputBar,
        d.inputBar,
        {
          // 键盘弹起 / 面板展开时无需安全区 padding（键盘或面板已占住底部），紧贴即可；
          // 底部裸露时保留安全区与至少 12pt 的悬浮间距；间距透明，消息仍从后方滚过。
          paddingBottom:
            attachmentOpen || emojiOpen || keyboardVisible
              ? Spacing.sm
              : Math.max(insets.bottom, 12),
        },
      ]}
    >
      <GlassSurface
        material="composer"
        blurTarget={blurTarget}
        radius={35}
        style={[
          s.composerShell,
          {
            gap: hasContent ? 4 : 10,
            borderColor: withAlpha(colors.text, dark ? 0.12 : 0.1),
            boxShadow: `0 6px 18px ${withAlpha(colors.black, 0.12)}, inset 0 1px 4px ${withAlpha(colors.white, dark ? 0.12 : 0.7)}`,
          },
        ]}
      >
        <View
          pointerEvents="none"
          style={[
            s.composerSheen,
            {
              backgroundColor: withAlpha(colors.white, dark ? 0.04 : 0.12),
              borderTopColor: withAlpha(colors.white, dark ? 0.12 : 0.75),
            },
          ]}
        />
        <Pressable
          style={[s.circleBtn, compactButton, { backgroundColor: buttonFill }]}
          onPress={handleAttachmentToggle}
          disabled={isPreviewMode || isVoiceRecording || composerLocked}
          accessibilityRole="button"
          accessibilityLabel={t('chat.detail.attachmentPanelLabel', { defaultValue: '打开附件面板' })}
          accessibilityState={{ expanded: attachmentOpen }}
        >
          <Ionicons name="add" size={26} color={mutedInk} />
        </Pressable>

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
          <TextInput
              ref={inputRef}
            key="text-input"
            testID={E2E_TEST_IDS.chatInput}
            accessibilityLabel={t('chat.detail.inputPlaceholder')}
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
                  : ''
            }
            placeholderTextColor={mutedInk}
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
        )}

        {/* 麦克风固定在表情按钮左边；发送入口按草稿显示，排在最右。 */}
        <Pressable
          key="voice"
          style={[s.circleBtn, compactButton, { backgroundColor: buttonFill }]}
          onPress={toggleVoiceInputMode}
          // 网页端的 webm/opus 语音尚不能跨端播放，仅展示入口；App 保留原录音流程。
          disabled={Platform.OS === 'web' || isPreviewMode || isVoiceRecording || composerLocked}
          accessibilityRole="button"
          accessibilityLabel={t('chat.detail.voiceInputLabel')}
          accessibilityState={{ selected: voiceInputMode }}
        >
          <Ionicons name={voiceInputMode ? 'keypad-outline' : 'mic-outline'} size={24} color={mutedInk} />
        </Pressable>
        <Pressable
          style={[
            s.circleBtn,
            s.composerActionBtn,
            compactButton,
            { backgroundColor: colors.white, borderColor: withAlpha(colors.black, 0.06) },
          ]}
          onPress={() => {
            if (voiceInputMode) toggleVoiceInputMode();
            handleEmojiToggle();
          }}
          disabled={isPreviewMode || isVoiceRecording || composerLocked}
          accessibilityRole="button"
          accessibilityLabel={t('chat.detail.emojiPanelLabel')}
          accessibilityState={{ expanded: emojiOpen }}
        >
          <Ionicons name="happy-outline" size={26} color={emojiOpen ? colors.primaryDeep : colors.black} />
        </Pressable>
        {hasContent ? (
          <Pressable
            key="send"
            testID={E2E_TEST_IDS.chatSend}
            style={[s.circleBtn, compactButton, { backgroundColor: buttonFill }]}
            onPress={handleSend}
            disabled={sending || isPreviewMode || isVoiceRecording || composerLocked}
            accessibilityRole="button"
            accessibilityLabel={t('common.send')}
          >
            <Ionicons name="arrow-up" size={24} color={colors.text} />
          </Pressable>
        ) : null}
      </GlassSurface>
    </View>
  );
}
