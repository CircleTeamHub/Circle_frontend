import { Stack } from 'expo-router';
import { DesktopCenteredColumn } from '@/components/app/desktop-centered-column';
import { useTheme } from '@/theme';

// 跨 tab 压栈（如横幅 push 到本栈的 new-friends）时，给栈底垫上首页，
// 保证返回有处可去、tab 不会卡死在被压入的页面。
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function ContactsLayout() {
  const { colors } = useTheme();

  return (
    <DesktopCenteredColumn>
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
    </DesktopCenteredColumn>
  );
}
