import { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { NavHeader } from '@/components/ui/nav-header';
import { buildChatInfoState } from '@/features/chat/chat-info';
import {
  clearConversationMessages,
  setConversationBurnDuration,
  setConversationMute,
  toggleConversationPinned,
} from '@/im/client';
import {
  getEditFriendRemarkHref,
  getEditFriendTagsHref,
} from '@/features/user/utils/routes';
import { useIMStore } from '@/stores/imStore';
import { Radius, Spacing, useTheme } from '@/theme';

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  section: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
  },
});

export default function ChatInfoScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    id?: string;
    sourceID?: string;
    name?: string;
    title?: string;
    conversationID?: string;
  }>();
  const [blacklist, setBlacklist] = useState(false);
  const conversations = useIMStore((state) => state.conversations);

  const friendId =
    typeof params.id === 'string'
      ? params.id
      : typeof params.sourceID === 'string'
        ? params.sourceID
        : '';
  const friendName =
    typeof params.name === 'string'
      ? params.name
      : typeof params.title === 'string'
        ? params.title
        : '好友';
  const routeSourceID = friendId;
  const conversationID =
    typeof params.conversationID === 'string' ? params.conversationID : '';
  const conversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.conversationID === conversationID) ??
      conversations.find((conversation) => conversation.sourceID === routeSourceID) ??
      null,
    [conversationID, conversations, routeSourceID],
  );
  const resolvedConversationID = conversation?.conversationID ?? '';
  const { pinned, muted, burnLabel } = useMemo(
    () => buildChatInfoState(conversation),
    [conversation],
  );

  const openUnsupportedAction = useCallback((label: string) => {
    Alert.alert('暂未开放', `${label} 稍后提供。`);
  }, []);

  const handleOpenRemark = useCallback(() => {
    if (!friendId) {
      return;
    }

    router.push(getEditFriendRemarkHref('messages', friendId, friendName));
  }, [friendId, friendName]);

  const handleOpenTags = useCallback(() => {
    if (!friendId) {
      return;
    }

    router.push(getEditFriendTagsHref('messages', friendId, friendName));
  }, [friendId, friendName]);

  const handleDeleteContact = useCallback(() => {
    openUnsupportedAction('删除联系人');
  }, [openUnsupportedAction]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      section: {
        backgroundColor: colors.surface,
      },
    }),
    [colors],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="聊天信息" />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.section, d.section]}>
          <MenuRow icon="create-outline" label="设置备注" onPress={handleOpenRemark} />
          <Divider />
          <MenuRow icon="pricetag-outline" label="标签" onPress={handleOpenTags} />
          <Divider />
          <MenuRow
            icon="image-outline"
            label="聊天背景"
            rightText="跟随全局"
            onPress={() => openUnsupportedAction('聊天背景')}
          />
          <Divider />
          <MenuRow
            icon="arrow-up-circle-outline"
            label="置顶聊天"
            hasToggle
            onToggle={(nextPinned) =>
              resolvedConversationID
                ? void toggleConversationPinned(resolvedConversationID, nextPinned)
                : undefined
            }
            toggleValue={pinned}
            showArrow={false}
          />
          <Divider />
          <MenuRow
            icon="notifications-off-outline"
            label="消息免打扰"
            hasToggle
            onToggle={(nextMuted) =>
              resolvedConversationID
                ? void setConversationMute(resolvedConversationID, nextMuted)
                : undefined
            }
            toggleValue={muted}
            showArrow={false}
          />
          <Divider />
          <MenuRow
            icon="flame-outline"
            label="好友消息自毁"
            onPress={() =>
              resolvedConversationID
                ? void setConversationBurnDuration(
                    resolvedConversationID,
                    conversation?.burnDuration ?? 0,
                  )
                : undefined
            }
            rightText={burnLabel}
          />
        </View>

        <View style={[s.section, d.section]}>
          <MenuRow
            icon="share-social-outline"
            label="把他推荐给朋友"
            onPress={() => openUnsupportedAction('把他推荐给朋友')}
          />
          <Divider />
          <MenuRow
            icon="ban-outline"
            label="加入黑名单"
            hasToggle
            toggleValue={blacklist}
            onToggle={setBlacklist}
            showArrow={false}
          />
          <Divider />
          <MenuRow
            icon="trash-outline"
            label="清空聊天记录"
            onPress={() =>
              resolvedConversationID
                ? void clearConversationMessages(resolvedConversationID)
                : undefined
            }
          />
          <Divider />
          <MenuRow
            icon="warning-outline"
            label="投诉举报"
            onPress={() => openUnsupportedAction('投诉举报')}
          />
        </View>

        <View style={[s.section, d.section]}>
          <MenuRow
            icon="person-remove-outline"
            label="删除联系人"
            destructive
            onPress={handleDeleteContact}
          />
        </View>
      </ScrollView>
    </View>
  );
}
