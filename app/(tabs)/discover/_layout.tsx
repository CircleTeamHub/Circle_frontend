import { Stack } from 'expo-router';
import { DesktopCenteredColumn } from '@/components/app/desktop-centered-column';
import { useTheme } from '@/theme';

// 跨 tab 压栈（如聊天里点圈子名片 push 到本栈的 circle/[id]）时，给栈底垫上
// 首页：否则栈里只有被压入的页面，返回无处可去，tab 会永远卡在那个页面。
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function DiscoverLayout() {
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
