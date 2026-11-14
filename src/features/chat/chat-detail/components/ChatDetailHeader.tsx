import { useMemo, type RefObject } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { GlassSurface } from '@/components/ui/glass-surface';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { Avatar } from '@/components/ui/avatar';
import { AssistantFloatingHeader } from '@/features/assistant/components/AssistantFloatingHeader';
import { useChatRouter } from '@/features/chat/chat-detail/hooks/use-chat-router';
import {
  CHAT_HEADER_CONTROL_SIZE,
  ChatHeaderFade,
  ChatHeaderGlassButton,
  chatHeaderFloatStyle,
  chatHeaderPressedStyle,
} from '@/features/chat/chat-detail/components/ChatHeaderGlass';
import { getChatInfoTopHref, type UserProfileScope } from '@/features/user/utils/routes';
import { type ChatSheetActions, type EmbeddedChatParams } from '@/features/chat/chat-detail/types';
import { Spacing, Typography, useTheme, type ThemeColors } from '@/theme';

export interface ChatDetailHeaderProps {
  embedded: EmbeddedChatParams | undefined;
  /** 半屏快捷聊天:左边是关闭,右边是展开成完整聊天页。 */
  sheet?: ChatSheetActions;
  colors: ThemeColors;
  scope: UserProfileScope;
  sourceID: string;
  conversationID: string;
  isTempChat: boolean;
  isAssistant: boolean;
  isGroupChat: boolean;
  conversationTitle: string;
  avatarUrl: string | undefined;
  handleBack: () => void;
  handleOpenHeaderTarget: () => void;
  headerStatusText: string;
  /** 在线 / 正在输入的小圆点与副标题颜色。 */
  statusColor: string;
  /** 顶部渐隐用的颜色 = 消息区底色,渐隐才和后面的消息接得上。 */
  fadeColor: string;
  /** Android 的玻璃只采样消息层,避免把顶栏自己采进模糊。 */
  blurTarget?: RefObject<View | null>;
  assistantSpinning?: boolean;
}

/**
 * 聊天页头部。小助手用自己的角色头部;其余会话是悬浮在消息上的三颗玻璃控件:
 * 圆形返回(桌面分栏内嵌时不显示)、头像 + 标题 + 在线状态的胶囊、圆形「更多」。
 */
export function ChatDetailHeader({ isAssistant, assistantSpinning = false, ...props }: ChatDetailHeaderProps) {
  if (isAssistant) {
    return (
      <AssistantFloatingHeader
        onBack={props.sheet ? props.sheet.onClose : props.embedded ? undefined : props.handleBack}
        spinning={assistantSpinning}
        title={props.conversationTitle}
      />
    );
  }
  return <FloatingChatHeader {...props} />;
}

function FloatingChatHeader({
  embedded,
  sheet,
  colors,
  scope,
  sourceID,
  conversationID,
  isTempChat,
  isGroupChat,
  conversationTitle,
  avatarUrl,
  handleBack,
  handleOpenHeaderTarget,
  headerStatusText,
  statusColor,
  fadeColor,
  blurTarget,
}: Omit<ChatDetailHeaderProps, 'isAssistant' | 'assistantSpinning'>) {
  const chatRouter = useChatRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { resolvedMode } = useTheme();
  const floatStyle = useMemo(
    () => chatHeaderFloatStyle(colors, resolvedMode === 'dark'),
    [colors, resolvedMode],
  );
  const glass = { colors, floatStyle, blurTarget };

  const openChatInfo = () =>
    chatRouter.push(
      getChatInfoTopHref(scope, {
        conversationID,
        sourceID,
        title: conversationTitle,
        conversationType: isGroupChat ? 'group' : 'private',
        originScope: scope,
      }),
    );

  return (
    <View
      testID="chat-detail-header"
      pointerEvents="box-none"
      // 半屏聊天挂在底部弹层里,上面没有状态栏,只留一点呼吸位。
      style={[s.header, { paddingTop: sheet ? Spacing.sm : insets.top + Spacing.xs }]}
    >
      <ChatHeaderFade color={fadeColor} />
      {sheet ? (
        <ChatHeaderGlassButton {...glass} icon="close" label={t('common.close')} onPress={sheet.onClose} />
      ) : embedded ? (
        // 桌面分栏没有返回键:占一颗按钮的位,标题胶囊才在正中。
        <View testID="chat-detail-header-leading-spacer" style={s.leadingSpacer} />
      ) : (
        <ChatHeaderGlassButton
          {...glass}
          testID={E2E_TEST_IDS.chatBack}
          icon="chevron-back"
          label={t('common.back')}
          onPress={handleBack}
          iconStyle={s.backIcon}
        />
      )}
      <View testID="chat-detail-header-title-slot" style={s.titleSlot} pointerEvents="box-none">
        <Pressable
          onPress={handleOpenHeaderTarget}
          accessibilityRole="button"
          accessibilityLabel={conversationTitle}
          style={({ pressed }) => [s.titlePress, chatHeaderPressedStyle(pressed)]}
        >
          <GlassSurface
            material="banner"
            radius={CHAT_HEADER_CONTROL_SIZE / 2}
            blurTarget={blurTarget}
            style={[s.titlePill, floatStyle]}
          >
            {isGroupChat ? (
              <GroupChatAvatar
                size={AVATAR_SIZE}
                shape="circle"
                name={conversationTitle}
                uri={avatarUrl}
                temporary={isTempChat}
                badgeBorderColor={colors.surface}
              />
            ) : (
              <Avatar size={AVATAR_SIZE} shape="circle" name={conversationTitle} uri={avatarUrl} />
            )}
            <View testID="chat-detail-header-title-text" style={s.titleText}>
              <Text numberOfLines={1} style={[s.name, { color: colors.text }]}>
                {conversationTitle}
              </Text>
              {headerStatusText ? (
                <View testID="chat-detail-header-status" style={s.statusRow}>
                  <View style={[s.statusDot, { backgroundColor: statusColor }]} />
                  <Text numberOfLines={1} style={[s.status, { color: statusColor }]}>
                    {headerStatusText}
                  </Text>
                </View>
              ) : null}
            </View>
          </GlassSurface>
        </Pressable>
      </View>
      {sheet ? (
        <ChatHeaderGlassButton
          {...glass}
          icon="expand-outline"
          label={t('chat.quickChat.expand', { defaultValue: '展开完整聊天' })}
          onPress={sheet.onExpand}
        />
      ) : (
        <ChatHeaderGlassButton {...glass} icon="ellipsis-horizontal" label={t('chat.chatInfo')} onPress={openChatInfo} />
      )}
    </View>
  );
}

/** 胶囊高 44,头像 36 四周各留 4,左端正好是同心的半圆。 */
const AVATAR_SIZE = 36;
const PILL_INSET = (CHAT_HEADER_CONTROL_SIZE - AVATAR_SIZE) / 2;

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  backIcon: { marginLeft: -2 },
  leadingSpacer: { width: CHAT_HEADER_CONTROL_SIZE },
  // 两侧按钮一样宽,胶囊在中间这一格里居中 = 屏幕正中;按内容收缩,长名字在两颗按钮之间截断。
  titleSlot: { flex: 1, minWidth: 0, flexDirection: 'row', justifyContent: 'center' },
  titlePress: { flexShrink: 1, minWidth: 0 },
  titlePill: {
    height: CHAT_HEADER_CONTROL_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingLeft: PILL_INSET,
    paddingRight: Spacing.md,
    borderCurve: 'continuous',
  },
  // 名字和在线状态上下居中对齐。
  titleText: { flexShrink: 1, minWidth: 0, alignItems: 'center' },
  name: { ...Typography.body, fontWeight: '600', lineHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  status: { ...Typography.tinyRegular, lineHeight: 14 },
});
