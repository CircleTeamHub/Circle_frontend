import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { useNetworkStatus } from '@/hooks/use-network-status';
import { fetchMyCircles } from '@/services/api/circles';
import { fetchWallet } from '@/services/api/coin';
import { getApiErrorMessage } from '@/services/api/errors';
import {
  fetchGroupExpansionProducts,
  purchaseGroupExpansion,
  type GroupExpansionProduct,
  type GroupExpansionProductsResult,
} from '@/services/api/group-expansion';
import { GroupExpansionCirclePickerSheet } from '@/features/profile/components/group-expansion-circle-picker-sheet';
import {
  captureAuthSessionIdentity,
  isAuthSessionIdentityCurrent,
  type AuthSessionIdentity,
} from '@/stores/auth-session-identity';
import { useAuthStore } from '@/stores/authStore';
import { useWalletRealtimeStore } from '@/stores/walletRealtimeStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { MyCircle } from '@/types';
import { generateIdempotencyKey } from '@/utils/idempotency-key';

const PRODUCT_COLORS = ['#3B82F6', '#8B5CF6', '#F97316', '#EC4899'];

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.lg,
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
    right: -50,
    bottom: -105,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  selectedCircleRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  circleRowIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleRowText: {
    flex: 1,
    gap: Spacing.xs,
  },
  changeCircle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  summaryItem: {
    flex: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  productList: {
    gap: Spacing.md,
  },
  productCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  productTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  productIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productText: {
    flex: 1,
    gap: Spacing.xs,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.xs,
  },
  buyButton: {
    minHeight: 46,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  centered: {
    paddingVertical: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  retryButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  disabled: {
    opacity: 0.5,
  },
});

export default function GroupExpansionScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isOffline } = useNetworkStatus();
  const walletBalance = useWalletRealtimeStore((state) => state.balance);
  const [circles, setCircles] = useState<MyCircle[]>([]);
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null);
  const [circlePickerVisible, setCirclePickerVisible] = useState(false);
  const [catalog, setCatalog] = useState<GroupExpansionProductsResult | null>(
    null,
  );
  const [circlesLoading, setCirclesLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [circlesError, setCirclesError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [submittingProductId, setSubmittingProductId] = useState<string | null>(
    null,
  );
  const focusGenerationRef = useRef(0);
  const catalogRequestRef = useRef(0);
  const selectedCircleIdRef = useRef<string | null>(null);
  const pendingIntentRef = useRef<{ signature: string; key: string } | null>(
    null,
  );

  const loadProducts = useCallback(
    async (
      circleId: string,
      generation = focusGenerationRef.current,
      owner?: AuthSessionIdentity,
    ) => {
      if (
        owner &&
        !isAuthSessionIdentityCurrent(owner, useAuthStore.getState())
      )
        return;
      const request = catalogRequestRef.current + 1;
      catalogRequestRef.current = request;
      const canCommit = () =>
        generation === focusGenerationRef.current &&
        request === catalogRequestRef.current &&
        (!owner ||
          isAuthSessionIdentityCurrent(owner, useAuthStore.getState()));
      if (!canCommit()) return;
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        const result = await fetchGroupExpansionProducts(circleId);
        if (!canCommit() || selectedCircleIdRef.current !== circleId) {
          return;
        }
        setCatalog(result);
      } catch (error) {
        if (!canCommit()) {
          return;
        }
        setCatalog(null);
        setCatalogError(
          getApiErrorMessage(
            error,
            t('profile.groupExpansion.loadProductsError', {
              defaultValue: '扩容档位加载失败，请稍后重试',
            }),
          ),
        );
      } finally {
        if (canCommit()) {
          setCatalogLoading(false);
        }
      }
    },
    [t],
  );

  const loadOwnerCircles = useCallback(
    async (generation = focusGenerationRef.current) => {
      setCirclesLoading(true);
      setCirclesError(null);
      try {
        const nextCircles = await fetchMyCircles('created');
        if (generation !== focusGenerationRef.current) return;
        setCircles(nextCircles);

        const current = selectedCircleIdRef.current;
        const nextSelectedId =
          (current && nextCircles.some((circle) => circle.id === current)
            ? current
            : nextCircles[0]?.id) ?? null;
        selectedCircleIdRef.current = nextSelectedId;
        setSelectedCircleId(nextSelectedId);
        pendingIntentRef.current = null;

        if (nextSelectedId) {
          await loadProducts(nextSelectedId, generation);
        } else {
          setCatalog(null);
          setCatalogError(null);
        }
      } catch (error) {
        if (generation !== focusGenerationRef.current) return;
        setCircles([]);
        setCatalog(null);
        setCirclesError(
          getApiErrorMessage(
            error,
            t('profile.groupExpansion.loadCirclesError', {
              defaultValue: '群列表加载失败，请稍后重试',
            }),
          ),
        );
      } finally {
        if (generation === focusGenerationRef.current) {
          setCirclesLoading(false);
        }
      }
    },
    [loadProducts, t],
  );

  const loadWallet = useCallback(
    async (generation: number, owner: AuthSessionIdentity) => {
      const walletVersion = useWalletRealtimeStore.getState().version;
      const canCommit = () =>
        generation === focusGenerationRef.current &&
        isAuthSessionIdentityCurrent(owner, useAuthStore.getState());
      if (!canCommit()) return;
      setWalletLoading(true);
      setWalletError(null);
      try {
        const wallet = await fetchWallet();
        if (!canCommit()) return;
        if (wallet.userID !== owner.userId) {
          throw new Error(
            t('common.errors.invalidServerResponse', {
              defaultValue: '服务返回了无效数据',
            }),
          );
        }
        useWalletRealtimeStore
          .getState()
          .setRealtimeBalanceIfVersion(walletVersion, wallet.balance);
      } catch (error) {
        if (!canCommit()) return;
        setWalletError(
          getApiErrorMessage(
            error,
            t('profile.groupExpansion.loadWalletError', {
              defaultValue: '积分余额加载失败，请稍后重试',
            }),
          ),
        );
      } finally {
        if (generation === focusGenerationRef.current) {
          setWalletLoading(false);
        }
      }
    },
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      const generation = focusGenerationRef.current + 1;
      focusGenerationRef.current = generation;
      const owner = captureAuthSessionIdentity(useAuthStore.getState());
      void loadOwnerCircles(generation);
      if (owner) void loadWallet(generation, owner);
      return () => {
        focusGenerationRef.current += 1;
        catalogRequestRef.current += 1;
      };
    }, [loadOwnerCircles, loadWallet]),
  );

  const selectCircle = useCallback(
    (circleId: string) => {
      if (
        submittingProductId !== null ||
        circleId === selectedCircleIdRef.current
      ) {
        return;
      }
      selectedCircleIdRef.current = circleId;
      setSelectedCircleId(circleId);
      setCatalog(null);
      pendingIntentRef.current = null;
      void loadProducts(circleId);
    },
    [loadProducts, submittingProductId],
  );

  const getIntentKey = useCallback((signature: string): string => {
    if (pendingIntentRef.current?.signature === signature) {
      return pendingIntentRef.current.key;
    }
    const key = generateIdempotencyKey();
    pendingIntentRef.current = { signature, key };
    return key;
  }, []);

  const performPurchase = useCallback(
    async (product: GroupExpansionProduct) => {
      const circleId = selectedCircleIdRef.current;
      if (
        !circleId ||
        !product.purchasable ||
        submittingProductId ||
        isOffline
      ) {
        return;
      }

      const signature = `${circleId}:${product.id}:${product.price}:${product.seats}`;
      const owner = captureAuthSessionIdentity(useAuthStore.getState());
      if (!owner) return;
      const walletVersion = useWalletRealtimeStore.getState().version;
      setSubmittingProductId(product.id);
      try {
        const result = await purchaseGroupExpansion(
          circleId,
          product.id,
          { price: product.price, seats: product.seats },
          {
            idempotencyKey: getIntentKey(signature),
          },
        );
        if (!isAuthSessionIdentityCurrent(owner, useAuthStore.getState()))
          return;
        pendingIntentRef.current = null;
        useWalletRealtimeStore
          .getState()
          .setRealtimeBalanceIfVersion(
            walletVersion,
            result.walletBalanceAfter,
          );
        await loadProducts(circleId, focusGenerationRef.current, owner);
        if (!isAuthSessionIdentityCurrent(owner, useAuthStore.getState()))
          return;
        Alert.alert(
          t('profile.groupExpansion.successTitle', {
            defaultValue: '扩容成功',
          }),
          t('profile.groupExpansion.successMessage', {
            defaultValue:
              '已增加 {{seats}} 个群名额，当前上限为 {{limit}} 人，剩余积分 {{balance}}。',
            seats: result.seats,
            limit: result.newMaxMembers,
            balance: result.walletBalanceAfter,
          }),
        );
      } catch (error) {
        if (!isAuthSessionIdentityCurrent(owner, useAuthStore.getState()))
          return;
        Alert.alert(
          t('common.errorOccurred', { defaultValue: '操作失败' }),
          getApiErrorMessage(
            error,
            t('profile.groupExpansion.purchaseError', {
              defaultValue: '购买失败，请稍后重试',
            }),
          ),
        );
        void loadProducts(circleId, focusGenerationRef.current, owner);
      } finally {
        setSubmittingProductId(null);
      }
    },
    [getIntentKey, isOffline, loadProducts, submittingProductId, t],
  );

  const confirmPurchase = useCallback(
    (product: GroupExpansionProduct) => {
      const circle = circles.find(
        (item) => item.id === selectedCircleIdRef.current,
      );
      if (!circle || !product.purchasable || isOffline) return;
      Alert.alert(
        t('profile.groupExpansion.confirmTitle', {
          defaultValue: '确认购买扩容卡',
        }),
        t('profile.groupExpansion.confirmMessage', {
          defaultValue:
            '为“{{circle}}”增加 {{seats}} 个名额，将扣除 {{price}} 积分。扩容永久有效，确认购买吗？',
          circle: circle.name,
          seats: product.seats,
          price: product.price,
        }),
        [
          {
            text: t('common.cancel', { defaultValue: '取消' }),
            style: 'cancel',
          },
          {
            text: t('common.confirm', { defaultValue: '确认' }),
            onPress: () => {
              void performPurchase(product);
            },
          },
        ],
      );
    },
    [circles, isOffline, performPurchase, t],
  );

  const selectedCircle = circles.find(
    (circle) => circle.id === selectedCircleId,
  );

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
      surface: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      hero: {
        backgroundColor: colors.primaryDeep,
      },
      heroOrb: {
        backgroundColor: colors.primary,
      },
      text: {
        color: colors.text,
      },
      secondaryText: {
        color: colors.textSecondary,
      },
      whiteText: {
        color: colors.white,
      },
      selectedCircleRow: {
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.background,
      },
      summaryItem: {
        backgroundColor: colors.background,
      },
      buyButton: {
        backgroundColor: colors.primary,
      },
      errorText: {
        color: colors.error,
      },
    }),
    [colors, insets.bottom, insets.top],
  );

  return (
    <View style={d.container}>
      <NavHeader
        title={t('profile.groupExpansion.title', {
          defaultValue: '群扩容卡',
        })}
        fallbackHref="/(tabs)/profile/mall"
      />
      <ScrollView contentContainerStyle={[s.content, d.content]}>
        <View style={[s.hero, d.hero]}>
          <View style={[s.heroOrb, d.heroOrb]} />
          <View style={s.titleRow}>
            <Ionicons name="people" size={26} color={colors.white} />
            <Text style={[Typography.h2, d.whiteText]}>
              {t('profile.groupExpansion.heroTitle', {
                defaultValue: '永久扩充群人数上限',
              })}
            </Text>
          </View>
          <Text style={[Typography.bodyRegular, d.whiteText]}>
            {t('profile.groupExpansion.heroSubtitle', {
              defaultValue: '使用积分购买，名额立即生效，可多次叠加。',
            })}
          </Text>
          {walletBalance !== null ? (
            <Text style={[Typography.caption, d.whiteText]}>
              {t('profile.groupExpansion.walletBalance', {
                defaultValue: '当前积分：{{balance}}',
                balance: walletBalance,
              })}
            </Text>
          ) : walletLoading ? (
            <Text style={[Typography.caption, d.whiteText]}>
              {t('profile.groupExpansion.walletLoading', {
                defaultValue: '积分余额加载中…',
              })}
            </Text>
          ) : null}
        </View>

        {walletError ? (
          <View>
            <Text style={[Typography.caption, d.errorText]}>
              {walletError}
            </Text>
            <Pressable
              style={s.retryButton}
              accessibilityRole="button"
              onPress={() => {
                const owner = captureAuthSessionIdentity(
                  useAuthStore.getState(),
                );
                if (owner) {
                  void loadWallet(focusGenerationRef.current, owner);
                }
              }}
            >
              <Text style={[Typography.body, { color: colors.primary }]}>
                {t('common.retry', { defaultValue: '重试' })}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {isOffline ? (
          <Text style={[Typography.caption, d.errorText]}>
            {t('common.offline', {
              defaultValue: '当前无网络连接，暂时无法购买',
            })}
          </Text>
        ) : null}

        <View style={[s.card, d.surface]}>
          <View style={s.titleRow}>
            <Ionicons name="albums-outline" size={20} color={colors.primary} />
            <Text style={[Typography.h3, d.text]}>
              {t('profile.groupExpansion.chooseCircle', {
                defaultValue: '选择要扩容的群',
              })}
            </Text>
          </View>

          {circlesLoading ? (
            <View style={s.centered}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : circlesError ? (
            <View style={s.centered}>
              <Text style={[Typography.bodyRegular, d.errorText]}>
                {circlesError}
              </Text>
              <Pressable
                style={s.retryButton}
                onPress={() => void loadOwnerCircles()}
                accessibilityRole="button"
              >
                <Text style={[Typography.body, { color: colors.primary }]}>
                  {t('common.retry', { defaultValue: '重试' })}
                </Text>
              </Pressable>
            </View>
          ) : circles.length === 0 ? (
            <View style={s.centered}>
              <Ionicons
                name="people-outline"
                size={40}
                color={colors.textSecondary}
              />
              <Text style={[Typography.bodyRegular, d.secondaryText]}>
                {t('profile.groupExpansion.noOwnedCircles', {
                  defaultValue: '你还没有自己创建的群，暂时无法购买扩容卡。',
                })}
              </Text>
            </View>
          ) : selectedCircle ? (
            <Pressable
              onPress={() => setCirclePickerVisible(true)}
              disabled={submittingProductId !== null}
              style={[
                s.selectedCircleRow,
                d.selectedCircleRow,
                submittingProductId !== null && s.disabled,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: submittingProductId !== null }}
            >
              <View
                style={[
                  s.circleRowIcon,
                  { backgroundColor: colors.primaryLight },
                ]}
              >
                <Ionicons
                  name="people-outline"
                  size={22}
                  color={colors.primary}
                />
              </View>
              <View style={s.circleRowText}>
                <Text style={[Typography.body, d.text]} numberOfLines={1}>
                  {selectedCircle.name}
                </Text>
                <Text style={[Typography.small, d.secondaryText]}>
                  {t('profile.groupExpansion.members', {
                    defaultValue: '当前人数',
                  })}
                  ：
                  <Text style={{ fontVariant: ['tabular-nums'] }}>
                    {selectedCircle.memberCount}
                  </Text>
                </Text>
              </View>
              <View style={s.changeCircle}>
                <Text style={[Typography.small, { color: colors.primary }]}>
                  {t('profile.groupExpansion.changeCircle', {
                    defaultValue: '更换群',
                  })}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.primary}
                />
              </View>
            </Pressable>
          ) : null}
        </View>

        {selectedCircle ? (
          <View style={[s.card, d.surface]}>
            <Text style={[Typography.h3, d.text]} numberOfLines={1}>
              {selectedCircle.name}
            </Text>
            {catalog ? (
              <View style={s.summaryRow}>
                <View style={[s.summaryItem, d.summaryItem]}>
                  <Text style={[Typography.small, d.secondaryText]}>
                    {t('profile.groupExpansion.members', {
                      defaultValue: '当前人数',
                    })}
                  </Text>
                  <Text style={[Typography.h3, d.text]}>
                    {catalog.memberCount}
                  </Text>
                </View>
                <View style={[s.summaryItem, d.summaryItem]}>
                  <Text style={[Typography.small, d.secondaryText]}>
                    {t('profile.groupExpansion.currentLimit', {
                      defaultValue: '当前上限',
                    })}
                  </Text>
                  <Text style={[Typography.h3, d.text]}>
                    {catalog.currentMaxMembers}
                  </Text>
                </View>
                <View style={[s.summaryItem, d.summaryItem]}>
                  <Text style={[Typography.small, d.secondaryText]}>
                    {t('profile.groupExpansion.expandedSeats', {
                      defaultValue: '已扩名额',
                    })}
                  </Text>
                  <Text style={[Typography.h3, d.text]}>
                    +{catalog.expansionSeats}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {selectedCircleId ? (
          <View style={[s.card, d.surface]}>
            <View style={s.titleRow}>
              <Ionicons name="card-outline" size={20} color={colors.primary} />
              <Text style={[Typography.h3, d.text]}>
                {t('profile.groupExpansion.chooseProduct', {
                  defaultValue: '选择扩容档位',
                })}
              </Text>
            </View>

            {catalogLoading ? (
              <View style={s.centered}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : catalogError ? (
              <View style={s.centered}>
                <Text style={[Typography.bodyRegular, d.errorText]}>
                  {catalogError}
                </Text>
                <Pressable
                  style={s.retryButton}
                  onPress={() => void loadProducts(selectedCircleId)}
                  accessibilityRole="button"
                >
                  <Text style={[Typography.body, { color: colors.primary }]}>
                    {t('common.retry', { defaultValue: '重试' })}
                  </Text>
                </Pressable>
              </View>
            ) : catalog ? (
              <View style={s.productList}>
                {catalog.products.map((product, index) => {
                  const productColor =
                    PRODUCT_COLORS[index % PRODUCT_COLORS.length];
                  const submitting = submittingProductId === product.id;
                  const disabled =
                    !product.purchasable ||
                    isOffline ||
                    submittingProductId !== null;
                  return (
                    <View key={product.id} style={[s.productCard, d.surface]}>
                      <View style={s.productTop}>
                        <View
                          style={[
                            s.productIcon,
                            { backgroundColor: `${productColor}22` },
                          ]}
                        >
                          <Ionicons
                            name="people-circle-outline"
                            size={30}
                            color={productColor}
                          />
                        </View>
                        <View style={s.productText}>
                          <Text style={[Typography.h3, d.text]}>
                            {product.name}
                          </Text>
                          <Text style={[Typography.caption, d.secondaryText]}>
                            {t('profile.groupExpansion.seatDescription', {
                              defaultValue:
                                '增加 {{seats}} 人 · 购买后上限 {{limit}} 人',
                              seats: product.seats,
                              limit: product.resultingMaxMembers,
                            })}
                          </Text>
                        </View>
                        <View style={s.priceRow}>
                          <Text
                            style={[Typography.h2, { color: productColor }]}
                          >
                            {product.price}
                          </Text>
                          <Text style={[Typography.small, d.secondaryText]}>
                            {t('profile.groupExpansion.points', {
                              defaultValue: '积分',
                            })}
                          </Text>
                        </View>
                      </View>
                      <Pressable
                        style={[
                          s.buyButton,
                          d.buyButton,
                          disabled && s.disabled,
                        ]}
                        onPress={() => confirmPurchase(product)}
                        disabled={disabled}
                        accessibilityRole="button"
                        accessibilityState={{ disabled }}
                      >
                        {submitting ? (
                          <ActivityIndicator color={colors.white} />
                        ) : (
                          <Text style={[Typography.body, d.whiteText]}>
                            {product.purchasable
                              ? t('profile.groupExpansion.buy', {
                                  defaultValue: '立即购买',
                                })
                              : t('profile.groupExpansion.limitReached', {
                                  defaultValue: '超过 3000 人上限',
                                })}
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <GroupExpansionCirclePickerSheet
        visible={circlePickerVisible}
        circles={circles}
        selectedCircleId={selectedCircleId}
        onSelect={selectCircle}
        onClose={() => setCirclePickerVisible(false)}
      />
    </View>
  );
}
