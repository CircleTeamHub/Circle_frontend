import { Stack } from 'expo-router';
import { DesktopCenteredColumn } from '@/components/app/desktop-centered-column';
import { useTheme } from '@/theme';

// 跨 tab 压栈（如消息页横幅点朋友圈通知 push 到本栈的 moment/[id]）时，给栈底垫上
// 首页：否则栈里只有被压入的页面，返回无处可去，tab 会永远卡在那个页面。
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function ExploreLayout() {
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
