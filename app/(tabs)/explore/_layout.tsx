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
      >
        {/* 写了任何一个 Stack.Screen,写出来的就排在最前、第一个就是进 tab 时的首屏:index 必须写在第一个。 */}
        <Stack.Screen name="index" />
        {/* 编辑笔记里的选位置页:往右拖地图不能被当成全屏右滑返回。 */}
        <Stack.Screen
          name="notes/location-picker"
          options={{ fullScreenGestureEnabled: false }}
        />
      </Stack>
    </DesktopCenteredColumn>
  );
}
