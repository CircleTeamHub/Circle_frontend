import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/chat-core/store';
import { NavHeader } from '@/components/ui/nav-header';
import { isGroupManager } from '@/features/chat/group-admin-permissions';
import {
  getEditGroupNoticeHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';
import { Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  notice: { ...Typography.bodyRegular, lineHeight: 26 },
  edit: { ...Typography.body },
});

/**
 * 群公告详情:聊天页顶部的公告横幅点进来。页面只有公告正文(可长按复制),
 * 群主 / 管理员右上角「编辑」进编辑页;编辑页保存后回写 store,这里跟着刷新。
 */
export default function GroupNoticeScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const scope = getUserProfileScopeFromSegments(useSegments());
  const { conversationID = '' } = useLocalSearchParams<{ conversationID?: string }>();
  const conversation = useChatStore((state) =>
    state.conversations.find((item) => item.id === conversationID),
  );
  const notice = conversation?.notice?.trim() ?? '';
  const canEdit = isGroupManager(conversation?.myRole);

  const handleEdit = useCallback(() => {
    if (!conversation) return;
    router.push(
      getEditGroupNoticeHref(scope, {
        // 圈子群的公告写回圈子(编辑页据此加圈子写标记);独立群传空串。
        groupID: conversation.circleId ?? '',
        conversationID: conversation.id,
        groupTitle: conversation.name ?? undefined,
        notice,
        noticePinned: conversation.noticePinned ?? false,
      }),
    );
  }, [conversation, notice, scope]);

  return (
    <View
      testID="group-notice-screen"
      style={[s.container, { paddingTop: insets.top, backgroundColor: colors.background }]}
    >
      <NavHeader
        title={t('chat.groupNotice')}
        rightSlot={
          canEdit ? (
            <Pressable testID="group-notice-edit" onPress={handleEdit} hitSlop={8} accessibilityRole="button">
              <Text style={[s.edit, { color: colors.primary }]}>{t('chat.groupNoticeEdit')}</Text>
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView
        contentContainerStyle={[s.body, { paddingBottom: insets.bottom + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <Text selectable style={[s.notice, { color: notice ? colors.text : colors.textSecondary }]}>
          {notice || t('chat.noGroupNotice')}
        </Text>
      </ScrollView>
    </View>
  );
}
