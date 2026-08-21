import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getLocalizedDateTimeLocale } from '@/utils/locale';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientCover } from '@/components/ui/gradient-cover';
import { NavHeader } from '@/components/ui/nav-header';
import { useNetworkStatus } from '@/hooks/use-network-status';
import {
  fetchCoinTransactions,
  fetchWallet,
  type CoinTransaction,
} from '@/services/api/coin';
import { useAuthStore } from '@/stores/authStore';
import { useWalletRealtimeStore } from '@/stores/walletRealtimeStore';
import { Gradients, Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  // 信用卡质感:ISO 7810 ID-1 卡片比例(85.6×54mm ≈ 1.586),品牌紫渐变
  // 底 + 芯片/掩码卡号/持卡人,配实体卡投影。
  balanceCard: {
    borderRadius: Radius.xl,
    aspectRatio: 1.586,
    padding: Spacing.xl,
    justifyContent: 'space-between',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 10,
  },
  balanceOrb: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  balanceOrbTop: {
    width: 220,
    height: 220,
    right: -80,
    top: -110,
    opacity: 0.1,
  },
  balanceOrbBottom: {
    width: 160,
    height: 160,
    left: -60,
    bottom: -80,
    opacity: 0.08,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLabel: {
    ...Typography.h3,
    color: 'rgba(255,255,255,0.92)',
  },
  cardBrand: {
    fontSize: 16,
    fontWeight: '700',
    fontStyle: 'italic',
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.85)',
  },
  cardChip: {
    width: 48,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#E7C566',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.25)',
    overflow: 'hidden',
  },
  cardChipLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 17,
    height: 1.5,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  cardChipLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 23,
    width: 1.5,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  cardBalance: {
    color: '#FFFFFF',
    fontSize: 44,
    fontWeight: '700',
    marginTop: Spacing.md,
    fontVariant: ['tabular-nums'],
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  cardNumber: {
    fontSize: 16,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.9)',
    fontVariant: ['tabular-nums'],
  },
  cardHolder: {
    ...Typography.small,
    color: 'rgba(255,255,255,0.8)',
    flexShrink: 1,
    textAlign: 'right',
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
  const { t, i18n } = useTranslation();
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
  // 信用卡下沿的"卡号尾号/持卡人":尾号取账号 ID 后四位,纯装饰性掩码。
  const authUser = useAuthStore((state) => state.user);
  const cardTail = (authUser?.accountId ?? '').slice(-4).padStart(4, '0');
  const cardHolder = authUser?.nickname ?? '';
  const walletVersion = useWalletRealtimeStore((state) => state.version);
  // 首屏之后由 walletVersion 触发的那几次只是对账:实时通道已经把权威余额写
  // 进来了,再翻回「...」等一次 GET(最坏 15s 超时)是把已经正确的数字藏起来。
  const balanceSettledRef = useRef(false);

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
        if (__DEV__) console.warn('[WalletScreen] fetchWallet failed', error);
      } finally {
        if (!cancelled) {
          balanceSettledRef.current = true;
          setLoadingWallet(false);
        }
      }
    }

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
        if (__DEV__)
          console.warn('[WalletScreen] fetchCoinTransactions failed', error);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    }

    void loadBalance();
    void loadHistory();
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
        <View style={s.balanceCard}>
          <GradientCover colors={Gradients.memberCard} />
          <View style={[s.balanceOrb, s.balanceOrbTop]} />
          <View style={[s.balanceOrb, s.balanceOrbBottom]} />
          <View style={s.cardTopRow}>
            <Text style={s.cardLabel}>
              {t('profile.wallet.balance', { defaultValue: '积分余额' })}
            </Text>
            <Text style={s.cardBrand}>WindNote</Text>
          </View>
          <View>
            <View style={s.cardChip}>
              <View style={s.cardChipLineH} />
              <View style={s.cardChipLineV} />
            </View>
            <Text style={s.cardBalance}>{loadingWallet ? '...' : balance}</Text>
          </View>
          {walletError ? (
            <Text style={[Typography.caption, { color: colors.error }]}>
              {walletError}
            </Text>
          ) : null}
          <View style={s.cardBottomRow}>
            <Text style={s.cardNumber}>{`••••  ••••  ••••  ${cardTail}`}</Text>
            <Text style={s.cardHolder} numberOfLines={1}>
              {cardHolder}
            </Text>
          </View>
        </View>

        <View style={[s.notice, { backgroundColor: colors.surface }]}>
          <Text style={[Typography.bodyRegular, { color: colors.textSecondary }]}>
            {t('profile.wallet.purchaseUnavailable', {
              defaultValue: '积分购买暂未开放。',
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
          ) : transactions.length === 0 && !loadingHistory ? (
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
                    {new Date(transaction.createdAt).toLocaleDateString(
                      // 不传 locale 会跟着**设备**语言走:应用内切过语言的人,
                      // 钱包会一半中文一半设备语言。仓里已有这个集中映射。
                      getLocalizedDateTimeLocale(i18n.language),
                    )}
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
