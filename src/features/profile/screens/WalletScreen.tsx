import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { useNetworkStatus } from '@/hooks/use-network-status';
import { fetchWallet, rechargePoints } from '@/services/api/coin';
import { useWalletRealtimeStore } from '@/stores/walletRealtimeStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const RECHARGE_PACKAGES = [
  { points: 100, price: '¥10.00' },
  { points: 300, price: '¥30.00' },
  { points: 500, price: '¥50.00' },
  { points: 1000, price: '¥100.00' },
  { points: 2000, price: '¥200.00' },
];

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
  sectionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  sectionMark: {
    width: 4,
    height: 24,
    borderRadius: 999,
  },
  packageCard: {
    minHeight: 74,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pointsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.xs,
  },
  agreement: {
    paddingTop: Spacing.sm,
  },
  button: {
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
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
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const [selectedPoints, setSelectedPoints] = useState(RECHARGE_PACKAGES[0].points);
  const [recharging, setRecharging] = useState(false);
  const realtimeBalance = useWalletRealtimeStore((state) => state.balance);
  const walletVersion = useWalletRealtimeStore((state) => state.version);

  useEffect(() => {
    let cancelled = false;

    async function loadWallet() {
      setLoadingWallet(true);
      setWalletError(null);
      setWalletStatus(null);
      try {
        const wallet = await fetchWallet();
        if (!cancelled) {
          setBalance(wallet.balance);
        }
      } catch (error) {
        if (!cancelled) {
          setWalletError(
            t('profile.wallet.loadError', {
              defaultValue: '积分余额加载失败，请稍后重试',
            }),
          );
        }
        if (__DEV__) {
          console.warn('[WalletScreen] fetchWallet failed', error);
        }
      } finally {
        if (!cancelled) {
          setLoadingWallet(false);
        }
      }
    }

    loadWallet();

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (typeof realtimeBalance === 'number') {
      setBalance(realtimeBalance);
    }
  }, [realtimeBalance, walletVersion]);

  const performRecharge = useCallback(async () => {
    setRecharging(true);
    setWalletError(null);
    setWalletStatus(null);
    try {
      const wallet = await rechargePoints(selectedPoints);
      setBalance(wallet.balance);
      setWalletStatus(
        t('profile.wallet.rechargeSuccess', {
          defaultValue: '已充值 {{points}} 积分',
          points: selectedPoints,
        }),
      );
    } catch (error) {
      setWalletError(
        t('profile.wallet.rechargeError', { defaultValue: '充值失败，请稍后重试' }),
      );
      if (__DEV__) {
        console.warn('[WalletScreen] rechargePoints failed', error);
      }
    } finally {
      setRecharging(false);
    }
  }, [selectedPoints, t]);

  const handleRecharge = useCallback(() => {
    if (recharging) {
      return;
    }
    const pkg = RECHARGE_PACKAGES.find((p) => p.points === selectedPoints);
    Alert.alert(
      t('profile.wallet.confirmRecharge', { defaultValue: '确认充值' }),
      t('profile.wallet.confirmRechargeMessage', {
        defaultValue: '确定要充值 {{points}} 积分（{{price}}）吗？',
        points: selectedPoints,
        price: pkg?.price ?? '',
      }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('profile.wallet.confirmRecharge', { defaultValue: '确认充值' }),
          onPress: performRecharge,
        },
      ],
    );
  }, [performRecharge, recharging, selectedPoints, t]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
      },
      content: {
        paddingBottom: insets.bottom + Spacing.xl,
      },
      balanceCard: {
        backgroundColor: colors.blue,
      },
      balanceOrb: {
        backgroundColor: colors.white,
      },
      balanceLabel: {
        color: 'rgba(0,0,0,0.62)',
        ...Typography.h3,
      },
      balance: {
        color: 'rgba(0,0,0,0.72)',
        fontSize: 54,
        fontWeight: '700' as const,
        marginTop: Spacing.lg,
        fontVariant: ['tabular-nums'] as any,
      },
      sectionMark: {
        backgroundColor: colors.blue,
      },
      sectionTitle: {
        color: colors.text,
        ...Typography.h2,
      },
      packageCard: {
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.surface,
      },
      packageCardActive: {
        borderColor: colors.blue,
      },
      points: {
        color: colors.text,
        fontSize: 28,
        fontWeight: '800' as const,
      },
      pointsActive: {
        color: colors.blue,
      },
      unit: {
        color: colors.textSecondary,
        ...Typography.body,
      },
      price: {
        color: colors.text,
        fontSize: 24,
        fontWeight: '800' as const,
      },
      priceActive: {
        color: colors.blue,
      },
      agreement: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      link: {
        color: colors.blue,
        fontWeight: '700' as const,
      },
      error: {
        color: colors.error,
        ...Typography.caption,
      },
      status: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      button: {
        backgroundColor: colors.blue,
      },
      buttonDisabled: {
        backgroundColor: colors.surfaceBorder,
      },
      buttonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '700' as const,
      },
    }),
    [colors, insets.bottom, insets.top],
  );

  return (
    <View style={d.container}>
      <NavHeader
        title={t('profile.wallet.title', { defaultValue: '我的钱包' })}
        rightIcon="card-outline"
      />
      <ScrollView contentContainerStyle={[s.content, d.content]}>
        {isOffline ? (
          <Text style={d.error}>
            {t('common.offline', { defaultValue: '当前无网络连接，部分功能可能不可用' })}
          </Text>
        ) : null}
        <View style={[s.balanceCard, d.balanceCard]}>
          <View style={[s.balanceOrb, d.balanceOrb]} />
          <Text style={d.balanceLabel}>
            {t('profile.wallet.balance', { defaultValue: '积分余额' })}
          </Text>
          <Text style={d.balance}>{loadingWallet ? '...' : balance}</Text>
          {walletError ? <Text style={d.error}>{walletError}</Text> : null}
          {walletStatus ? <Text style={d.status}>{walletStatus}</Text> : null}
        </View>

        <View style={s.sectionTitleWrap}>
          <View style={[s.sectionMark, d.sectionMark]} />
          <Text style={d.sectionTitle}>
            {t('profile.wallet.recharge', { defaultValue: '积分充值' })}
          </Text>
        </View>

        {RECHARGE_PACKAGES.map((item) => {
          const active = selectedPoints === item.points;
          return (
            <Pressable
              key={item.points}
              style={[s.packageCard, d.packageCard, active && d.packageCardActive]}
              onPress={() => setSelectedPoints(item.points)}
            >
              <View style={s.pointsRow}>
                <Text style={[d.points, active && d.pointsActive]}>{item.points}</Text>
                <Text style={d.unit}>{t('common.coin', { defaultValue: '积分' })}</Text>
              </View>
              <Text style={[d.price, active && d.priceActive]}>{item.price}</Text>
            </Pressable>
          );
        })}

        <Text style={[s.agreement, d.agreement]}>
          {t('profile.wallet.agreementPrefix', { defaultValue: '我已阅读并同意' })}{' '}
          <Text style={d.link}>
            {t('profile.wallet.memberAgreement', { defaultValue: '《会员服务协议》' })}
          </Text>{' '}
          {t('profile.wallet.agreementAnd', { defaultValue: '和' })}{' '}
          <Text style={d.link}>
            {t('common.privacyPolicy', { defaultValue: '《隐私政策》' })}
          </Text>
        </Text>

        <Pressable
          style={[s.button, recharging ? d.buttonDisabled : d.button]}
          disabled={recharging}
          onPress={handleRecharge}
        >
          <Text style={d.buttonText}>
            {recharging
              ? t('profile.wallet.recharging', { defaultValue: '充值中...' })
              : t('profile.wallet.buyNow', {
                  defaultValue: '立即购买 {{points}} 积分',
                  points: selectedPoints,
                })}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
