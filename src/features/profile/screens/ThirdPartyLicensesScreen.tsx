import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import notices from '../../../../assets/legal/third-party-notices.json';
import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  notice: {
    ...Typography.caption,
    lineHeight: 18,
  },
  description: {
    ...Typography.bodyRegular,
    lineHeight: 22,
  },
});

export default function ThirdPartyLicensesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <SettingsDetailScreen
      titleKey="settingsDetails.about.thirdPartyLicenses"
      sections={[]}
      footer={
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.surfaceBorder,
              borderWidth: StyleSheet.hairlineWidth,
            },
          ]}
        >
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {t('settingsDetails.about.thirdPartyLicensesDescription')}
          </Text>
          <Text selectable style={[styles.notice, { color: colors.text }]}>
            {notices.text}
          </Text>
        </View>
      }
    />
  );
}
