import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { CoinTransaction } from '@/services/api/coin';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';
import type { ThemeColors } from '@/theme/types';
import { getLocalizedDateTimeLocale } from '@/utils/locale';

type IoniconName = keyof typeof Ionicons.glyphMap;

const s = StyleSheet.create({
  section: {
    gap: Spacing.sm,
  },
  monthLabel: {
    ...Typography.caption,
    paddingHorizontal: Spacing.xs,
  },
  group: {
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  typeIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    flex: 1,
    gap: 2,
  },
  amount: {
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  state: {
    borderRadius: Radius.lg,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  retry: {
    marginTop: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
  },
});

// 每种流水一个图标 + 语义色：收入偏暖/绿，支出走中性色，扫一眼就分得清。
function typeVisual(type: string, colors: ThemeColors): { icon: IoniconName; tint: string } {
  switch (type) {
    case 'REFERRAL_REWARD':
      return { icon: 'gift', tint: colors.orange };
    case 'REFERRAL_BONUS':
      return { icon: 'sparkles', tint: colors.brandPurple };
    case 'GIFT_SENT':
      return { icon: 'paper-plane', tint: colors.textSecondary };
    case 'GIFT_RECEIVED':
      return { icon: 'heart', tint: colors.error };
    case 'PURCHASE':
      return { icon: 'bag-handle', tint: colors.primary };
    case 'RECHARGE':
      return { icon: 'wallet', tint: colors.success };
    case 'REFUND':
      return { icon: 'return-down-back', tint: colors.warning };
    default:
      return { icon: 'swap-horizontal', tint: colors.textSecondary };
  }
}

function monthKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}`;
}

interface WalletHistoryProps {
  transactions: CoinTransaction[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  labelFor: (transaction: CoinTransaction) => string;
}

/** 积分明细：按月分组的卡片，每条带类型图标、时间和带符号的金额。 */
export function WalletHistory({ transactions, loading, error, onRetry, labelFor }: WalletHistoryProps) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  // 不传 locale 会跟着**设备**语言走:应用内切过语言的人,钱包会一半中文一半设备语言。
  const locale = getLocalizedDateTimeLocale(i18n.language);

  const groups = useMemo(() => {
    const byMonth: { key: string; label: string; rows: CoinTransaction[] }[] = [];
    for (const transaction of transactions) {
      const key = monthKey(transaction.createdAt);
      const last = byMonth[byMonth.length - 1];
      if (last?.key === key) {
        last.rows.push(transaction);
      } else {
        byMonth.push({
          key,
          label: new Date(transaction.createdAt).toLocaleDateString(locale, {
            year: 'numeric',
            month: 'long',
          }),
          rows: [transaction],
        });
      }
    }
    return byMonth;
  }, [locale, transactions]);

  if (error) {
    return (
      <View style={[s.state, { backgroundColor: colors.surface }]}>
        <Ionicons name="cloud-offline-outline" size={28} color={colors.textSecondary} />
        <Text selectable style={[Typography.caption, { color: colors.error }]}>
          {error}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={[s.retry, { borderColor: colors.surfaceBorder }]}
        >
          <Text style={[Typography.caption, { color: colors.text }]}>
            {t('common.retry', { defaultValue: '重试' })}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (loading && transactions.length === 0) {
    return (
      <View style={[s.state, { backgroundColor: colors.surface }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (transactions.length === 0) {
    return (
      <View style={[s.state, { backgroundColor: colors.surface }]}>
        <Ionicons name="receipt-outline" size={28} color={colors.textSecondary} />
        <Text style={[Typography.bodyRegular, { color: colors.textSecondary }]}>
          {t('profile.wallet.historyEmpty', { defaultValue: '暂无积分明细' })}
        </Text>
      </View>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <View key={group.key} style={s.section}>
          <Text style={[s.monthLabel, { color: colors.textSecondary }]}>{group.label}</Text>
          <View style={[s.group, { backgroundColor: colors.surface }]}>
            {group.rows.map((transaction, index) => {
              const visual = typeVisual(transaction.type, colors);
              const income = transaction.amount >= 0;
              return (
                <View
                  key={transaction.id}
                  style={[
                    s.row,
                    index < group.rows.length - 1 && [s.rowDivider, { borderBottomColor: colors.divider }],
                  ]}
                >
                  <View style={[s.typeIcon, { backgroundColor: withAlpha(visual.tint, 0.14) }]}>
                    <Ionicons name={visual.icon} size={20} color={visual.tint} />
                  </View>
                  <View style={s.main}>
                    <Text style={[Typography.body, { color: colors.text }]} numberOfLines={1}>
                      {labelFor(transaction)}
                    </Text>
                    <Text style={[Typography.small, { color: colors.textSecondary }]}>
                      {new Date(transaction.createdAt).toLocaleString(locale, {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <Text selectable style={[s.amount, { color: income ? colors.success : colors.text }]}>
                    {income ? '+' : ''}
                    {transaction.amount}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </>
  );
}
