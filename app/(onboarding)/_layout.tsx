import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        // 看不见的页面冻结渲染(切走的 tab、栈里更深的页面),不再跟着每条消息重算。
        freezeOnBlur: true,
        headerShown: false,
        gestureEnabled: false,
      }}
    />
  );
}
