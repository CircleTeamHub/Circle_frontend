import {
  LayoutAnimation,
  Modal,
  type NativeSyntheticEvent,
  type PanResponderInstance,
  Platform,
  Pressable,
  Text,
  TextInput,
  type TextInputKeyPressEventData,
  useWindowDimensions,
  View,
} from 'react-native';
import { chatDetailStyles as s } from '@/features/chat/chat-detail/styles';
import { GlassSurface } from '@/components/ui/glass-surface';
import { Spacing, useTheme, withAlpha, type ThemeColors } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { PANEL_LAYOUT_ANIM, type AttachmentId } from '@/features/chat/chat-detail/constants';
import { type EdgeInsets } from 'react-native-safe-area-context';
import { type TFunction } from 'i18next';
import { useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { MODAL_INPUT_NATIVE_AUTO_FOCUS, useModalInputAutoFocus } from '@/hooks/use-modal-input-auto-focus';
import {
  type ChatDetailThemedStyles,
} from '@/features/chat/chat-detail/hooks/use-chat-detail-themed-styles';
import { type PlazaPostCardData } from '@/types';

const COMPOSER_LINE_HEIGHT = 24;
const COMPOSER_VERTICAL_PADDING = 12;
const INLINE_COMPOSER_MAX_LINES = 4;

export interface ChatComposerBarProps {
  insets: EdgeInsets;
  blurTarget?: RefObject<View | null>;
  colors: ThemeColors;
  t: TFunction<"translation", undefined>;
  draft: string;
  inputRef: RefObject<TextInput | null>;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  mentionPicker: ReactNode;
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
  /** 快捷键直达「+」面板里的同名入口（多媒体 / 笔记 / 位置）。 */
  handleAttachmentAction: (id: AttachmentId) => void;
  /** 双向清空快捷键；不传就不显示（群聊没有双向清空）。 */
  onClearHistory?: () => void;
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
 * 输入栏玻璃卡片:上面是输入框(语音模式换成按住说话条)+ 发送按钮;下面一排快捷键:
 * 语音、多媒体、笔记、位置、双向清空(仅私聊)、表情、「+」面板。
 */
export function ChatComposerBar({
  insets,
  blurTarget,
  colors,
  t,
  draft,
  inputRef,
  expanded,
  setExpanded,
  mentionPicker,
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
  handleAttachmentAction,
  onClearHistory,
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
  const { fontScale } = useWindowDimensions();
  const lineHeight = COMPOSER_LINE_HEIGHT * fontScale;
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [inputWidth, setInputWidth] = useState(0);
  const expandedInputRef = useRef<TextInput>(null);
  useModalInputAutoFocus(expandedInputRef, expanded);

  // RN Web's content size includes the textarea viewport. Measure at zero
  // height so a draft also shrinks when lines are removed or the pane widens.
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || !inputWidth || voiceInputMode) return;
    const node = inputRef.current as unknown as HTMLTextAreaElement | null;
    if (!node) return;
    const height = node.style.height;
    node.style.height = '0px';
    const measured = node.scrollHeight;
    node.style.height = height;
    setMeasuredHeight(measured);
  }, [draft, inputRef, inputWidth, voiceInputMode]);

  const canEdit = !isPreviewMode && !composerLocked;
  const inputPadding = COMPOSER_VERTICAL_PADDING * 2;
  const singleLineHeight = lineHeight + inputPadding;
  const textHeight = draft ? Math.max(singleLineHeight, measuredHeight) : singleLineHeight;
  const maxInputHeight = lineHeight * INLINE_COMPOSER_MAX_LINES + inputPadding;
  const multiLineDraft = !voiceInputMode && textHeight > singleLineHeight + lineHeight / 2;
  const canExpand = multiLineDraft && canEdit;
  const closeExpanded = () => setExpanded(false);
  const hasContent = Boolean(draft.trim() || pendingCard);
  const mutedInk = withAlpha(colors.text, dark ? 0.5 : 0.55);
  const buttonFill = withAlpha(colors.text, dark ? 0.09 : 0.05);
  const toolDisabled = isPreviewMode || isVoiceRecording || composerLocked;
  // 输入框下面的快捷键行。表情 / 「+」开关各自的面板；其余直达「+」面板里的同名入口。
  const shortcuts: {
    key: string;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    disabled: boolean;
    active?: boolean;
  }[] = [
    {
      key: 'voice',
      icon: voiceInputMode ? 'keypad-outline' : 'mic-outline',
      label: t('chat.detail.voiceInputLabel'),
      onPress: toggleVoiceInputMode,
      // 网页端的 webm/opus 语音尚不能跨端播放，仅展示入口；App 保留原录音流程。
      disabled: Platform.OS === 'web' || toolDisabled,
      active: voiceInputMode,
    },
    {
      key: 'media',
      icon: 'image-outline',
      label: t('chat.attachments.mediaHub', { defaultValue: '多媒体' }),
      onPress: () => handleAttachmentAction('media'),
      disabled: toolDisabled,
    },
    {
      key: 'notes',
      icon: 'document-text-outline',
      label: t('chat.attachments.notes', { defaultValue: '笔记' }),
      onPress: () => handleAttachmentAction('notes'),
      disabled: toolDisabled,
    },
    {
      key: 'location',
      icon: 'location-outline',
      label: t('chat.attachments.location', { defaultValue: '位置' }),
      onPress: () => handleAttachmentAction('location'),
      disabled: toolDisabled,
    },
    ...(onClearHistory
      ? [{
          key: 'clear-both-sides',
          icon: 'trash-outline' as const,
          label: t('chat.clearHistoryBothSides', { defaultValue: '双向清空' }),
          onPress: onClearHistory,
          disabled: isPreviewMode,
        }]
      : []),
    {
      key: 'emoji',
      icon: 'happy-outline',
      label: t('chat.detail.emojiPanelLabel'),
      onPress: () => {
        if (voiceInputMode) toggleVoiceInputMode();
        handleEmojiToggle();
      },
      disabled: toolDisabled,
      active: emojiOpen,
    },
    {
      key: 'more',
      icon: 'add-circle-outline',
      label: t('chat.detail.attachmentPanelLabel', { defaultValue: '打开附件面板' }),
      onPress: handleAttachmentToggle,
      disabled: toolDisabled,
      active: attachmentOpen,
    },
  ];
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
        radius={28}
        style={[
          s.composerShell,
          {
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
        {/* 上一行：输入框（语音模式换成按住说话条，gesture 元素全程保持挂载）+ 发送。 */}
        <View style={[s.composerInputRow, multiLineDraft && s.composerInputRowMultiline]}>
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
              style={[
                s.composerInput,
                d.composerInput,
                {
                  minHeight: singleLineHeight,
                  maxHeight: maxInputHeight,
                  // Native text inputs measure their own text as part of layout.
                  height: Platform.OS === 'web' ? Math.min(textHeight, maxInputHeight) : undefined,
                  lineHeight: COMPOSER_LINE_HEIGHT,
                  paddingVertical: COMPOSER_VERTICAL_PADDING,
                },
              ]}
              multiline
              submitBehavior="newline"
              scrollEnabled={textHeight >= maxInputHeight}
              onLayout={({ nativeEvent: { layout } }) => {
                if (Platform.OS === 'web') setInputWidth(layout.width);
                else setMeasuredHeight(layout.height);
              }}
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
              // Web：Enter 发送，Shift+Enter 换行。原生键盘的回车始终换行。
              onKeyPress={
                Platform.OS === 'web'
                  ? (
                      event: NativeSyntheticEvent<TextInputKeyPressEventData>,
                    ) => {
                      // DOM 的 KeyboardEvent 带这两个字段，RN 的类型里没有。
                      const native = event.nativeEvent as
                        & TextInputKeyPressEventData
                        & { isComposing?: boolean; keyCode?: number; shiftKey?: boolean };
                      if (native.key !== 'Enter' || native.shiftKey) return;
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

          {canExpand ? (
            <Pressable
              style={[s.circleBtn, s.expandComposerButton]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('chat.detail.expandComposer')}
              onPress={() => {
                setAttachmentOpen(false);
                setEmojiOpen(false);
                setExpanded(true);
              }}
            >
              <Ionicons name="expand-outline" size={20} color={mutedInk} />
            </Pressable>
          ) : null}
          {voiceInputMode ? null : (
            <Pressable
              testID={E2E_TEST_IDS.chatSend}
              style={[s.composerSendBtn, { backgroundColor: buttonFill, opacity: hasContent ? 1 : 0.4 }]}
              onPress={handleSend}
              disabled={!hasContent || sending || isPreviewMode || isVoiceRecording || composerLocked}
              accessibilityRole="button"
              accessibilityLabel={t('common.send')}
            >
              <Ionicons name="arrow-up" size={24} color={colors.text} />
            </Pressable>
          )}
        </View>

        {/* 下一行：快捷键。 */}
        <View style={s.composerToolbar}>
          {shortcuts.map((item) => (
            <Pressable
              key={item.key}
              style={s.composerToolbarBtn}
              onPress={item.onPress}
              disabled={item.disabled}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: item.active === true, disabled: item.disabled }}
            >
              <Ionicons
                name={item.icon}
                size={24}
                color={item.active ? colors.iconAccent : item.disabled ? withAlpha(colors.text, 0.3) : colors.text}
              />
            </Pressable>
          ))}
        </View>
      </GlassSurface>
      <Modal
        visible={expanded}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={closeExpanded}
      >
        <KeyboardAvoidingContainer
          style={[s.expandedComposer, { backgroundColor: colors.surface, paddingTop: insets.top }]}
        >
          <View style={s.expandedComposerHeader}>
            <Text style={[s.expandedComposerTitle, { color: colors.text }]}>{t('chat.detail.expandedComposerTitle')}</Text>
            <Pressable
              style={s.circleBtn}
              onPress={closeExpanded}
              accessibilityRole="button"
              accessibilityLabel={t('chat.detail.collapseComposer')}
            >
              <Ionicons name="contract-outline" size={24} color={colors.text} />
            </Pressable>
          </View>
          <TextInput
            ref={expandedInputRef}
            testID="chat-expanded-input"
            accessibilityLabel={t('chat.detail.inputPlaceholder')}
            autoFocus={MODAL_INPUT_NATIVE_AUTO_FOCUS}
            style={[s.expandedComposerInput, d.composerInput, { lineHeight: COMPOSER_LINE_HEIGHT }]}
            multiline
            submitBehavior="newline"
            editable={canEdit}
            value={draft}
            onChangeText={handleDraftChange}
            selection={selection}
            onSelectionChange={handleSelectionChange}
          />
          {expanded ? mentionPicker : null}
          <View style={[s.expandedComposerFooter, { paddingBottom: keyboardVisible ? Spacing.sm : Math.max(insets.bottom, Spacing.sm) }]}>
            <Pressable
              style={[s.circleBtn, { backgroundColor: colors.primary, opacity: hasContent && canEdit ? 1 : 0.45 }]}
              accessibilityRole="button"
              accessibilityLabel={t('common.send')}
              testID="chat-expanded-send"
              disabled={!hasContent || sending || !canEdit}
              onPress={() => {
                closeExpanded();
                void handleSend();
              }}
            >
              <Ionicons name="send" size={22} color={colors.white} />
            </Pressable>
          </View>
        </KeyboardAvoidingContainer>
      </Modal>
    </View>
  );
}
