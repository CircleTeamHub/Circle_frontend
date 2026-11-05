import { useMemo } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedSwitch } from '@/components/ui/themed-switch';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';

export interface SettingsDetailRow {
  id: string;
  labelKey: string;
  subtitleKey?: string;
  valueKey?: string;
  valueText?: string;
  type?: 'link' | 'toggle' | 'info';
  value?: boolean;
  onValueChange?: (value: boolean) => void;
  /** 危险操作（清空、退出）：红字、无箭头。 */
  destructive?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconMuted?: boolean;
  iconColor?: string;
  iconBackgroundColor?: string;
  statusKey?: string;
  statusColor?: string;
  onPress?: () => void;
  disabled?: boolean;
  /** 覆盖默认的 settingsDetailRow 测试 ID（主设置页沿用自己的 e2e 定位）。 */
  testID?: string;
}

export interface SettingsDetailSection {
  titleKey?: string;
  /** 卡片下方的说明小字。 */
  footerKey?: string;
  rows: SettingsDetailRow[];
}

interface SettingsDetailScreenProps {
  titleKey: string;
  sections: SettingsDetailSection[];
  header?: React.ReactNode;
  dimDisabledRows?: boolean;
  footer?: React.ReactNode;
  testIDPrefix?: string;
}

const ICON_BOX_SIZE = 32;
const ROW_GAP = 12;

const s = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.lg,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionText: {
    paddingHorizontal: Spacing.md,
  },
  card: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
    overflow: 'hidden',
  },
  row: {
    minHeight: 56,
    paddingVertical: ROW_GAP,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: ROW_GAP,
  },
  textBlock: {
    flex: 1,
    gap: Spacing.xs,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexShrink: 1,
    justifyContent: 'flex-end',
    maxWidth: '50%',
  },
  iconBox: {
    width: ICON_BOX_SIZE,
    height: ICON_BOX_SIZE,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 有图标的行，分隔线从文字起点开始，图标列保持连贯。
  dividerInset: {
    marginLeft: ICON_BOX_SIZE + ROW_GAP,
  },
});

function useSettingsStyles() {
  const { colors } = useTheme();
  return useMemo(
    () => ({
      colors,
      sectionTitle: {
        color: colors.textSecondary,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
      footnote: {
        color: colors.textSecondary,
        ...Typography.small,
        lineHeight: 18,
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
        fontWeight: '400' as const,
        lineHeight: 18,
      },
      value: {
        color: colors.textSecondary,
        ...Typography.caption,
        flexShrink: 1,
        textAlign: 'right' as const,
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
    [colors],
  );
}

interface SettingsRowViewProps {
  row: SettingsDetailRow;
  testID?: string;
  showDivider: boolean;
  dividerInset: boolean;
  dimDisabledRows?: boolean;
}

function SettingsRowView({ row, testID, showDivider, dividerInset, dimDisabledRows = true }: SettingsRowViewProps) {
  const { t } = useTranslation();
  const d = useSettingsStyles();
  const { colors } = d;
  const label = t(row.labelKey);
  const valueText = row.valueText ?? (row.valueKey ? t(row.valueKey) : null);
  const accessibilityLabel = [
    label,
    row.subtitleKey ? t(row.subtitleKey) : null,
    valueText,
    row.statusKey ? t(row.statusKey) : null,
  ].filter(Boolean).join(', ');
  const isToggle = row.type === 'toggle';
  const isInfo = row.type === 'info';
  const showChevron = !isToggle && !isInfo && !row.destructive;

  const handlePress = () => {
    if (isToggle) {
      row.onValueChange?.(!row.value);
      return;
    }
    if (row.onPress) {
      row.onPress();
      return;
    }
    Alert.alert(label, t('settingsPage.unsupported'));
  };

  return (
    <View>
      <Pressable
        testID={testID}
        style={({ pressed }) => [
          s.row,
          row.disabled && dimDisabledRows ? s.rowDisabled : null,
          pressed ? s.rowPressed : null,
        ]}
        disabled={isInfo || row.disabled}
        onPress={handlePress}
        accessible={!isToggle}
        tabIndex={isToggle ? -1 : undefined}
        accessibilityRole={isInfo || isToggle ? undefined : 'button'}
        accessibilityLabel={isToggle ? undefined : accessibilityLabel}
        accessibilityState={{ disabled: row.disabled }}
      >
        <View style={s.rowLeft}>
          {row.icon ? (
            <View
              style={[
                s.iconBox,
                row.iconMuted ? d.iconBoxMuted : d.iconBox,
                row.iconBackgroundColor ? { backgroundColor: row.iconBackgroundColor } : null,
              ]}
            >
              <Ionicons
                name={row.icon}
                size={18}
                color={row.iconColor ?? (row.iconMuted ? colors.textSecondary : colors.success)}
              />
            </View>
          ) : null}
          <View style={s.textBlock}>
            <Text style={[d.rowLabel, row.destructive ? d.rowLabelDestructive : null]}>
              {label}
            </Text>
            {row.subtitleKey ? <Text style={d.subtitle}>{t(row.subtitleKey)}</Text> : null}
          </View>
        </View>
        <View
          style={s.rowRight}
          {...(isToggle && Platform.OS === 'web'
            ? { onClick: (event: { stopPropagation: () => void }) => event.stopPropagation() }
            : {})}
        >
          {valueText ? (
            <Text numberOfLines={2} style={d.value}>
              {valueText}
            </Text>
          ) : null}
          {row.statusKey ? (
            <Text
              style={[
                d.value,
                row.iconMuted ? null : d.successValue,
                row.statusColor ? { color: row.statusColor } : null,
              ]}
            >
              {t(row.statusKey)}
            </Text>
          ) : null}
          {isToggle ? (
            <ThemedSwitch
              accessibilityLabel={accessibilityLabel}
              tint={colors.primary}
              value={row.value ?? false}
              onValueChange={row.onValueChange}
              disabled={row.disabled}
            />
          ) : null}
          {showChevron ? (
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          ) : null}
        </View>
      </Pressable>
      {showDivider ? (
        <View style={dividerInset ? s.dividerInset : null}>
          <Divider />
        </View>
      ) : null}
    </View>
  );
}

interface SettingsSectionViewProps {
  section: SettingsDetailSection;
  testIDPrefix?: string;
  dimDisabledRows?: boolean;
}

/** 一组设置：小标题 + 圆角卡片 + 可选的底部说明。各设置页与主设置页共用。 */
export function SettingsSectionView({ section, testIDPrefix, dimDisabledRows }: SettingsSectionViewProps) {
  const { t } = useTranslation();
  const d = useSettingsStyles();
  const { rows } = section;
  if (rows.length === 0) return null;

  return (
    <View style={s.section}>
      {section.titleKey ? (
        <Text style={[s.sectionText, d.sectionTitle]}>{t(section.titleKey)}</Text>
      ) : null}
      <View style={[s.card, d.card]}>
        {rows.map((row, index) => (
          <SettingsRowView
            key={row.id}
            row={row}
            testID={
              row.testID ??
              (testIDPrefix
                ? E2E_TEST_IDS.settingsDetailRow(`${testIDPrefix}.${row.id}`)
                : undefined)
            }
            showDivider={index < rows.length - 1}
            dividerInset={Boolean(row.icon)}
            dimDisabledRows={dimDisabledRows}
          />
        ))}
      </View>
      {section.footerKey ? (
        <Text style={[s.sectionText, d.footnote]}>{t(section.footerKey)}</Text>
      ) : null}
    </View>
  );
}

export function SettingsDetailScreen({
  titleKey,
  sections,
  header,
  dimDisabledRows = true,
  footer,
  testIDPrefix,
}: SettingsDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <View
      testID={
        testIDPrefix
          ? E2E_TEST_IDS.settingsDetailScreen(testIDPrefix)
          : undefined
      }
      style={[s.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}
    >
      <NavHeader title={t(titleKey)} />
      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {header}
        {sections.map((section, index) => (
          <SettingsSectionView
            key={`${section.titleKey ?? 'section'}-${index}`}
            section={section}
            testIDPrefix={testIDPrefix}
            dimDisabledRows={dimDisabledRows}
          />
        ))}
        {footer}
      </ScrollView>
    </View>
  );
}
