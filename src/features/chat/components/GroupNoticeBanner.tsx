import { Alert, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/chat-core/store';
import { ScrollingAnnouncementBanner } from '@/components/ui/scrolling-announcement-banner';
import { Spacing } from '@/theme';

export function GroupNoticeBanner({ conversationID }: { conversationID: string }) {
  const { t } = useTranslation();
  const conversation = useChatStore(state => state.conversations.find(item => item.id === conversationID));
  const notice = conversation?.notice?.trim();
  if (conversation?.type !== 'GROUP' || !conversation.noticePinned || !notice) return null;
  return <View testID="group-notice-banner" style={styles.container}>
    <ScrollingAnnouncementBanner title="" body={notice} tag={t('chat.groupNotice')}
      onPress={() => Alert.alert(t('chat.groupNotice'), notice)} />
  </View>;
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
});
