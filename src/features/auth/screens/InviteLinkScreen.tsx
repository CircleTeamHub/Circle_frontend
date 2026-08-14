import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { useTheme } from '@/theme';

export default function InviteLinkScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { colors } = useTheme();
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  // hasHydrated 只说明持久化状态读回来了,不代表那份会话还有效:冷启动会先
  // 恢复出 isAuthenticated=true,SessionBootstrap 随后才拿 /auth/me 去验。
  // 只等 hasHydrated 的话,一份过期会话会把人先送进邀请中心,紧接着 401 登出,
  // 邀请码就再也找不回来了。isLoading 在 bootstrap 结束(成功或失败)后才置 false。
  const isLoading = useAuthStore((state) => state.isLoading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!hasHydrated || isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (isAuthenticated) {
    return <Redirect href="/(tabs)/profile/share" />;
  }

  const inviteCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
  return (
    <Redirect
      href={{
        pathname: '/(auth)/register',
        params: inviteCode ? { inviteCode } : {},
      }}
    />
  );
}
