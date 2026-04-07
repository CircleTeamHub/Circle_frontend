// 导入 React Navigation 的主题系统，用于给导航栏（header、tab bar 等）应用深色/浅色主题
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavThemeProvider,
} from '@react-navigation/native';
import { useFonts } from 'expo-font';        // 加载自定义字体
import { Stack } from 'expo-router';          // Expo Router 的 Stack 导航（页面栈）
import * as SplashScreen from 'expo-splash-screen'; // 控制启动屏（闪屏）的显示与隐藏
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar'; // 控制顶部状态栏样式（文字颜色等）
import 'react-native-reanimated';             // 必须在入口文件最早引入，启用动画引擎

// 项目自定义主题系统：ThemeProvider 提供主题上下文，useTheme 读取当前主题
import { SessionBootstrap } from '@/components/app/session-bootstrap';
import { ThemeProvider, useTheme } from '@/theme';

// 将 expo-router 内置的 ErrorBoundary 重新导出，使其在根路由层生效（捕获页面级报错）
export { ErrorBoundary } from 'expo-router';

// 阻止启动屏自动隐藏，等待字体加载完成后再手动隐藏
SplashScreen.preventAutoHideAsync();

// RootStack：负责将项目主题与 React Navigation 主题桥接，并声明顶层路由结构
function RootStack() {
  const { colors, resolvedMode } = useTheme(); // 读取当前主题颜色和深/浅色模式

  // 将项目设计 token（colors）注入 React Navigation 的主题对象，
  // 使导航组件（header、背景等）与 App 主题保持一致
  const navTheme = {
    ...(resolvedMode === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(resolvedMode === 'dark' ? DarkTheme : DefaultTheme).colors,
      background: colors.background,
      card: colors.background,   // card 即 header/tab bar 背景色
      border: colors.divider,
      primary: colors.primary,
      text: colors.text,
    },
  };

  return (
    <NavThemeProvider value={navTheme}>
      {/* 根据主题动态切换状态栏文字颜色（light = 白字 / dark = 黑字） */}
      <StatusBar style={colors.statusBarStyle === 'light' ? 'light' : 'dark'} />

      {/* Stack 导航：所有页面以"从右滑入"的动画叠加展示，全局隐藏 header */}
      <Stack
        screenOptions={{
          headerShown: false,                          // 所有页面不显示系统 header
          animation: 'slide_from_right',               // 页面切换动画：从右侧滑入
          contentStyle: { backgroundColor: colors.background },
          fullScreenGestureEnabled: false,             // 关闭全屏手势返回
          fullScreenGestureShadowEnabled: false,
          gestureEnabled: false,                       // 关闭滑动返回手势
        }}
      >
        {/* 四个顶层路由组，对应 app/(tabs)、(auth)、(chat)、(social) 目录 */}
        <Stack.Screen name="(tabs)" />    {/* 主 Tab 界面（消息、发现、联系人、我的） */}
        <Stack.Screen name="(auth)" />    {/* 登录 / 注册 */}
        <Stack.Screen name="(chat)" />    {/* 聊天详情等聊天相关页面 */}
        <Stack.Screen name="(social)" />  {/* 社交相关页面（发帖、用户主页等） */}
      </Stack>
    </NavThemeProvider>
  );
}

// RootLayout：应用真正的根组件
// 职责：加载字体 → 隐藏启动屏 → 挂载主题 Provider → 渲染路由结构
export default function RootLayout() {
  // 加载自定义字体，loaded 为 true 时字体就绪，error 表示加载失败
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // 字体加载出错时直接抛出，触发 ErrorBoundary 展示错误页
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  // 字体加载完成后隐藏启动屏，正式展示 App 内容
  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  // 字体未就绪前不渲染任何内容（启动屏仍显示）
  if (!loaded) return null;

  return (
    // ThemeProvider：提供全局主题上下文（颜色、深浅色模式等）
    <ThemeProvider>
      <SessionBootstrap />
      <RootStack />
    </ThemeProvider>
  );
}
