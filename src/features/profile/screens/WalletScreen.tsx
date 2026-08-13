import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { useNetworkStatus } from '@/hooks/use-network-status';
import {
  fetchCoinTransactions,
  fetchWallet,
  type CoinTransaction,
} from '@/services/api/coin';
import { useWalletRealtimeStore } from '@/stores/walletRealtimeStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  balanceCard: {
    borderRadius: Radius.xl,
    minHeight: 150,
    padding: Spacing.xl,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  balanceOrb: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 999,
    right: -40,
    bottom: -70,
    opacity: 0.18,
  },
  notice: {
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  historyCard: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  historyRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  historyMain: {
    flex: 1,
    gap: Spacing.xs,
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});

export default function WalletScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isOffline } = useNetworkStatus();
  const [balance, setBalance] = useState(0);
  const [loadingWallet, setLoadingWallet] = useState(true);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const realtimeBalance = useWalletRealtimeStore((state) => state.balance);
  const walletVersion = useWalletRealtimeStore((state) => state.version);

  useEffect(() => {
    let cancelled = false;

    async function loadWallet() {
      setLoadingWallet(true);
      setWalletError(null);
      setHistoryError(null);
      const [walletResult, transactionsResult] = await Promise.allSettled([
        fetchWallet(),
        fetchCoinTransactions(),
      ]);
      if (cancelled) return;
      if (walletResult.status === 'fulfilled') {
        setBalance(walletResult.value.balance);
      } else {
        setWalletError(
          t('profile.wallet.loadError', {
            defaultValue: '积分余额加载失败，请稍后重试',
          }),
        );
        if (__DEV__)
          console.warn('[WalletScreen] fetchWallet failed', walletResult.reason);
      }
      if (transactionsResult.status === 'fulfilled') {
        setTransactions(transactionsResult.value);
      } else {
        setHistoryError(
          t('profile.wallet.historyLoadError', {
            defaultValue: '积分流水加载失败',
          }),
        );
        if (__DEV__)
          console.warn(
            '[WalletScreen] fetchCoinTransactions failed',
            transactionsResult.reason,
          );
      }
      setLoadingWallet(false);
    }

    loadWallet();
    return () => {
      cancelled = true;
    };
  }, [t, walletVersion]);

  useEffect(() => {
    if (typeof realtimeBalance === 'number') setBalance(realtimeBalance);
  }, [realtimeBalance, walletVersion]);

  const transactionLabel = (transaction: CoinTransaction) => {
    switch (transaction.type) {
      case 'REFERRAL_REWARD':
        return t('profile.wallet.types.referralReward', {
          defaultValue: '邀请好友奖励',
        });
      case 'REFERRAL_BONUS':
        return t('profile.wallet.types.referralBonus', {
          defaultValue: '受邀注册奖励',
        });
      case 'GIFT_SENT':
        return t('profile.wallet.types.giftSent', { defaultValue: '赠送积分' });
      case 'GIFT_RECEIVED':
        return t('profile.wallet.types.giftReceived', {
          defaultValue: '收到积分',
        });
      case 'PURCHASE':
        return t('profile.wallet.types.purchase', { defaultValue: '积分消费' });
      case 'RECHARGE':
        return t('profile.wallet.types.recharge', { defaultValue: '积分到账' });
      case 'REFUND':
        return t('profile.wallet.types.refund', { defaultValue: '积分退回' });
      default:
        return transaction.note ||
          t('profile.wallet.types.adjustment', { defaultValue: '积分调整' });
    }
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
      }}
    >
      <NavHeader
        title={t('profile.wallet.title', { defaultValue: '我的钱包' })}
        rightIcon="card-outline"
      />
      <ScrollView
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
      >
        {isOffline ? (
          <Text style={[Typography.caption, { color: colors.error }]}>
            {t('common.offline', {
              defaultValue: '当前无网络连接，部分功能可能不可用',
            })}
          </Text>
        ) : null}
        <View style={[s.balanceCard, { backgroundColor: colors.blue }]}>
          <View style={[s.balanceOrb, { backgroundColor: colors.white }]} />
          <Text style={[Typography.h3, { color: 'rgba(0,0,0,0.62)' }]}>
            {t('profile.wallet.balance', { defaultValue: '积分余额' })}
          </Text>
          <Text
            style={{
              color: 'rgba(0,0,0,0.72)',
              fontSize: 54,
              fontWeight: '700',
              marginTop: Spacing.lg,
              fontVariant: ['tabular-nums'],
            }}
          >
            {loadingWallet ? '...' : balance}
          </Text>
          {walletError ? (
            <Text style={[Typography.caption, { color: colors.error }]}>
              {walletError}
            </Text>
          ) : null}
        </View>

        <View style={[s.notice, { backgroundColor: colors.surface }]}>
          <Text style={[Typography.bodyRegular, { color: colors.textSecondary }]}>
            {t('profile.wallet.purchaseUnavailable', {
              defaultValue: '积分购买暂未开放。当前页面仅显示余额。',
            })}
          </Text>
        </View>

        <View style={[s.historyCard, { backgroundColor: colors.surface }]}>
          <Text style={[Typography.h3, { color: colors.text }]}>
            {t('profile.wallet.historyTitle', { defaultValue: '积分明细' })}
          </Text>
          {historyError ? (
            <Text selectable style={[Typography.caption, { color: colors.error }]}>
              {historyError}
            </Text>
          ) : transactions.length === 0 && !loadingWallet ? (
            <Text style={[Typography.bodyRegular, { color: colors.textSecondary }]}>
              {t('profile.wallet.historyEmpty', { defaultValue: '暂无积分明细' })}
            </Text>
          ) : (
            transactions.map((transaction) => (
              <View key={transaction.id} style={s.historyRow}>
                <View style={s.historyMain}>
                  <Text style={[Typography.body, { color: colors.text }]}>
                    {transactionLabel(transaction)}
                  </Text>
                  <Text style={[Typography.small, { color: colors.textSecondary }]}>
                    {new Date(transaction.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <Text
                  selectable
                  style={[
                    s.amount,
                    {
                      color:
                        transaction.amount >= 0 ? colors.success : colors.text,
                    },
                  ]}
                >
                  {transaction.amount >= 0 ? '+' : ''}
                  {transaction.amount}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
