import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { NavHeader } from '@/components/ui/nav-header';
import { Spacing, useTheme } from '@/theme';
import { MyCirclesPanel } from '@/features/discover/components/my-circles-panel';

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
});

// Standalone "my circles" management page. Reuses the same MyCirclesPanel the
// Discover tab renders (joined / created / managed / applied tabs + create), so
// the contacts "圈子" entry lands on a real management surface.
export default function MyCirclesScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <View
      style={[
        s.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <NavHeader title={t('contacts.circles', { defaultValue: '圈子' })} />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        <MyCirclesPanel />
      </ScrollView>
    </View>
  );
}
