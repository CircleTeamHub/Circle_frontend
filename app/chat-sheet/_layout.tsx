import { Stack } from 'expo-router';
import { useTheme } from '@/theme';

/**
 * 半屏聊天(quick-chat)里打开、选完要回到聊天的页面:分享选择、转账、选位置。
 * 根栈把这一组注册成 fullScreenModal 盖在半屏之上——iOS 会把模态之后的普通 push 页
 * 放到模态下面,所以不能直接 push;返回时关掉这一层,下面的半屏原样还在,
 * 选择结果由半屏里的聊天页在重新拿到焦点时取走。
 * 完整聊天页里打开同样的页面仍走各自原来的栈(见 use-chat-router)。
 */
export default function ChatSheetLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        // 看不见的页面冻结渲染,和其他栈一致。
        freezeOnBlur: true,
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="share-picker" />
      <Stack.Screen name="transfer-composer" />
      {/* 选位置页:往右拖地图不能被当成全屏右滑返回。 */}
      <Stack.Screen
        name="location-picker"
        options={{ fullScreenGestureEnabled: false }}
      />
    </Stack>
  );
}
