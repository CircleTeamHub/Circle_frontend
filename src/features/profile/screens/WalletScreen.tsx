import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getLocalizedDateTimeLocale } from '@/utils/locale';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
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
import { reportHandledFailure } from '@/observability/report-failure';

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
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    // 贵金属感三件套之一:细金描边卡缘(其余是烫金 ID 数字与金弧线)。
    borderWidth: 1,
    borderColor: 'rgba(231,197,102,0.5)',
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
    color: '#F0D48A',
  },
  cardLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  goldCoin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E7C566',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goldCoinInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(146,110,38,0.7)',
  },
  cardBalance: {
    color: '#FFFFFF',
    fontSize: 44,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  // 压印数字质感:真实银行卡的卡号就是烫金/烫银压印。
  cardNumber: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 3,
    color: '#F0D48A',
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
  // 信用卡下沿:左侧直接展示账号 ID(与个人页「ID: xxxxxx」同一口径),
  // 右侧持卡人昵称。
  const authUser = useAuthStore((state) => state.user);
  const cardNumber = authUser?.accountId ?? '';
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
        reportHandledFailure('wallet', 'fetch', error);
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
        reportHandledFailure('wallet', 'fetchTransactions', error);
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
        <View testID="wallet-balance-card" style={s.balanceCard}>
          <GradientCover colors={Gradients.memberCard} />
          <View style={[s.balanceOrb, s.balanceOrbTop]} />
          <View style={[s.balanceOrb, s.balanceOrbBottom]} />
          {/* 两道极细金弧线扫过卡面(viewBox 随卡面拉伸,分辨率无关)。 */}
          <Svg
            style={StyleSheet.absoluteFill}
            viewBox="0 0 400 252"
            preserveAspectRatio="none"
            pointerEvents="none"
          >
            <Path
              d="M-10 214 Q 208 150 410 34"
              stroke="#F0D48A"
              strokeWidth={1.5}
              strokeOpacity={0.4}
              fill="none"
            />
            <Path
              d="M-10 236 Q 228 178 410 66"
              stroke="#F0D48A"
              strokeWidth={1}
              strokeOpacity={0.22}
              fill="none"
            />
          </Svg>
          <View style={s.cardTopRow}>
            <View style={s.cardLabelRow}>
              <View style={s.goldCoin}>
                <View style={s.goldCoinInner} />
              </View>
              <Text style={s.cardLabel}>
                {t('profile.wallet.balance', { defaultValue: '积分余额' })}
              </Text>
            </View>
            <Text style={s.cardBrand}>WindNote</Text>
          </View>
          <Text style={s.cardBalance}>{loadingWallet ? '...' : balance}</Text>
          <View style={s.cardBottomRow}>
            <Text style={s.cardNumber}>{cardNumber}</Text>
            <Text style={s.cardHolder} numberOfLines={1}>
              {cardHolder}
            </Text>
          </View>
        </View>
        {walletError ? (
          <Text
            testID="wallet-balance-error"
            selectable
            style={[Typography.caption, { color: colors.error }]}
          >
            {walletError}
          </Text>
        ) : null}

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
