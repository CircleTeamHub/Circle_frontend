import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { useNetworkStatus } from '@/hooks/use-network-status';
import { fetchWallet } from '@/services/api/coin';
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
});

export default function WalletScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isOffline } = useNetworkStatus();
  const [balance, setBalance] = useState(0);
  const [loadingWallet, setLoadingWallet] = useState(true);
  const [walletError, setWalletError] = useState<string | null>(null);
  const realtimeBalance = useWalletRealtimeStore((state) => state.balance);
  const walletVersion = useWalletRealtimeStore((state) => state.version);

  useEffect(() => {
    let cancelled = false;

    async function loadWallet() {
      setLoadingWallet(true);
      setWalletError(null);
      try {
        const wallet = await fetchWallet();
        if (!cancelled) setBalance(wallet.balance);
      } catch (error) {
        if (!cancelled) {
          setWalletError(
            t('profile.wallet.loadError', {
              defaultValue: '积分余额加载失败，请稍后重试',
            }),
          );
        }
        if (__DEV__) console.warn('[WalletScreen] fetchWallet failed', error);
      } finally {
        if (!cancelled) setLoadingWallet(false);
      }
    }

    loadWallet();
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (typeof realtimeBalance === 'number') setBalance(realtimeBalance);
  }, [realtimeBalance, walletVersion]);

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
      </ScrollView>
    </View>
  );
}
