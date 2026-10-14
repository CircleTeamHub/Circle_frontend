import { Stack } from 'expo-router';
import { useAddingAccountScope } from '@/features/auth/hooks/use-adding-account-scope';
import { useTheme } from '@/theme';

export default function AuthLayout() {
  const { colors } = useTheme();
  // 「切换账号 → 添加账号」压在已登录会话上的这一趟:离开 (auth) 时收回放行标记。
  useAddingAccountScope();

  return (
    <Stack
      screenOptions={{
        // 这个项目用的是自定义 NavHeader 组件，不用系统自带的导航栏。
        // Expo Router 的 Stack 默认会渲染一个系统原生的顶部 header（有返回按钮、标题等）。
        // 设置 headerShown: false 把它隐藏掉，然后在每个 Screen 里自己用 NavHeader 
        // 组件控制样式，这样：
        // 可以完全自定义 UI（颜色、字体、按钮位置）
        // 跟 app 的设计风格保持一致

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
