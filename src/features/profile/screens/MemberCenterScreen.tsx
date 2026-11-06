import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  container: { flex: 1 },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  text: { ...Typography.h3, textAlign: 'center' },
});

/** 会员中心:会员功能暂未开放,页面只保留这一句提示。 */
export default function MemberCenterScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background, paddingTop: insets.top },
      text: { color: colors.textSecondary },
    }),
    [colors, insets.top],
  );

  return (
    <View style={[s.container, d.container]}>
      <NavHeader title={t('profile.membership.title', { defaultValue: '会员中心' })} />
      <View style={s.body}>
        <Text style={[s.text, d.text]}>
          {t('profile.membership.marketing.title', { defaultValue: '会员功能暂未开放' })}
        </Text>
      </View>
    </View>
  );
}
