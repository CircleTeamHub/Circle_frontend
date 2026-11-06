import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FilterTabs } from '@/components/ui/filter-tabs';
import {
  ABNORMAL_INACTIVE_DAY_OPTIONS,
  type AbnormalInactiveDays,
} from '@/chat-core/protocol';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export const ABNORMAL_REASON_FILTERS = ['ALL', 'INACTIVE', 'LOW_CREDIT'] as const;
export type AbnormalReasonFilter = (typeof ABNORMAL_REASON_FILTERS)[number];

interface Props {
  filter: AbnormalReasonFilter;
  counts: Record<AbnormalReasonFilter, number>;
  onFilterChange: (filter: AbnormalReasonFilter) => void;
  inactiveDays: AbnormalInactiveDays;
  onInactiveDaysChange: (days: AbnormalInactiveDays) => void;
  creditThreshold: number | null;
}

const s = StyleSheet.create({
  wrap: { gap: Spacing.md, paddingHorizontal: Spacing.md, paddingTop: Spacing.md },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dayLabel: { ...Typography.caption, flex: 1 },
  segment: { flexDirection: 'row', borderRadius: Radius.md, padding: Spacing.xs / 2 },
  segmentItem: {
    paddingHorizontal: Spacing.md,
    height: 28,
    justifyContent: 'center',
    borderRadius: Radius.sm,
  },
  segmentText: { ...Typography.caption },
  rules: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
  },
  rulesText: { ...Typography.small, flex: 1, lineHeight: 18 },
});

/** 异常成员页顶部:原因筛选、未登录天数档、判定规则说明。 */
export const AbnormalMembersHeader: React.FC<Props> = ({
  filter,
  counts,
  onFilterChange,
  inactiveDays,
  onInactiveDaysChange,
  creditThreshold,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      dayLabel: { color: colors.text },
      segment: { backgroundColor: colors.surfaceMuted },
      segmentActive: { backgroundColor: colors.surface },
      segmentText: { color: colors.textSecondary },
      segmentTextActive: { color: colors.text },
      rules: { backgroundColor: colors.surface },
      rulesText: { color: colors.textSecondary },
    }),
    [colors],
  );

  const tabs = [
    t('chat.groupManagement.abnormal.filterAll', { n: counts.ALL }),
    t('chat.groupManagement.abnormal.filterInactive', { n: counts.INACTIVE }),
    t('chat.groupManagement.abnormal.filterLowCredit', { n: counts.LOW_CREDIT }),
  ];

  return (
    <View style={s.wrap}>
      <View style={[s.rules, d.rules]}>
        <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
        <Text style={[s.rulesText, d.rulesText]}>
          {t('chat.groupManagement.abnormal.rules', {
            days: inactiveDays,
            threshold: creditThreshold ?? 60,
          })}
        </Text>
      </View>
      <View style={s.dayRow}>
        <Text style={[s.dayLabel, d.dayLabel]}>
          {t('chat.groupManagement.abnormal.inactiveFor')}
        </Text>
        <View style={[s.segment, d.segment]} accessibilityRole="radiogroup">
          {ABNORMAL_INACTIVE_DAY_OPTIONS.map((days) => {
            const active = days === inactiveDays;
            return (
              <Pressable
                key={days}
                style={[s.segmentItem, active ? d.segmentActive : null]}
                onPress={() => onInactiveDaysChange(days)}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                testID={`abnormal-days-${days}`}
              >
                <Text style={[s.segmentText, active ? d.segmentTextActive : d.segmentText]}>
                  {t('chat.groupManagement.abnormal.days', { n: days })}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <FilterTabs
        tabs={tabs}
        activeIndex={ABNORMAL_REASON_FILTERS.indexOf(filter)}
        onTabPress={(index) => onFilterChange(ABNORMAL_REASON_FILTERS[index] ?? 'ALL')}
        testIDForIndex={(index) => `abnormal-filter-${ABNORMAL_REASON_FILTERS[index]}`}
      />
    </View>
  );
};
