import { Stack } from 'expo-router';
import { useTheme } from '@/theme';

export default function ChatLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        // 看不见的页面冻结渲染(切走的 tab、栈里更深的页面),不再跟着每条消息重算。
        freezeOnBlur: true,
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        gestureDirection: 'horizontal',
      }}>
      <Stack.Screen
        name="location-picker"
        options={{ fullScreenGestureEnabled: false }}
      />
      <Stack.Screen
        name="group-call"
        options={{ fullScreenGestureEnabled: false }}
      />
    </Stack>
  );
}
