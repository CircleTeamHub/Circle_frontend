import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { RetryIntentKeyStore } from '@/features/profile/retry-intent-key';
import {
  beginFancyNumberOperation,
  hasConflictingFancyNumberRecommendations,
  hasMatchingFancyNumberCatalogQuote,
  isLatestFancyNumberOperation,
} from '@/features/profile/fancy-number-operation-fence';
import { useNetworkStatus } from '@/hooks/use-network-status';
import { fetchCurrentUser } from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';
import {
  checkFancyNumberAvailability,
  fetchFancyNumbers,
  fetchMyFancyNumber,
  purchaseCustomFancyNumber,
  purchaseFancyNumber,
  renewFancyNumber,
  switchPermanentFancyNumber,
  switchPermanentToCustomFancyNumber,
  type FancyNumberItem,
  type FancyNumberList,
  type FancyNumberPurchaseResult,
  type MyFancyNumber,
} from '@/services/api/fancy-number';
import {
  captureAuthSessionIdentity,
  isAuthSessionIdentityCurrent,
  type AuthSessionIdentity,
} from '@/stores/auth-session-identity';
import { useAuthStore } from '@/stores/authStore';
import { useKnownAccountsStore } from '@/stores/knownAccountsStore';
import { useWalletRealtimeStore } from '@/stores/walletRealtimeStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { generateIdempotencyKey } from '@/utils/idempotency-key';

const PAGE_SIZE = 20;
const CUSTOM_VALUE_PATTERN = /^[A-Z0-9]{6}$/;

type AvailabilityState =
  | { status: 'idle' | 'invalid' | 'checking' | 'available' }
  | { status: 'unavailable'; reason: 'TAKEN' | 'RESERVED' }
  | { status: 'error'; message: string };

type LeaseLoadStatus = 'loading' | 'ready' | 'error';

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  centered: {
    paddingVertical: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  hero: {
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.sm,
    overflow: 'hidden',
  },
  heroOrb: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: Radius.full,
    right: -45,
    bottom: -95,
  },
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.md,
  },
  numberValue: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 1,
  },
  badge: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  monthButton: {
    minWidth: 52,
    height: 38,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  numberGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  numberButton: {
    width: '48%',
    minHeight: 58,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  customInput: {
    height: 64,
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 3,
    textAlign: 'center',
  },
  primaryButton: {
    height: 50,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  secondaryButton: {
    alignSelf: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  disabled: {
    opacity: 0.55,
  },
});

function formatExpiry(value: string | null, permanentLabel: string): string {
  if (!value) return permanentLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return permanentLabel;
  return date.toLocaleDateString();
}

function mineFromResult(result: FancyNumberPurchaseResult): MyFancyNumber {
  return {
    active: true,
    accountId: result.accountId,
    restoreAccountId: null,
    startedAt: new Date().toISOString(),
    expiresAt: result.expiresAt,
    permanent: result.permanent,
    renewable: !result.permanent,
    unitPrice: result.unitPrice,
  };
}

export default function FancyNumberScreen() {
  const { t } = useTranslation();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isOffline } = useNetworkStatus();
  const [mine, setMine] = useState<MyFancyNumber | null>(null);
  const [leaseStatus, setLeaseStatus] = useState<LeaseLoadStatus>('loading');
  const [catalog, setCatalog] = useState<FancyNumberList | null>(null);
  const [items, setItems] = useState<FancyNumberItem[]>([]);
  const [customValue, setCustomValue] = useState('');
  const [selectedRecommendation, setSelectedRecommendation] =
    useState<FancyNumberItem | null>(null);
  const [availability, setAvailability] = useState<AvailabilityState>({
    status: 'idle',
  });
  const [months, setMonths] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const focusGenerationRef = useRef(0);
  const catalogCursorRef = useRef<string | null>(null);
  const itemsRef = useRef<FancyNumberItem[]>([]);
  const availabilityGenerationRef = useRef(0);
  const [availabilityRefresh, setAvailabilityRefresh] = useState(0);
  const selectedRecommendationRef = useRef<FancyNumberItem | null>(null);
  const focusedRef = useRef(false);
  const purchaseInFlightRef = useRef(false);
  const pendingIntentRef = useRef<RetryIntentKeyStore | null>(null);
  if (!pendingIntentRef.current) {
    pendingIntentRef.current = new RetryIntentKeyStore(generateIdempotencyKey);
  }

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const updateSelectedRecommendation = useCallback(
    (item: FancyNumberItem | null) => {
      selectedRecommendationRef.current = item;
      setSelectedRecommendation(item);
    },
    [],
  );

  const loadInitial = useCallback(
    async (
      generation = focusGenerationRef.current,
      owner?: AuthSessionIdentity,
    ) => {
      const canCommit = () =>
        generation === focusGenerationRef.current &&
        (!owner ||
          isAuthSessionIdentityCurrent(owner, useAuthStore.getState()));
      if (!canCommit()) return;
      catalogCursorRef.current = null;
      setLoadingMore(false);
      setLoading(true);
      setLeaseStatus('loading');
      setErrorText(null);
      try {
        const [mineResult, catalogResult] = await Promise.allSettled([
          fetchMyFancyNumber(),
          fetchFancyNumbers({ limit: PAGE_SIZE }),
        ]);
        if (!canCommit()) return;
        let loadError: unknown = null;
        if (mineResult.status === 'fulfilled') {
          setMine(mineResult.value);
          setLeaseStatus('ready');
        } else {
          setLeaseStatus('error');
          loadError = mineResult.reason;
        }
        if (catalogResult.status === 'fulfilled') {
          const nextCatalog = catalogResult.value;
          const nextItems = nextCatalog.items
            .filter((item) =>
              CUSTOM_VALUE_PATTERN.test(item.value.toUpperCase()),
            )
            .map((item) => ({ ...item, value: item.value.toUpperCase() }));
          catalogCursorRef.current = nextCatalog.nextCursor;
          setCatalog(nextCatalog);
          setItems(nextItems);
          const currentSelection = selectedRecommendationRef.current;
          if (currentSelection) {
            const refreshedSelection =
              nextItems.find((item) => item.id === currentSelection.id) ?? null;
            updateSelectedRecommendation(refreshedSelection);
            if (refreshedSelection) {
              setCustomValue(refreshedSelection.value);
            } else {
              setAvailability({ status: 'checking' });
              setAvailabilityRefresh((current) => current + 1);
            }
          }
          setMonths((current) =>
            Math.min(
              nextCatalog.maxMonths,
              Math.max(nextCatalog.minMonths, current),
            ),
          );
        } else {
          loadError ??= catalogResult.reason;
        }
        if (!loadError) return;
        setErrorText(
          getApiErrorMessage(
            loadError,
            t('profile.fancyNumber.loadError', {
              defaultValue: '靓号信息加载失败，请稍后重试',
            }),
          ),
        );
      } finally {
        if (canCommit()) setLoading(false);
      }
    },
    [t, updateSelectedRecommendation],
  );

  useEffect(() => {
    const generation = availabilityGenerationRef.current + 1;
    availabilityGenerationRef.current = generation;

    if (!customValue) {
      setAvailability({ status: 'idle' });
      return;
    }
    if (!CUSTOM_VALUE_PATTERN.test(customValue)) {
      setAvailability({ status: 'invalid' });
      return;
    }
    if (isOffline) {
      setAvailability({
        status: 'error',
        message: t('common.offline', {
          defaultValue: '当前无网络连接',
        }),
      });
      return;
    }

    setAvailability({ status: 'checking' });
    const timer = setTimeout(() => {
      void checkFancyNumberAvailability(customValue)
        .then((result) => {
          if (generation !== availabilityGenerationRef.current) return;
          setAvailability(
            result.available
              ? { status: 'available' }
              : {
                  status: 'unavailable',
                  reason: result.reason ?? 'TAKEN',
                },
          );
        })
        .catch((error) => {
          if (generation !== availabilityGenerationRef.current) return;
          setAvailability({
            status: 'error',
            message: getApiErrorMessage(
              error,
              t('profile.fancyNumber.availabilityError', {
                defaultValue: '暂时无法查询，请稍后重试',
              }),
            ),
          });
        });
    }, 350);

    return () => clearTimeout(timer);
  }, [availabilityRefresh, customValue, isOffline, t]);

  useFocusEffect(
    useCallback(() => {
      const generation = focusGenerationRef.current + 1;
      focusGenerationRef.current = generation;
      focusedRef.current = true;
      setSubmitting(purchaseInFlightRef.current);
      setAvailabilityRefresh((current) => current + 1);
      catalogCursorRef.current = null;
      setLoadingMore(false);
      void loadInitial(generation);
      return () => {
        focusedRef.current = false;
        focusGenerationRef.current += 1;
        availabilityGenerationRef.current += 1;
        catalogCursorRef.current = null;
        setLoadingMore(false);
      };
    }, [loadInitial]),
  );

  const refreshAuthUser = useCallback(
    async (owner: AuthSessionIdentity, operation?: number) => {
      const canCommit = () =>
        isAuthSessionIdentityCurrent(owner, useAuthStore.getState()) &&
        (operation === undefined || isLatestFancyNumberOperation(operation));
      if (!canCommit()) return;
      const refreshed = await fetchCurrentUser();
      const latest = useAuthStore.getState();
      if (!canCommit() || refreshed.id !== owner.userId) return;

      latest.setUser(refreshed);
      const current = useAuthStore.getState();
      if (!canCommit() || !current.accessToken || !current.refreshToken) return;
      useKnownAccountsStore.getState().upsertAccount({
        user: refreshed,
        accessToken: current.accessToken,
        refreshToken: current.refreshToken,
        imToken: current.imToken,
        updatedAt: Date.now(),
      });
    },
    [],
  );

  const intentKey = useCallback((signature: string) => {
    return pendingIntentRef.current!.get(signature);
  }, []);

  const finishPurchase = useCallback(
    async (
      owner: AuthSessionIdentity,
      result: FancyNumberPurchaseResult,
      walletVersion: number,
      generation: number,
      operation: number,
      intent: { signature: string; key: string },
      action: 'purchase' | 'renewal' | 'switch' = 'purchase',
      previousAccountId?: string | null,
    ) => {
      if (!isAuthSessionIdentityCurrent(owner, useAuthStore.getState())) return;
      pendingIntentRef.current!.complete(intent.signature, intent.key);
      if (!isLatestFancyNumberOperation(operation)) return;
      useWalletRealtimeStore
        .getState()
        .setRealtimeBalanceIfVersion(walletVersion, result.walletBalanceAfter);
      const authState = useAuthStore.getState();
      if (isAuthSessionIdentityCurrent(owner, authState) && authState.user) {
        const nextUser = {
          ...authState.user,
          accountId: result.accountId,
          fancyNumber: true,
        };
        authState.setUser(nextUser);
        const current = useAuthStore.getState();
        if (
          isAuthSessionIdentityCurrent(owner, current) &&
          current.accessToken &&
          current.refreshToken
        ) {
          useKnownAccountsStore.getState().upsertAccount({
            user: nextUser,
            accessToken: current.accessToken,
            refreshToken: current.refreshToken,
            imToken: current.imToken,
            updatedAt: Date.now(),
          });
        }
      }
      const completionGeneration =
        generation === focusGenerationRef.current
          ? generation
          : focusedRef.current
            ? focusGenerationRef.current + 1
            : null;
      if (completionGeneration === null) return;
      if (completionGeneration !== generation) {
        focusGenerationRef.current = completionGeneration;
        await loadInitial(completionGeneration, owner);
      }
      const canCommit = () =>
        completionGeneration === focusGenerationRef.current &&
        focusedRef.current &&
        isLatestFancyNumberOperation(operation) &&
        isAuthSessionIdentityCurrent(owner, useAuthStore.getState());
      if (!canCommit()) return;
      setMine(mineFromResult(result));
      setLeaseStatus('ready');
      setItems((current) =>
        current.filter((item) => item.value !== result.accountId),
      );
      updateSelectedRecommendation(null);
      setCustomValue('');
      setAvailability({ status: 'idle' });
      await refreshAuthUser(owner, operation).catch(() => undefined);
      if (!canCommit()) return;
      if (action === 'switch') {
        await loadInitial(completionGeneration, owner);
        if (!canCommit()) return;
      }
      Alert.alert(
        t('profile.fancyNumber.successTitle', { defaultValue: '操作成功' }),
        action === 'switch'
          ? t('profile.fancyNumber.switchSuccess', {
              defaultValue: '已将永久靓号从 {{previous}} 更换为 {{accountId}}',
              previous: previousAccountId,
              accountId: result.accountId,
            })
          : result.permanent
            ? t('profile.fancyNumber.permanentSuccess', {
                defaultValue: '已领取永久靓号 {{accountId}}',
                accountId: result.accountId,
              })
            : t('profile.fancyNumber.paidSuccess', {
                defaultValue: '靓号 {{accountId}} 已生效，有效期至 {{date}}',
                accountId: result.accountId,
                date: formatExpiry(
                  result.expiresAt,
                  t('profile.fancyNumber.permanent', { defaultValue: '永久' }),
                ),
              }),
      );
    },
    [loadInitial, refreshAuthUser, t, updateSelectedRecommendation],
  );

  const performPurchase = useCallback(async () => {
    if (
      !catalog ||
      submitting ||
      purchaseInFlightRef.current ||
      leaseStatus !== 'ready' ||
      availability.status !== 'available' ||
      !CUSTOM_VALUE_PATTERN.test(customValue)
    ) {
      return;
    }

    const isPermanent = catalog.purchaseMode === 'PERMANENT_FREE';
    const owner = captureAuthSessionIdentity(useAuthStore.getState());
    if (!owner) return;
    const generation = focusGenerationRef.current;
    const operation = beginFancyNumberOperation();
    const sessionIntent = `${owner.sessionEpoch}:${owner.userId}`;
    const signature = selectedRecommendation?.id
      ? `${sessionIntent}:catalog-purchase:${selectedRecommendation.id}:${isPermanent ? 'permanent' : months}:${catalog.unitPrice}`
      : `${sessionIntent}:custom-purchase:${customValue}:${isPermanent ? 'permanent' : months}:${catalog.unitPrice}`;
    const walletVersion = useWalletRealtimeStore.getState().version;
    const idempotencyKey = intentKey(signature);
    purchaseInFlightRef.current = true;
    setSubmitting(true);
    try {
      const options = { idempotencyKey };
      const result = selectedRecommendation?.id
        ? await purchaseFancyNumber(
            selectedRecommendation.id,
            isPermanent
              ? { expectedUnitPrice: catalog.unitPrice }
              : { months, expectedUnitPrice: catalog.unitPrice },
            options,
          )
        : await purchaseCustomFancyNumber(
            isPermanent
              ? { value: customValue, expectedUnitPrice: catalog.unitPrice }
              : {
                  value: customValue,
                  months,
                  expectedUnitPrice: catalog.unitPrice,
                },
            options,
          );
      if (
        selectedRecommendation?.id &&
        result.accountId !== selectedRecommendation.value
      ) {
        throw new Error(
          t('common.errors.invalidServerResponse', {
            defaultValue: '服务返回了无效数据',
          }),
        );
      }
      await finishPurchase(
        owner,
        result,
        walletVersion,
        generation,
        operation,
        {
          signature,
          key: idempotencyKey,
        },
      );
    } catch (error) {
      if (
        generation !== focusGenerationRef.current ||
        !isLatestFancyNumberOperation(operation) ||
        !isAuthSessionIdentityCurrent(owner, useAuthStore.getState())
      )
        return;
      Alert.alert(
        t('common.errorOccurred', { defaultValue: '操作失败' }),
        getApiErrorMessage(
          error,
          t('profile.fancyNumber.purchaseError', {
            defaultValue: '购买失败，请稍后重试',
          }),
        ),
      );
      await Promise.allSettled([
        loadInitial(generation, owner),
        refreshAuthUser(owner, operation),
      ]);
    } finally {
      purchaseInFlightRef.current = false;
      if (
        focusedRef.current &&
        isAuthSessionIdentityCurrent(owner, useAuthStore.getState())
      ) {
        setSubmitting(false);
      }
    }
  }, [
    availability.status,
    catalog,
    customValue,
    finishPurchase,
    intentKey,
    leaseStatus,
    loadInitial,
    months,
    refreshAuthUser,
    selectedRecommendation,
    submitting,
    t,
  ]);

  const confirmPurchase = useCallback(() => {
    if (
      !catalog ||
      leaseStatus !== 'ready' ||
      availability.status !== 'available' ||
      !CUSTOM_VALUE_PATTERN.test(customValue)
    ) {
      return;
    }
    const permanent = catalog.purchaseMode === 'PERMANENT_FREE';
    const total = permanent ? 0 : months * catalog.unitPrice;
    Alert.alert(
      t('profile.fancyNumber.confirmTitle', { defaultValue: '确认购买靓号' }),
      permanent
        ? t('profile.fancyNumber.confirmPermanent', {
            defaultValue:
              '超级会员可免费领取永久靓号 {{accountId}}，以后可使用 100 积分更换。',
            accountId: customValue,
          })
        : t('profile.fancyNumber.confirmPaid', {
            defaultValue:
              '确认使用 {{points}} 积分购买靓号 {{accountId}}，有效期 {{months}} 个月？',
            points: total,
            accountId: customValue,
            months,
          }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('common.confirm', { defaultValue: '确认' }),
          onPress: () => void performPurchase(),
        },
      ],
    );
  }, [
    availability.status,
    catalog,
    customValue,
    leaseStatus,
    months,
    performPurchase,
    t,
  ]);

  const performRenewal = useCallback(async () => {
    if (
      leaseStatus !== 'ready' ||
      !mine?.renewable ||
      submitting ||
      purchaseInFlightRef.current
    )
      return;
    const owner = captureAuthSessionIdentity(useAuthStore.getState());
    if (!owner) return;
    const generation = focusGenerationRef.current;
    const operation = beginFancyNumberOperation();
    const signature = `${owner.sessionEpoch}:${owner.userId}:renew:${mine.accountId}:${mine.expiresAt}:${months}:${mine.unitPrice}`;
    const walletVersion = useWalletRealtimeStore.getState().version;
    const idempotencyKey = intentKey(signature);
    purchaseInFlightRef.current = true;
    setSubmitting(true);
    try {
      const result = await renewFancyNumber(
        { months, expectedUnitPrice: mine.unitPrice },
        { idempotencyKey },
      );
      if (result.accountId !== mine.accountId) {
        throw new Error(
          t('common.errors.invalidServerResponse', {
            defaultValue: '服务返回了无效数据',
          }),
        );
      }
      await finishPurchase(
        owner,
        result,
        walletVersion,
        generation,
        operation,
        { signature, key: idempotencyKey },
        'renewal',
      );
    } catch (error) {
      if (
        generation !== focusGenerationRef.current ||
        !isLatestFancyNumberOperation(operation) ||
        !isAuthSessionIdentityCurrent(owner, useAuthStore.getState())
      )
        return;
      Alert.alert(
        t('common.errorOccurred', { defaultValue: '操作失败' }),
        getApiErrorMessage(
          error,
          t('profile.fancyNumber.renewError', {
            defaultValue: '续费失败，请稍后重试',
          }),
        ),
      );
      await Promise.allSettled([
        loadInitial(generation, owner),
        refreshAuthUser(owner, operation),
      ]);
    } finally {
      purchaseInFlightRef.current = false;
      if (
        focusedRef.current &&
        isAuthSessionIdentityCurrent(owner, useAuthStore.getState())
      ) {
        setSubmitting(false);
      }
    }
  }, [
    finishPurchase,
    intentKey,
    leaseStatus,
    loadInitial,
    mine,
    months,
    refreshAuthUser,
    submitting,
    t,
  ]);

  const confirmRenewal = useCallback(() => {
    if (leaseStatus !== 'ready' || !mine?.renewable) return;
    Alert.alert(
      t('profile.fancyNumber.confirmRenewTitle', {
        defaultValue: '确认续费靓号',
      }),
      t('profile.fancyNumber.confirmRenew', {
        defaultValue:
          '确认使用 {{points}} 积分为 {{accountId}} 续费 {{months}} 个月？',
        points: months * mine.unitPrice,
        accountId: mine.accountId,
        months,
      }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('common.confirm', { defaultValue: '确认' }),
          onPress: () => void performRenewal(),
        },
      ],
    );
  }, [leaseStatus, mine, months, performRenewal, t]);

  const performSwitch = useCallback(async () => {
    if (
      !mine?.permanent ||
      submitting ||
      purchaseInFlightRef.current ||
      leaseStatus !== 'ready' ||
      availability.status !== 'available' ||
      !CUSTOM_VALUE_PATTERN.test(customValue)
    ) {
      return;
    }
    const previousAccountId = mine.accountId;
    const owner = captureAuthSessionIdentity(useAuthStore.getState());
    if (!owner) return;
    const generation = focusGenerationRef.current;
    const operation = beginFancyNumberOperation();
    const sessionIntent = `${owner.sessionEpoch}:${owner.userId}`;
    const expectedUnitPrice = catalog?.unitPrice ?? mine.unitPrice;
    const signature = selectedRecommendation?.id
      ? `${sessionIntent}:catalog-switch:${previousAccountId}:${selectedRecommendation.id}:${expectedUnitPrice}`
      : `${sessionIntent}:custom-switch:${previousAccountId}:${customValue}:${expectedUnitPrice}`;
    const walletVersion = useWalletRealtimeStore.getState().version;
    const idempotencyKey = intentKey(signature);
    purchaseInFlightRef.current = true;
    setSubmitting(true);
    try {
      const options = { idempotencyKey };
      const result = selectedRecommendation?.id
        ? await switchPermanentFancyNumber(
            selectedRecommendation.id,
            { expectedUnitPrice },
            options,
          )
        : await switchPermanentToCustomFancyNumber(
            {
              value: customValue,
              expectedUnitPrice,
            },
            options,
          );
      if (
        selectedRecommendation?.id &&
        result.accountId !== selectedRecommendation.value
      ) {
        throw new Error(
          t('common.errors.invalidServerResponse', {
            defaultValue: '服务返回了无效数据',
          }),
        );
      }
      await finishPurchase(
        owner,
        result,
        walletVersion,
        generation,
        operation,
        { signature, key: idempotencyKey },
        'switch',
        previousAccountId,
      );
    } catch (error) {
      if (
        generation !== focusGenerationRef.current ||
        !isLatestFancyNumberOperation(operation) ||
        !isAuthSessionIdentityCurrent(owner, useAuthStore.getState())
      )
        return;
      Alert.alert(
        t('common.errorOccurred', { defaultValue: '操作失败' }),
        getApiErrorMessage(
          error,
          t('profile.fancyNumber.switchError', {
            defaultValue: '更换失败，请稍后重试',
          }),
        ),
      );
      await Promise.allSettled([
        loadInitial(generation, owner),
        refreshAuthUser(owner, operation),
      ]);
    } finally {
      purchaseInFlightRef.current = false;
      if (
        focusedRef.current &&
        isAuthSessionIdentityCurrent(owner, useAuthStore.getState())
      ) {
        setSubmitting(false);
      }
    }
  }, [
    availability.status,
    catalog?.unitPrice,
    customValue,
    finishPurchase,
    intentKey,
    leaseStatus,
    loadInitial,
    mine,
    refreshAuthUser,
    selectedRecommendation,
    submitting,
    t,
  ]);

  const confirmSwitch = useCallback(() => {
    if (
      !mine?.permanent ||
      leaseStatus !== 'ready' ||
      availability.status !== 'available' ||
      !CUSTOM_VALUE_PATTERN.test(customValue)
    ) {
      return;
    }
    Alert.alert(
      t('profile.fancyNumber.confirmSwitchTitle', {
        defaultValue: '确认更换靓号',
      }),
      t('profile.fancyNumber.confirmSwitch', {
        defaultValue:
          '确认使用 {{points}} 积分将 {{current}} 更换为 {{accountId}}？永久权益会保留，原靓号将重新开放。',
        points: catalog?.unitPrice ?? mine.unitPrice,
        current: mine.accountId,
        accountId: customValue,
      }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('common.confirm', { defaultValue: '确认' }),
          onPress: () => void performSwitch(),
        },
      ],
    );
  }, [
    availability.status,
    catalog?.unitPrice,
    customValue,
    leaseStatus,
    mine,
    performSwitch,
    t,
  ]);

  const loadMore = useCallback(async () => {
    const cursor = catalog?.nextCursor;
    if (!cursor || loadingMore || catalogCursorRef.current !== cursor) return;
    const generation = focusGenerationRef.current;
    setLoadingMore(true);
    try {
      const next = await fetchFancyNumbers({
        cursor,
        limit: PAGE_SIZE,
      });
      if (
        focusGenerationRef.current !== generation ||
        catalogCursorRef.current !== cursor
      ) {
        return;
      }
      if (!catalog || !hasMatchingFancyNumberCatalogQuote(catalog, next)) {
        catalogCursorRef.current = null;
        await loadInitial(generation);
        return;
      }
      const suggestions = next.items
        .filter((item) => CUSTOM_VALUE_PATTERN.test(item.value.toUpperCase()))
        .map((item) => ({ ...item, value: item.value.toUpperCase() }));
      if (
        hasConflictingFancyNumberRecommendations(itemsRef.current, suggestions)
      ) {
        catalogCursorRef.current = null;
        await loadInitial(generation);
        return;
      }
      setItems((current) => [
        ...current,
        ...suggestions.filter(
          (item) => !current.some((existing) => existing.id === item.id),
        ),
      ]);
      catalogCursorRef.current = next.nextCursor;
      setCatalog((current) =>
        current ? { ...current, nextCursor: next.nextCursor } : next,
      );
    } catch (error) {
      if (
        focusGenerationRef.current !== generation ||
        catalogCursorRef.current !== cursor
      ) {
        return;
      }
      Alert.alert(
        t('common.errorOccurred', { defaultValue: '操作失败' }),
        getApiErrorMessage(
          error,
          t('profile.fancyNumber.loadMoreError', {
            defaultValue: '加载更多靓号失败，请稍后重试',
          }),
        ),
      );
    } finally {
      if (focusGenerationRef.current === generation) {
        setLoadingMore(false);
      }
    }
  }, [catalog, loadInitial, loadingMore, t]);

  const handleCustomValueChange = useCallback(
    (value: string) => {
      updateSelectedRecommendation(null);
      setCustomValue(
        value
          .replace(/[^a-zA-Z0-9]/g, '')
          .slice(0, 6)
          .toUpperCase(),
      );
    },
    [updateSelectedRecommendation],
  );

  const permanentLabel = t('profile.fancyNumber.permanent', {
    defaultValue: '永久',
  });
  const monthOptions = useMemo(() => {
    const min = catalog?.minMonths ?? 1;
    const max = catalog?.maxMonths ?? 12;
    return Array.from({ length: max - min + 1 }, (_, index) => min + index);
  }, [catalog?.maxMonths, catalog?.minMonths]);
  const purchaseTotal = months * (catalog?.unitPrice ?? mine?.unitPrice ?? 100);
  const renewalTotal = months * (mine?.unitPrice ?? 100);
  const switchPrice = catalog?.unitPrice ?? mine?.unitPrice ?? 100;
  const isSwitching = Boolean(
    leaseStatus === 'ready' && mine?.active && mine.permanent,
  );
  const disabled = submitting || isOffline;
  const canSubmit =
    !disabled &&
    leaseStatus === 'ready' &&
    availability.status === 'available' &&
    CUSTOM_VALUE_PATTERN.test(customValue);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
      },
      content: { paddingBottom: insets.bottom + Spacing.xl },
      hero: { backgroundColor: colors.deepPurple },
      heroOrb: { backgroundColor: 'rgba(255,255,255,0.18)' },
      heroTitle: { ...Typography.h1, color: colors.white },
      heroText: { ...Typography.bodyRegular, color: 'rgba(255,255,255,0.85)' },
      card: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      title: { ...Typography.h3, color: colors.text },
      body: { ...Typography.bodyRegular, color: colors.textSecondary },
      number: { color: colors.text },
      badge: { backgroundColor: colors.primaryLight },
      badgeText: { ...Typography.caption, color: colors.primary },
      selectedMonth: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
      },
      normalMonth: {
        backgroundColor: colors.background,
        borderColor: colors.surfaceBorder,
      },
      selectedNumber: {
        backgroundColor: colors.primaryLight,
        borderColor: colors.primary,
      },
      normalNumber: {
        backgroundColor: colors.background,
        borderColor: colors.surfaceBorder,
      },
      input: {
        backgroundColor: colors.background,
        borderColor:
          availability.status === 'available'
            ? colors.success
            : availability.status === 'unavailable' ||
                availability.status === 'error'
              ? colors.error
              : colors.surfaceBorder,
        color: colors.text,
      },
      success: { ...Typography.bodyRegular, color: colors.success },
      availabilityHint: {
        ...Typography.bodyRegular,
        color:
          availability.status === 'unavailable' ||
          availability.status === 'error'
            ? colors.error
            : colors.textSecondary,
      },
      button: { backgroundColor: colors.primaryDeep },
      buttonText: { ...Typography.body, color: colors.white },
      error: { ...Typography.bodyRegular, color: colors.error },
      link: { ...Typography.body, color: colors.primary },
    }),
    [availability.status, colors, insets.bottom, insets.top],
  );

  return (
    <View style={d.container}>
      <NavHeader
        title={
          mode === 'renew' && !mine?.permanent
            ? t('profile.fancyNumber.renewTitle', { defaultValue: '续费靓号' })
            : t('profile.fancyNumber.title', { defaultValue: '靓号专区' })
        }
        rightIcon="sparkles-outline"
      />
      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator color={colors.primary} />
          <Text style={d.body}>
            {t('common.loading', { defaultValue: '加载中…' })}
          </Text>
        </View>
      ) : errorText && !catalog && !mine ? (
        <View style={[s.centered, { paddingHorizontal: Spacing.lg }]}>
          <Text style={d.error}>{errorText}</Text>
          <Pressable
            style={s.secondaryButton}
            onPress={() => void loadInitial()}
          >
            <Text style={d.link}>
              {t('common.retry', { defaultValue: '重试' })}
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.content, d.content]}
          showsVerticalScrollIndicator={false}
        >
          {isOffline ? (
            <Text style={d.error}>
              {t('common.offline', {
                defaultValue: '当前无网络连接，部分功能可能不可用',
              })}
            </Text>
          ) : null}
          {errorText ? (
            <View>
              <Text style={d.error}>{errorText}</Text>
              <Pressable
                style={s.secondaryButton}
                onPress={() => void loadInitial()}
              >
                <Text style={d.link}>
                  {t('common.retry', { defaultValue: '重试' })}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View style={[s.hero, d.hero]}>
            <View style={[s.heroOrb, d.heroOrb]} />
            <Text style={d.heroTitle}>
              {isSwitching
                ? t('profile.fancyNumber.switchOffer', {
                    defaultValue: '永久靓号 · 更换 100 积分',
                  })
                : catalog?.purchaseMode === 'PERMANENT_FREE'
                  ? t('profile.fancyNumber.superOffer', {
                      defaultValue: '超级会员 · 永久靓号',
                    })
                  : t('profile.fancyNumber.monthlyOffer', {
                      defaultValue: '100 积分 / 月',
                    })}
            </Text>
            <Text style={d.heroText}>
              {isSwitching
                ? t('profile.fancyNumber.switchHint', {
                    defaultValue: '永久权益保留，每次更换仅收取 100 积分',
                  })
                : catalog?.purchaseMode === 'PERMANENT_FREE'
                  ? t('profile.fancyNumber.superHint', {
                      defaultValue: '超级会员可免费领取一个永久靓号',
                    })
                  : t('profile.fancyNumber.monthlyHint', {
                      defaultValue: '按月购买，单次可选择 1–12 个月',
                    })}
            </Text>
          </View>

          {leaseStatus === 'ready' && mine?.active ? (
            <View style={[s.card, d.card]}>
              <View style={s.titleRow}>
                <Ionicons name="ribbon" size={22} color={colors.deepPurple} />
                <Text style={d.title}>
                  {t('profile.fancyNumber.mine', { defaultValue: '我的靓号' })}
                </Text>
              </View>
              <View style={s.statusRow}>
                <Text style={[s.numberValue, d.number]}>{mine.accountId}</Text>
                <View style={[s.badge, d.badge]}>
                  <Text style={d.badgeText}>
                    {mine.permanent
                      ? permanentLabel
                      : t('profile.fancyNumber.active', {
                          defaultValue: '使用中',
                        })}
                  </Text>
                </View>
              </View>
              <Text style={d.body}>
                {mine.permanent
                  ? t('profile.fancyNumber.permanentDescription', {
                      defaultValue: '该靓号永久有效；可支付 100 积分更换',
                    })
                  : t('profile.fancyNumber.expiresAt', {
                      defaultValue: '到期时间：{{date}}',
                      date: formatExpiry(mine.expiresAt, permanentLabel),
                    })}
              </Text>
            </View>
          ) : leaseStatus === 'ready' && mode === 'renew' ? (
            <View style={[s.card, d.card]}>
              <Text style={d.body}>
                {t('profile.fancyNumber.nothingToRenew', {
                  defaultValue:
                    '当前没有可续费的靓号，可在下方选择一个靓号购买。',
                })}
              </Text>
            </View>
          ) : null}

          {leaseStatus === 'ready' && mine?.active && mine.renewable ? (
            <View style={[s.card, d.card]}>
              <Text style={d.title}>
                {t('profile.fancyNumber.renewMonths', {
                  defaultValue: '选择续费时长',
                })}
              </Text>
              <View style={s.monthGrid}>
                {monthOptions.map((value) => {
                  const selected = months === value;
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[
                        s.monthButton,
                        selected ? d.selectedMonth : d.normalMonth,
                      ]}
                      onPress={() => setMonths(value)}
                    >
                      <Text
                        style={[
                          Typography.caption,
                          { color: selected ? colors.white : colors.text },
                        ]}
                      >
                        {t('profile.fancyNumber.monthCount', {
                          defaultValue: '{{count}}个月',
                          count: value,
                        })}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={d.body}>
                {t('profile.fancyNumber.total', {
                  defaultValue: '合计：{{points}} 积分',
                  points: renewalTotal,
                })}
              </Text>
              <Pressable
                accessibilityRole="button"
                style={[
                  s.primaryButton,
                  d.button,
                  disabled ? s.disabled : null,
                ]}
                disabled={disabled}
                onPress={confirmRenewal}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={d.buttonText}>
                    {t('profile.fancyNumber.renewNow', {
                      defaultValue: '立即续费',
                    })}
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}

          {leaseStatus === 'ready' && (!mine?.active || isSwitching) ? (
            <>
              {!mine?.active && catalog?.purchaseMode === 'PAID_MONTHLY' ? (
                <View style={[s.card, d.card]}>
                  <Text style={d.title}>
                    {t('profile.fancyNumber.chooseMonths', {
                      defaultValue: '选择购买时长',
                    })}
                  </Text>
                  <View style={s.monthGrid}>
                    {monthOptions.map((value) => {
                      const selected = months === value;
                      return (
                        <Pressable
                          key={value}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          style={[
                            s.monthButton,
                            selected ? d.selectedMonth : d.normalMonth,
                          ]}
                          onPress={() => setMonths(value)}
                        >
                          <Text
                            style={[
                              Typography.caption,
                              { color: selected ? colors.white : colors.text },
                            ]}
                          >
                            {t('profile.fancyNumber.monthCount', {
                              defaultValue: '{{count}}个月',
                              count: value,
                            })}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <View style={[s.card, d.card]}>
                <Text style={d.title}>
                  {isSwitching
                    ? t('profile.fancyNumber.chooseReplacement', {
                        defaultValue: '输入新靓号',
                      })
                    : t('profile.fancyNumber.chooseNumber', {
                        defaultValue: '输入自定义靓号',
                      })}
                </Text>
                <Text style={d.body}>
                  {t('profile.fancyNumber.customHint', {
                    defaultValue: '输入 6 位英文字母或数字，字母将自动转为大写',
                  })}
                </Text>
                <TextInput
                  accessibilityLabel={t(
                    'profile.fancyNumber.customInputLabel',
                    {
                      defaultValue: '自定义靓号',
                    },
                  )}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={6}
                  placeholder="ABC123"
                  placeholderTextColor={colors.textSecondary}
                  style={[s.customInput, d.input]}
                  value={customValue}
                  onChangeText={handleCustomValueChange}
                />
                {availability.status === 'checking' ? (
                  <View style={s.titleRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={d.availabilityHint}>
                      {t('profile.fancyNumber.checking', {
                        defaultValue: '正在查询是否可用…',
                      })}
                    </Text>
                  </View>
                ) : availability.status === 'available' ? (
                  <Text style={d.success}>
                    {t('profile.fancyNumber.available', {
                      defaultValue: '该靓号可以使用',
                    })}
                  </Text>
                ) : availability.status === 'unavailable' ? (
                  <Text style={d.availabilityHint}>
                    {availability.reason === 'RESERVED'
                      ? t('profile.fancyNumber.reserved', {
                          defaultValue: '该组合属于保留词，不能使用',
                        })
                      : t('profile.fancyNumber.taken', {
                          defaultValue: '该靓号已被占用，请换一个',
                        })}
                  </Text>
                ) : availability.status === 'error' ? (
                  <Text style={d.availabilityHint}>{availability.message}</Text>
                ) : (
                  <Text style={d.availabilityHint}>
                    {availability.status === 'invalid'
                      ? t('profile.fancyNumber.sixCharactersRequired', {
                          defaultValue: '请输入完整的 6 位靓号',
                        })
                      : t('profile.fancyNumber.enterToCheck', {
                          defaultValue: '输入后将自动查询是否可用',
                        })}
                  </Text>
                )}

                <Text style={d.title}>
                  {t('profile.fancyNumber.recommendations', {
                    defaultValue: '热门推荐',
                  })}
                </Text>
                {items.length > 0 ? (
                  <View style={s.numberGrid}>
                    {items.map((item) => {
                      const selected = item.id === selectedRecommendation?.id;
                      return (
                        <Pressable
                          key={item.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          style={[
                            s.numberButton,
                            selected ? d.selectedNumber : d.normalNumber,
                          ]}
                          onPress={() => {
                            updateSelectedRecommendation(item);
                            setCustomValue(item.value);
                          }}
                        >
                          <Text
                            numberOfLines={1}
                            style={[
                              Typography.h3,
                              {
                                color: selected ? colors.primary : colors.text,
                              },
                            ]}
                          >
                            {item.value}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={d.body}>
                    {t('profile.fancyNumber.noRecommendations', {
                      defaultValue: '暂无推荐号码，可直接输入喜欢的组合',
                    })}
                  </Text>
                )}
                {catalog?.nextCursor ? (
                  <Pressable
                    style={s.secondaryButton}
                    disabled={loadingMore}
                    onPress={() => void loadMore()}
                  >
                    {loadingMore ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <Text style={d.link}>
                        {t('profile.fancyNumber.loadMore', {
                          defaultValue: '加载更多',
                        })}
                      </Text>
                    )}
                  </Pressable>
                ) : null}
                <Text style={d.body}>
                  {isSwitching
                    ? t('profile.fancyNumber.switchTotal', {
                        defaultValue: '更换费用：{{points}} 积分',
                        points: switchPrice,
                      })
                    : catalog?.purchaseMode === 'PERMANENT_FREE'
                      ? t('profile.fancyNumber.freeTotal', {
                          defaultValue: '超级会员专享：0 积分永久领取',
                        })
                      : t('profile.fancyNumber.total', {
                          defaultValue: '合计：{{points}} 积分',
                          points: purchaseTotal,
                        })}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  style={[
                    s.primaryButton,
                    d.button,
                    !canSubmit ? s.disabled : null,
                  ]}
                  disabled={!canSubmit}
                  onPress={isSwitching ? confirmSwitch : confirmPurchase}
                >
                  {submitting ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text style={d.buttonText}>
                      {isSwitching
                        ? t('profile.fancyNumber.switchNow', {
                            defaultValue: '更换靓号',
                          })
                        : catalog?.purchaseMode === 'PERMANENT_FREE'
                          ? t('profile.fancyNumber.claimNow', {
                              defaultValue: '免费领取',
                            })
                          : t('profile.fancyNumber.buyNow', {
                              defaultValue: '立即购买',
                            })}
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
