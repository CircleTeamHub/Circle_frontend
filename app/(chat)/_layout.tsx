import { Stack } from 'expo-router';
import { useTheme } from '@/theme';

export default function ChatLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
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
