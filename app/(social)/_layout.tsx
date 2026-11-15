import { Stack } from 'expo-router';
import { useTheme } from '@/theme';
import { probeScreenLayout } from '@/observability/screen-probe';

export default function SocialLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenLayout={probeScreenLayout}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        gestureDirection: 'horizontal',
      }}
    />
  );
}
