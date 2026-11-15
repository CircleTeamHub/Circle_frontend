import { Stack } from 'expo-router';
import { DesktopCenteredColumn } from '@/components/app/desktop-centered-column';
import { useTheme } from '@/theme';
import { probeScreenLayout } from '@/observability/screen-probe';

// 跨 tab 压栈时给栈底垫上首页，保证返回有处可去、tab 不会卡死在被压入的页面。
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function ProfileLayout() {
  const { colors } = useTheme();

  return (
    <DesktopCenteredColumn>
      <Stack
        screenLayout={probeScreenLayout}
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
          gestureDirection: 'horizontal',
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </DesktopCenteredColumn>
  );
}
