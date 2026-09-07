import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';

// 跨 tab 压栈（横幅/通知从其它 tab push 到本栈的 chat-detail 等）时，
// 给栈底垫上首页，保证返回有处可去、tab 不会卡死在被压入的页面。
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function MessagesLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        gestureDirection: 'horizontal',
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
      <Stack.Screen name="chat-history-date-results" />
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
      <Stack.Screen
        name="scan"
        options={{
          title: t('messages.scan', { defaultValue: '扫一扫' }),
        }}
      />
      {/* 扫一扫的两个落地页：ScanScreen 用 replace 换掉摄像头页，目标必须也在这个
          栈里，否则返回历史会连同 messages 栈一起被顶掉。外部系统相机的深链仍走
          顶层的 app/qr.tsx、app/qr-login.tsx。 */}
      <Stack.Screen name="qr" />
      <Stack.Screen name="qr-login" />
      <Stack.Screen name="search-group-members" />
      <Stack.Screen name="edit-group-notice" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="post-signups" />
    </Stack>
  );
}
