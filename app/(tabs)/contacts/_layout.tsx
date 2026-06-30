import { Stack } from 'expo-router';
import { useTheme } from '@/theme';

export default function ContactsLayout() {
  const { colors } = useTheme();

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
    />
  );
}
