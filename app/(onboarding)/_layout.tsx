import { Stack } from 'expo-router';
import { probeScreenLayout } from '@/observability/screen-probe';

export default function OnboardingLayout() {
  return (
    <Stack
      screenLayout={probeScreenLayout}
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,
      }}
    />
  );
}
