import { Stack } from 'expo-router';
import { DesktopCenteredColumn } from '@/components/app/desktop-centered-column';
import { SKY_MAX_WIDTH } from '@/features/auth/components/login-sky-geometry';
import { probeScreenLayout } from '@/observability/screen-probe';

export default function OnboardingLayout() {
  return (
    <DesktopCenteredColumn maxWidth={SKY_MAX_WIDTH}>
      <Stack
        screenLayout={probeScreenLayout}
        screenOptions={{
          headerShown: false,
          gestureEnabled: false,
        }}
      />
    </DesktopCenteredColumn>
  );
}
