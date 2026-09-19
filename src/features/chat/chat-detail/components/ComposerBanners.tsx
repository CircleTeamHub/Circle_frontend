import { Pressable, Text, View } from 'react-native';
import { chatDetailStyles as s } from '@/features/chat/chat-detail/styles';
import { Ionicons } from '@expo/vector-icons';
import { buildQuotePreviewText } from '@/features/chat/utils/chat-send-payloads';
import { type ThemeColors } from '@/theme';
import { type TFunction } from 'i18next';
import { type Dispatch, type SetStateAction } from 'react';
import {
  type ChatDetailThemedStyles,
} from '@/features/chat/chat-detail/hooks/use-chat-detail-themed-styles';
import { type ChatMessage, type PlazaPostCardData } from '@/types';

export interface ComposerBannersProps {
  colors: ThemeColors;
  t: TFunction<"translation", undefined>;
  setDraft: Dispatch<SetStateAction<string>>;
  selfSilencedUntil: string | null;
  selfSilenced: boolean;
  composerLocked: boolean;
  d: ChatDetailThemedStyles;
  quoteTarget: ChatMessage | null;
  setQuoteTarget: Dispatch<SetStateAction<ChatMessage | null>>;
  editingMessageId: string | null;
  setEditingMessageId: Dispatch<SetStateAction<string | null>>;
  pendingCard: PlazaPostCardData | null;
  setPendingCard: Dispatch<SetStateAction<PlazaPostCardData | null>>;
}

/**
 * 输入栏上方的状态横条:正在编辑、正在引用、待发送的帖子卡片、禁言锁定说明。
 */
export function ComposerBanners({
  colors,
  t,
  setDraft,
  selfSilencedUntil,
  selfSilenced,
  composerLocked,
  d,
  quoteTarget,
  setQuoteTarget,
  editingMessageId,
  setEditingMessageId,
  pendingCard,
  setPendingCard,
}: ComposerBannersProps) {
  return (
    <>
      {editingMessageId ? (
        <View style={[s.quoteComposerBar, d.composerShell]}>
          <Text
            style={[s.quoteComposerText, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {t('chat.messageActions.editing', { defaultValue: '编辑消息' })}
          </Text>
          <Pressable
            onPress={() => {
              setEditingMessageId(null);
              setDraft('');
            }}
            hitSlop={8}
          >
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      {quoteTarget ? (
        <View style={[s.quoteComposerBar, d.composerShell]}>
          <Text
            style={[s.quoteComposerText, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {buildQuotePreviewText(quoteTarget, t)}
          </Text>
          <Pressable onPress={() => setQuoteTarget(null)} hitSlop={8}>
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      {pendingCard ? (
        <View style={[s.quoteComposerBar, d.composerShell]}>
          <Text
            style={[s.quoteComposerText, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {t('chat.plazaPostCard.pendingPreview', {
              title: pendingCard.title,
              defaultValue: '[活动] {{title}}',
            })}
          </Text>
          <Pressable onPress={() => setPendingCard(null)} hitSlop={8}>
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      {composerLocked ? (
        <View style={[s.silencedBar, d.silencedBar]} testID="chat-silenced-bar">
          <Ionicons name="lock-closed-outline" size={16} color={colors.textSecondary} />
          <Text style={[s.silencedBarText, d.silencedBarText]} numberOfLines={2}>
            {/* 被单独禁言优先说自己的状态:那是针对本人的,比「全员禁言」更具体。 */}
            {!selfSilenced
              ? t('chat.youAreMutedAll', {
                  defaultValue: '全员禁言中，仅群主和管理员可以发言',
                })
              : selfSilencedUntil
                ? t('chat.youAreSilencedUntil', {
                    time: new Date(selfSilencedUntil).toLocaleString(),
                    defaultValue: '你已被禁言，{{time}} 解除',
                  })
                : t('chat.youAreSilencedIndefinitely', {
                    defaultValue: '你已被禁言，等待管理员解除',
                  })}
          </Text>
        </View>
      ) : null}
    </>
  );
}
