import { Redirect } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { useTheme } from '@/theme';

export default function Index() {
  // selector 化：避免订阅整个 authStore —— 这个组件只关心路由所需的认证字段，
  // token 后台刷新 / setUser 等不该触发它重渲染（每次都跑 Redirect 的副作用）。
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasCachedSession = useAuthStore(
    (state) =>
      state.isAuthenticated &&
      typeof state.accessToken === 'string' &&
      state.accessToken.length > 0 &&
      typeof state.refreshToken === 'string' &&
      state.refreshToken.length > 0 &&
      Boolean(state.user?.id),
  );
  const onboardingRequired = useAuthStore((state) => state.onboardingRequired);
  const isLoading = useAuthStore((state) => state.isLoading);
  const { colors } = useTheme();

  if (isLoading && !hasCachedSession) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isAuthenticated && onboardingRequired) {
    return <Redirect href="/(onboarding)/profile" />;
  }

  if (isAuthenticated) {
    return <Redirect href="/(tabs)/messages" />;
  }

  return <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
