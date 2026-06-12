import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface AboutArticleScreenProps {
  titleKey: string;
  sections: {
    titleKey: string;
    bodyKey?: string;
    bulletKeys?: readonly string[];
    valueText?: string;
  }[];
}

const s = StyleSheet.create({
  content: {
    gap: Spacing.md,
  },
  section: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.full,
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
  },
});

export function AboutArticleScreen({ titleKey, sections }: AboutArticleScreenProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const d = {
    panel: {
      backgroundColor: colors.surface,
      borderColor: colors.surfaceBorder,
      borderWidth: StyleSheet.hairlineWidth,
    },
    sectionTitle: {
      color: colors.text,
      ...Typography.h3,
    },
    body: {
      color: colors.textSecondary,
      ...Typography.bodyRegular,
      lineHeight: 22,
    },
    value: {
      color: colors.primary,
      ...Typography.h1,
    },
    bulletDot: {
      backgroundColor: colors.primary,
    },
  };

  return (
    <SettingsDetailScreen
      titleKey={titleKey}
      sections={[]}
      footer={
        <View style={s.content}>
          {sections.map((section) => (
            <View key={section.titleKey} style={[s.section, d.panel]}>
              <Text style={d.sectionTitle}>{t(section.titleKey)}</Text>
              {section.valueText ? (
                <Text style={d.value}>{section.valueText}</Text>
              ) : null}
              {section.bodyKey ? (
                <Text style={d.body}>{t(section.bodyKey)}</Text>
              ) : null}
              {section.bulletKeys?.map((key) => (
                <View key={key} style={s.bulletRow}>
                  <View style={[s.bulletDot, d.bulletDot]} />
                  <Text style={[s.bulletText, d.body]}>{t(key)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      }
    />
  );
}
