import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';

export default function MessagesLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="chat-detail" />
      <Stack.Screen name="chat-info" />
      <Stack.Screen name="chat-history-search" />
      <Stack.Screen name="chat-history-text" />
      <Stack.Screen name="chat-history-media" />
      <Stack.Screen name="chat-history-files" />
      <Stack.Screen name="chat-history-date" />
      {/* `title` 在 headerShown:false 下不显示，但 expo-router 会用它做无障碍提示 + 标签页历史。
         头屏内部各自有自己的 NavHeader，所以这里只配 a11y 用途的 title。 */}
      <Stack.Screen
        name="chat-background"
        options={{
          title: t('messages.chatBackgroundTitle', { defaultValue: '聊天背景' }),
        }}
      />
      <Stack.Screen
        name="recommend-friend"
        options={{
          title: t('messages.recommendFriendTitle', {
            defaultValue: '推荐给朋友',
          }),
        }}
      />
      <Stack.Screen name="user/[id]" />
      <Stack.Screen name="add-friend" />
      <Stack.Screen name="find" />
      <Stack.Screen name="groups" />
      <Stack.Screen name="temp-chats" />
      <Stack.Screen name="new-group" />
      <Stack.Screen name="invite-group-members" />
    </Stack>
  );
}
