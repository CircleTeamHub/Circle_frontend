import { useTheme } from '@/theme';
import { Stack } from 'expo-router';

export default function NotesLayout() {
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
      {/* 写了任何一个 Stack.Screen,写出来的就排在最前、第一个就是这个栈的首屏:index 必须写在第一个。 */}
      <Stack.Screen name="index" />
      <Stack.Screen
        name="location-picker"
        options={{ fullScreenGestureEnabled: false }}
      />
    </Stack>
  );
}
