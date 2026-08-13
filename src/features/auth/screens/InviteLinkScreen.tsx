import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { useTheme } from '@/theme';

export default function InviteLinkScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { colors } = useTheme();
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!hasHydrated) {
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

  const inviteCode = typeof code === 'string' ? code.trim().toLowerCase() : '';
  return (
    <Redirect
      href={{
        pathname: '/(auth)/register',
        params: inviteCode ? { inviteCode } : {},
      }}
    />
  );
}
