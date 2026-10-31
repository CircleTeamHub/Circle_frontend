import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { WalletBalanceCard } from '@/features/profile/components/wallet-balance-card';
import { WalletHistory } from '@/features/profile/components/wallet-history';
import { useNetworkStatus } from '@/hooks/use-network-status';
import {
  fetchCoinTransactions,
  fetchWallet,
  type CoinTransaction,
} from '@/services/api/coin';
import { useAuthStore } from '@/stores/authStore';
import { useWalletRealtimeStore } from '@/stores/walletRealtimeStore';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  // 卡片下方两枚快捷入口：邀请有礼（目前唯一的赚积分途径）+ 积分充值（未开放，置灰）。
  actions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  actionDisabled: {
    opacity: 0.55,
  },
  actionPressed: {
    opacity: 0.72,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    flex: 1,
    gap: 2,
  },
  history: {
    gap: Spacing.md,
  },
});

export default function WalletScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isOffline } = useNetworkStatus();
  const [balance, setBalance] = useState(0);
  const [loadingWallet, setLoadingWallet] = useState(true);
  // 余额与流水分开各自的加载态:两者绑在同一个 allSettled 上时,慢一拍的流水
  // 请求会把已经拿到的余额一直压在「...」上,最坏要等满 15s 的接口超时 ——
  // 而余额是这个页面的主信息。
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const realtimeBalance = useWalletRealtimeStore((state) => state.balance);
  // 信用卡下沿:左侧直接展示账号 ID(与个人页「ID: xxxxxx」同一口径),
  // 右侧持卡人昵称。
  const authUser = useAuthStore((state) => state.user);
  const cardNumber = authUser?.accountId ?? '';
  const cardHolder = authUser?.nickname ?? '';
  const walletVersion = useWalletRealtimeStore((state) => state.version);
  // 首屏之后由 walletVersion 触发的那几次只是对账:实时通道已经把权威余额写
  // 进来了,再翻回「...」等一次 GET(最坏 15s 超时)是把已经正确的数字藏起来。
  const balanceSettledRef = useRef(false);
  // 流水加载失败后点「重试」：只重拉流水，不动已经显示的余额。
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const retryHistory = useCallback(() => setHistoryReloadKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function loadBalance() {
      if (!balanceSettledRef.current) setLoadingWallet(true);
      setWalletError(null);
      try {
        const wallet = await fetchWallet();
        if (cancelled) return;
        setBalance(wallet.balance);
      } catch (error) {
        if (cancelled) return;
        setWalletError(
          t('profile.wallet.loadError', {
            defaultValue: '积分余额加载失败，请稍后重试',
          }),
        );
        reportHandledFailure('wallet', 'fetch', error);
      } finally {
        if (!cancelled) {
          balanceSettledRef.current = true;
          setLoadingWallet(false);
        }
      }
    }

    void loadBalance();
    return () => {
      cancelled = true;
    };
  }, [t, walletVersion]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setLoadingHistory(true);
      setHistoryError(null);
      try {
        const rows = await fetchCoinTransactions();
        if (cancelled) return;
        setTransactions(rows);
      } catch (error) {
        if (cancelled) return;
        setHistoryError(
          t('profile.wallet.historyLoadError', {
            defaultValue: '积分流水加载失败',
          }),
        );
        reportHandledFailure('wallet', 'fetchTransactions', error);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [t, walletVersion, historyReloadKey]);

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
      <NavHeader title={t('profile.wallet.title', { defaultValue: '我的钱包' })} />
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
        <WalletBalanceCard
          balance={balance}
          loading={loadingWallet}
          accountId={cardNumber}
          holder={cardHolder}
        />
        {walletError ? (
          <Text
            testID="wallet-balance-error"
            selectable
            style={[Typography.caption, { color: colors.error }]}
          >
            {walletError}
          </Text>
        ) : null}

        <View style={s.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(tabs)/profile/share')}
            style={({ pressed }) => [
              s.action,
              { backgroundColor: colors.surface },
              pressed && s.actionPressed,
            ]}
          >
            <View style={[s.actionIcon, { backgroundColor: withAlpha(colors.orange, 0.14) }]}>
              <Ionicons name="gift" size={18} color={colors.orange} />
            </View>
            <View style={s.actionText}>
              <Text style={[Typography.body, { color: colors.text }]} numberOfLines={1}>
                {t('referral.title', { defaultValue: '邀请有礼' })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </Pressable>
          {/* 充值未开放：入口留着让人知道有这件事，但置灰、不可点。 */}
          <View
            accessible
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            style={[s.action, s.actionDisabled, { backgroundColor: colors.surface }]}
          >
            <View style={[s.actionIcon, { backgroundColor: withAlpha(colors.primary, 0.14) }]}>
              <Ionicons name="add" size={20} color={colors.primary} />
            </View>
            <View style={s.actionText}>
              <Text style={[Typography.body, { color: colors.text }]} numberOfLines={1}>
                {t('profile.wallet.recharge', { defaultValue: '积分充值' })}
              </Text>
              <Text style={[Typography.small, { color: colors.textSecondary }]} numberOfLines={2}>
                {t('profile.wallet.purchaseUnavailable', {
                  defaultValue: '积分购买暂未开放。',
                })}
              </Text>
            </View>
          </View>
        </View>

        <View style={s.history}>
          <Text style={[Typography.h3, { color: colors.text }]}>
            {t('profile.wallet.historyTitle', { defaultValue: '积分明细' })}
          </Text>
          <WalletHistory
            transactions={transactions}
            loading={loadingHistory}
            error={historyError}
            onRetry={retryHistory}
            labelFor={transactionLabel}
          />
        </View>
      </ScrollView>
    </View>
  );
}
