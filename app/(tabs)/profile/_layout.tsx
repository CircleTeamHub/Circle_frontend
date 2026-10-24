import { Stack } from 'expo-router';
import { DesktopCenteredColumn } from '@/components/app/desktop-centered-column';
import { useTheme } from '@/theme';

// 跨 tab 压栈时给栈底垫上首页，保证返回有处可去、tab 不会卡死在被压入的页面。
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function ProfileLayout() {
  const { colors } = useTheme();

  return (
    <DesktopCenteredColumn>
      <Stack
        screenOptions={{
          // 看不见的页面冻结渲染(切走的 tab、栈里更深的页面),不再跟着每条消息重算。
          freezeOnBlur: true,
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
