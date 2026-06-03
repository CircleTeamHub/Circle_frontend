import { Stack } from 'expo-router';
import { useTheme } from '@/theme';

export default function MessagesLayout() {
  const { colors } = useTheme();

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
      <Stack.Screen name="chat-background" options={{ title: '聊天背景' }} />
      <Stack.Screen name="recommend-friend" options={{ title: '推荐给朋友' }} />
      <Stack.Screen name="user/[id]" />
      <Stack.Screen name="add-friend" />
      <Stack.Screen name="find" />
      <Stack.Screen name="groups" />
      <Stack.Screen name="new-group" />
      <Stack.Screen name="invite-group-members" />
    </Stack>
  );
}
