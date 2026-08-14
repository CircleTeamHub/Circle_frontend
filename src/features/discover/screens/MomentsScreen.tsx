import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { MomentsFeed } from '@/features/discover/components/moments-feed';
import { Radius, Spacing, useTheme } from '@/theme';

const s = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: 110,
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default function MomentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: colors.background,
      },
      fab: {
        backgroundColor: colors.primary,
      },
    }),
    [colors, insets.top],
  );

  const handleCreateMoment = useCallback(() => {
    router.push('/(tabs)/discover/create-moment');
  }, [router]);

  return (
    <View style={d.container}>
      <NavHeader
        title={t('discover.moments')}
        fallbackHref="/(tabs)/discover"
      />
      <View style={s.content}>
        <MomentsFeed />
      </View>
      <Pressable
        style={[s.fab, d.fab]}
        onPress={handleCreateMoment}
        accessibilityRole="button"
        accessibilityLabel={t('moment.createTitle')}
      >
        <Ionicons name="add" size={24} color={colors.white} />
      </Pressable>
    </View>
  );
}
