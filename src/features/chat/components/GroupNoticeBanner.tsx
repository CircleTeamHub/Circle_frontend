import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/chat-core/store';
import { ScrollingAnnouncementBanner } from '@/components/ui/scrolling-announcement-banner';
import { useChatRouter } from '@/features/chat/chat-detail/hooks/use-chat-router';
import { getGroupNoticeHref, type UserProfileScope } from '@/features/user/utils/routes';
import { Spacing } from '@/theme';

export function GroupNoticeBanner({ conversationID, scope }: { conversationID: string; scope: UserProfileScope }) {
  const { t } = useTranslation();
  const chatRouter = useChatRouter();
  const conversation = useChatStore(state => state.conversations.find(item => item.id === conversationID));
  const notice = conversation?.notice?.trim();
  if (conversation?.type !== 'GROUP' || !conversation.noticePinned || !notice) return null;
  return <View testID="group-notice-banner" style={styles.container}>
    {/* 点开是公告详情页(全文 + 管理员编辑入口);半屏聊天里会先收起半屏再进。 */}
    <ScrollingAnnouncementBanner title="" body={notice} tag={t('chat.groupNotice')}
      onPress={() => chatRouter.push(getGroupNoticeHref(scope, conversationID))} />
  </View>;
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
});
