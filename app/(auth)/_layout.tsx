import { Stack } from 'expo-router';
import { useTheme } from '@/theme';

export default function AuthLayout() {
  const { colors } = useTheme();

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
      }}
    />
  );
}
