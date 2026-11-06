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
import { isDefinitiveAuthFailure } from '@/services/api/client';
import { useAuthStore } from '@/stores/authStore';
import {
  captureAuthSessionIdentity,
  isAuthSessionIdentityCurrent,
} from '@/stores/auth-session-identity';
import { useWalletRealtimeStore } from '@/stores/walletRealtimeStore';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';
import { getPageSnapshotRevision, readPageSnapshot, removePageSnapshot, writePageSnapshot } from '@/storage/page-snapshots';

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
  const sessionKey = useAuthStore((state) => state.user?.id ? `${state.user.id}:${state.sessionEpoch}` : null);
  return sessionKey ? <WalletContent key={sessionKey} /> : null;
}

function WalletContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isOffline } = useNetworkStatus();
  const realtimeBalance = useWalletRealtimeStore((state) => state.balance);
  // 信用卡下沿:左侧直接展示账号 ID(与个人页「ID: xxxxxx」同一口径),
  // 右侧持卡人昵称。
  const authUser = useAuthStore((state) => state.user);
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const ownerKey = `${sessionEpoch}:${authUser?.id ?? ''}`;
  const cardNumber = authUser?.accountId ?? '';
  const cardHolder = authUser?.nickname ?? '';
  const walletVersion = useWalletRealtimeStore((state) => state.version);
  const presentationRevision = useRef(getPageSnapshotRevision()).current;
  const [walletState, setWalletState] = useState(() => {
    const balance = realtimeBalance ?? readPageSnapshot<number>(authUser?.id, 'wallet:balance')?.value ?? null;
    return { owner: ownerKey, balance, loading: balance === null, error: null as string | null };
  });
  const [historyState, setHistoryState] = useState(() => {
    const snapshot = readPageSnapshot<CoinTransaction[]>(authUser?.id, 'wallet:history');
    return { owner: ownerKey, transactions: snapshot?.value ?? [], loaded: Boolean(snapshot), loading: !snapshot, error: null as string | null };
  });
  const currentWallet = walletState.owner === ownerKey ? walletState : null;
  const currentHistory = historyState.owner === ownerKey ? historyState : null;
  const balance = currentWallet?.balance ?? 0;
  const loadingWallet = currentWallet?.loading ?? true;
  const walletError = currentWallet?.error ?? null;
  const transactions = currentHistory?.transactions ?? [];
  const loadingHistory = currentHistory?.loading ?? true;
  const historyError = currentHistory?.error ?? null;
  // 流水加载失败后点「重试」：只重拉流水，不动已经显示的余额。
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const retryHistory = useCallback(() => setHistoryReloadKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    const owner = captureAuthSessionIdentity(useAuthStore.getState());
    if (!owner) return;
    const ownerId = owner.userId;
    const isCurrent = () => !cancelled &&
      isAuthSessionIdentityCurrent(owner, useAuthStore.getState());
    const initial = useWalletRealtimeStore.getState();
    const revision = getPageSnapshotRevision();
    const startedAt = Date.now();

    async function loadBalance() {
      setWalletState((current) => {
        const knownBalance = current.owner === ownerKey ? current.balance : initial.balance;
        return { owner: ownerKey, balance: knownBalance, loading: knownBalance === null, error: null };
      });
      try {
        const wallet = await fetchWallet();
        if (!isCurrent() || useWalletRealtimeStore.getState().version !== initial.version) return;
        setWalletState((current) => ({ ...current, balance: wallet.balance }));
        if (getPageSnapshotRevision() === revision) writePageSnapshot(ownerId, 'wallet:balance', wallet.balance, startedAt);
      } catch (error) {
        if (isAuthSessionIdentityCurrent(owner, useAuthStore.getState()) &&
          useWalletRealtimeStore.getState().version === initial.version && isDefinitiveAuthFailure(error)) {
          removePageSnapshot(owner.userId, 'wallet:balance');
        }
        if (!isCurrent() || useWalletRealtimeStore.getState().version !== initial.version) return;
        setWalletState((current) => ({
          ...current,
          balance: isDefinitiveAuthFailure(error) ? null : current.balance,
          error: t('profile.wallet.loadError', {
            defaultValue: '积分余额加载失败，请稍后重试',
          }),
        }));
        reportHandledFailure('wallet', 'fetch', error);
      } finally {
        if (isCurrent()) {
          setWalletState((current) => ({ ...current, loading: false }));
        }
      }
    }

    void loadBalance();
    return () => {
      cancelled = true;
    };
  }, [ownerKey, t]);

  useEffect(() => {
    let cancelled = false;
    const owner = captureAuthSessionIdentity(useAuthStore.getState());
    if (!owner) return;
    const ownerId = owner.userId;
    const isCurrent = () => !cancelled &&
      isAuthSessionIdentityCurrent(owner, useAuthStore.getState());
    const revision = getPageSnapshotRevision();
    const startedAt = Date.now();

    async function loadHistory() {
      setHistoryState((current) => ({
        owner: ownerKey,
        transactions: current.owner === ownerKey ? current.transactions : [],
        loaded: current.owner === ownerKey && current.loaded,
        loading: current.owner !== ownerKey || !current.loaded,
        error: null,
      }));
      try {
        const rows = await fetchCoinTransactions();
        if (!isCurrent()) return;
        setHistoryState((current) => ({ ...current, transactions: rows, loaded: true }));
        if (getPageSnapshotRevision() === revision) writePageSnapshot(ownerId, 'wallet:history', rows, startedAt);
      } catch (error) {
        if (isAuthSessionIdentityCurrent(owner, useAuthStore.getState()) && isDefinitiveAuthFailure(error)) {
          removePageSnapshot(owner.userId, 'wallet:history');
        }
        if (!isCurrent()) return;
        setHistoryState((current) => ({
          ...current,
          transactions: isDefinitiveAuthFailure(error) ? [] : current.transactions,
          loaded: !isDefinitiveAuthFailure(error) && current.loaded,
          error: t('profile.wallet.historyLoadError', {
            defaultValue: '积分流水加载失败',
          }),
        }));
        reportHandledFailure('wallet', 'fetchTransactions', error);
      } finally {
        if (isCurrent()) setHistoryState((current) => ({ ...current, loading: false }));
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [ownerKey, t, walletVersion, historyReloadKey]);

  // 实时通道已经读过权威余额;这里只消费结果,不再为 version 变化重复 GET。
  useEffect(() => {
    if (typeof realtimeBalance === 'number') {
      setWalletState({ owner: ownerKey, balance: realtimeBalance, loading: false, error: null });
      if (getPageSnapshotRevision() === presentationRevision) {
        writePageSnapshot(useAuthStore.getState().user?.id, 'wallet:balance', realtimeBalance);
      }
    }
  }, [ownerKey, presentationRevision, realtimeBalance, walletVersion]);

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
