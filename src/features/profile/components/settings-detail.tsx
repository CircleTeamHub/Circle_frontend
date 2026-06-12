import { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export interface SettingsDetailRow {
  id: string;
  labelKey: string;
  subtitleKey?: string;
  valueKey?: string;
  valueText?: string;
  type?: 'link' | 'toggle' | 'info';
  initialValue?: boolean;
  /** When provided, the toggle is controlled (persisted) instead of local-only. */
  value?: boolean;
  onValueChange?: (value: boolean) => void;
  destructive?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconMuted?: boolean;
  statusKey?: string;
  onPress?: () => void;
  disabled?: boolean;
}

export interface SettingsDetailSection {
  titleKey?: string;
  rows: SettingsDetailRow[];
}

interface SettingsDetailScreenProps {
  titleKey: string;
  sections: SettingsDetailSection[];
  footer?: React.ReactNode;
}

const s = StyleSheet.create({
  section: {
    gap: Spacing.sm,
  },
  card: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    overflow: 'hidden',
  },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  rowDisabled: {
    opacity: 0.55,
  },
  rowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  textBlock: {
    flex: 1,
    gap: 3,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

function SettingsSwitch({
  initialValue,
  value,
  onValueChange,
  disabled,
}: {
  initialValue?: boolean;
  value?: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const [localValue, setLocalValue] = useState(initialValue ?? false);
  const isControlled = onValueChange !== undefined;

  return (
    <Switch
      value={isControlled ? value ?? false : localValue}
      onValueChange={isControlled ? onValueChange : setLocalValue}
      disabled={disabled}
      trackColor={{ false: colors.surfaceBorder, true: colors.blue }}
      thumbColor={colors.white}
    />
  );
}

export function SettingsDetailScreen({
  titleKey,
  sections,
  footer,
}: SettingsDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      content: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xl,
        gap: Spacing.xl,
      },
      sectionTitle: {
        color: colors.textSecondary,
        ...Typography.caption,
        fontWeight: '700' as const,
      },
      card: {
        backgroundColor: colors.surface,
        boxShadow: '0 10px 26px rgba(59, 130, 246, 0.08)',
      },
      rowLabel: {
        color: colors.text,
        ...Typography.body,
      },
      rowLabelDestructive: {
        color: colors.error,
      },
      subtitle: {
        color: colors.textSecondary,
        ...Typography.caption,
        lineHeight: 19,
      },
      value: {
        color: colors.text,
        ...Typography.caption,
      },
      mutedValue: {
        color: colors.textSecondary,
      },
      successValue: {
        color: colors.success,
      },
      iconBox: {
        backgroundColor: colors.primaryLight,
      },
      iconBoxMuted: {
        backgroundColor: colors.surfaceBorder,
      },
    }),
    [colors, insets.bottom],
  );

  const handleLinkPress = (row: SettingsDetailRow) => {
    if (row.onPress) {
      row.onPress();
      return;
    }

    Alert.alert(t(row.labelKey), t('settingsPage.unsupported'));
  };

  const renderRow = (row: SettingsDetailRow, index: number, total: number) => {
    const valueText = row.valueText ?? (row.valueKey ? t(row.valueKey) : null);

    return (
      <View key={row.id}>
        <Pressable
          style={[s.row, row.disabled ? s.rowDisabled : null]}
          disabled={row.type === 'info' || row.disabled}
          onPress={() =>
            row.type === 'toggle' || row.type === 'info' || row.disabled
              ? undefined
              : handleLinkPress(row)
          }
        >
          <View style={s.rowLeft}>
            {row.icon ? (
              <View style={[s.iconBox, row.iconMuted ? d.iconBoxMuted : d.iconBox]}>
                <Ionicons
                  name={row.icon}
                  size={24}
                  color={row.iconMuted ? colors.textSecondary : colors.success}
                />
              </View>
            ) : null}
            <View style={s.textBlock}>
              <Text style={[d.rowLabel, row.destructive ? d.rowLabelDestructive : null]}>
                {t(row.labelKey)}
              </Text>
              {row.subtitleKey ? (
                <Text style={d.subtitle}>{t(row.subtitleKey)}</Text>
              ) : null}
            </View>
          </View>
          <View style={s.rowRight}>
            {valueText ? <Text style={d.value}>{valueText}</Text> : null}
            {row.statusKey ? (
              <Text
                style={[
                  d.value,
                  row.iconMuted ? d.mutedValue : d.successValue,
                ]}
              >
                {t(row.statusKey)}
              </Text>
            ) : null}
            {row.type === 'toggle' ? (
              <SettingsSwitch
                initialValue={row.initialValue}
                value={row.value}
                onValueChange={row.onValueChange}
                disabled={row.disabled}
              />
            ) : row.type === 'info' ? null : (
              <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
            )}
          </View>
        </Pressable>
        {index < total - 1 ? <Divider /> : null}
      </View>
    );
  };

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t(titleKey)} />
      <ScrollView
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
      >
        {sections.map((section, index) => (
          <View key={`${section.titleKey ?? 'section'}-${index}`} style={s.section}>
            {section.titleKey ? (
              <Text style={d.sectionTitle}>{t(section.titleKey)}</Text>
            ) : null}
            <View style={[s.card, d.card]}>
              {section.rows.map((row, rowIndex) =>
                renderRow(row, rowIndex, section.rows.length),
              )}
            </View>
          </View>
        ))}
        {footer}
      </ScrollView>
    </View>
  );
}
