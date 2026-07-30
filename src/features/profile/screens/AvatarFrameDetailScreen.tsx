import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import {
  beginAvatarFrameEquip,
  isLatestAvatarFrameEquip,
} from '@/features/profile/avatar-frame-equip-operation';
import { getAvatarFrameSource } from '@/features/profile/membership-frames';
import {
  equipAvatarFrame,
  fetchAvatarFrameInventory,
} from '@/services/api/avatar-frames';
import { getApiErrorMessage } from '@/services/api/errors';
import {
  captureAuthSessionIdentity,
  isAuthSessionIdentityCurrent,
} from '@/stores/auth-session-identity';
import { useAuthStore } from '@/stores/authStore';
import { useKnownAccountsStore } from '@/stores/knownAccountsStore';
import { reconcileUserAppearance } from '@/stores/userAppearanceStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type {
  AvatarFrameAppearance,
  AvatarFrameInventory,
  AvatarFrameInventoryItem,
  AvatarFrameOwnedSource,
} from '@/types';

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  centered: {
    paddingVertical: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  preview: {
    minHeight: 245,
    borderRadius: Radius.xl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    overflow: 'hidden',
  },
  heading: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  name: {
    ...Typography.h2,
    textAlign: 'center',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  statusText: {
    ...Typography.small,
    fontWeight: '700',
  },
  section: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.body,
    fontWeight: '700',
  },
  body: {
    ...Typography.bodyRegular,
    lineHeight: 21,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  sourceText: {
    flex: 1,
    gap: 2,
  },
  metadata: {
    ...Typography.small,
    lineHeight: 18,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  primaryButtonText: {
    ...Typography.body,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
  retry: {
    minHeight: 44,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

function formatDate(value: string, language: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(language);
}

function sourceLabel(source: AvatarFrameOwnedSource, t: TFunction): string {
  return source.type === 'MEMBERSHIP'
    ? t('profile.avatarFrames.source.membership', {
        level: source.minimumVipLevel,
      })
    : t('profile.avatarFrames.source.admin');
}

function toAppearance(
  item: AvatarFrameInventoryItem | undefined,
): AvatarFrameAppearance | null {
  return item
    ? {
        id: item.id,
        key: item.key,
        name: item.name,
        imageUrl: item.imageUrl,
      }
    : null;
}

export default function AvatarFrameDetailScreen() {
  const routeParams = useLocalSearchParams<{
    id?: string | string[];
    unequipped?: string | string[];
  }>();
  const rawId = routeParams.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const rawUnequipped = routeParams.unequipped;
  const unequipped = Array.isArray(rawUnequipped)
    ? rawUnequipped[0]
    : rawUnequipped;
  const isNone = unequipped === '1';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const user = useAuthStore((state) => state.user);
  const [inventory, setInventory] = useState<AvatarFrameInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const loadGenerationRef = useRef(0);

  const loadInventory = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setLoading(true);
    setLoadError(null);
    try {
      const nextInventory = await fetchAvatarFrameInventory();
      if (
        mountedRef.current &&
        generation === loadGenerationRef.current
      ) {
        setInventory(nextInventory);
      }
    } catch (error) {
      if (
        mountedRef.current &&
        generation === loadGenerationRef.current
      ) {
        setLoadError(
          getApiErrorMessage(
            error,
            t('profile.avatarFrames.loadError'),
          ),
        );
      }
    } finally {
      if (
        mountedRef.current &&
        generation === loadGenerationRef.current
      ) {
        setLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    mountedRef.current = true;
    void loadInventory();
    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
    };
  }, [loadInventory]);

  const item =
    !isNone && id
      ? inventory?.items.find((candidate) => candidate.id === id)
      : null;
  const notFound = Boolean(inventory && !isNone && !item);
  const equipped = inventory
    ? isNone
      ? inventory.equippedFrameId === null
      : inventory.equippedFrameId === item?.id
    : false;
  const frameSource = getAvatarFrameSource(item);
  const actionDisabled = submitting || (isNone && equipped);
  const actionLabel = submitting
    ? t('profile.avatarFrames.saving')
    : isNone && equipped
      ? t('profile.avatarFrames.noneEquipped')
      : isNone || equipped
        ? t('profile.avatarFrames.remove')
        : t('profile.avatarFrames.equip');

  const handleEquip = useCallback(async () => {
    if (
      pendingRef.current ||
      !inventory ||
      notFound ||
      (isNone && equipped)
    ) {
      return;
    }
    const owner = captureAuthSessionIdentity(useAuthStore.getState());
    if (!owner) return;
    const equipOperation = beginAvatarFrameEquip(owner);
    const targetFrameId = isNone || equipped ? null : item?.id ?? null;

    pendingRef.current = true;
    setSubmitting(true);
    setSaveError(null);
    try {
      const nextInventory = await equipAvatarFrame(targetFrameId);
      if (
        !isAuthSessionIdentityCurrent(owner, useAuthStore.getState()) ||
        !isLatestAvatarFrameEquip(equipOperation)
      ) {
        return;
      }
      const nextEquippedItem = nextInventory.items.find(
        (candidate) => candidate.id === nextInventory.equippedFrameId,
      );
      const nextAppearance = toAppearance(nextEquippedItem);

      if (mountedRef.current) {
        setInventory(nextInventory);
      }

      const authState = useAuthStore.getState();
      if (isAuthSessionIdentityCurrent(owner, authState) && authState.user) {
        const nextUser = {
          ...authState.user,
          avatarFrame: nextAppearance?.imageUrl ?? null,
          avatarFrameAppearance: nextAppearance,
        };
        authState.setUser(nextUser);
        reconcileUserAppearance(nextUser.id, {
          vipLevel: nextUser.vipLevel,
          avatarFrame: nextAppearance,
        });
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

      if (
        mountedRef.current &&
        isAuthSessionIdentityCurrent(owner, useAuthStore.getState()) &&
        isLatestAvatarFrameEquip(equipOperation)
      ) {
        router.back();
      }
    } catch (error) {
      if (
        mountedRef.current &&
        isAuthSessionIdentityCurrent(owner, useAuthStore.getState()) &&
        isLatestAvatarFrameEquip(equipOperation)
      ) {
        setSaveError(
          getApiErrorMessage(
            error,
            t('profile.avatarFrames.saveError'),
          ),
        );
      }
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) {
        setSubmitting(false);
      }
    }
  }, [equipped, inventory, isNone, item?.id, notFound, router, t]);

  const themed = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      card: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
    }),
    [colors],
  );

  const displayName = item?.name ?? t('profile.avatarFrames.none');
  const description = item?.description ??
    t('profile.avatarFrames.noneDescription');
  const expiresAt = item?.availableUntil;

  return (
    <View style={[s.container, themed.container]}>
      <View style={{ paddingTop: insets.top }}>
        <NavHeader
          title={t('profile.avatarFrames.detailTitle')}
          fallbackHref="/(tabs)/profile/avatar-frames"
        />
      </View>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          s.content,
          { paddingBottom: Math.max(insets.bottom, Spacing.xl) },
        ]}
      >
        {loading && !inventory ? (
          <View style={s.centered}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : loadError && !inventory ? (
          <View style={s.centered}>
            <Ionicons
              name="cloud-offline-outline"
              size={36}
              color={colors.textSecondary}
            />
            <Text
              selectable
              style={[s.metadata, { color: colors.textSecondary }]}
            >
              {loadError}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void loadInventory()}
              style={[s.retry, { backgroundColor: colors.primary }]}
            >
              <Text style={[s.primaryButtonText, { color: colors.white }]}>
                {t('profile.avatarFrames.retry')}
              </Text>
            </Pressable>
          </View>
        ) : notFound ? (
          <View style={s.centered}>
            <Ionicons
              name="alert-circle-outline"
              size={40}
              color={colors.textSecondary}
            />
            <Text style={[s.name, { color: colors.text }]}>
              {t('profile.avatarFrames.notFound')}
            </Text>
            <Text
              style={[s.metadata, { color: colors.textSecondary }]}
            >
              {t('profile.avatarFrames.notFoundDescription')}
            </Text>
          </View>
        ) : inventory ? (
          <>
            <View style={[s.preview, themed.card]}>
              <Avatar
                size={112}
                name={user?.nickname || user?.accountId}
                uri={user?.avatarUrl ?? undefined}
                bgColor={colors.primaryLight}
                frameSource={frameSource ?? undefined}
              />
            </View>

            <View style={s.heading}>
              <Text style={[s.name, { color: colors.text }]}>
                {displayName}
              </Text>
              <View
                style={[
                  s.status,
                  {
                    backgroundColor: equipped
                      ? colors.primaryLight
                      : colors.surface,
                  },
                ]}
              >
                <Ionicons
                  name={equipped ? 'checkmark-circle' : 'ellipse-outline'}
                  size={16}
                  color={
                    equipped ? colors.primary : colors.textSecondary
                  }
                />
                <Text
                  style={[
                    s.statusText,
                    {
                      color: equipped
                        ? colors.primary
                        : colors.textSecondary,
                    },
                  ]}
                >
                  {equipped
                    ? t('profile.avatarFrames.equipped')
                    : t('profile.avatarFrames.notEquipped')}
                </Text>
              </View>
            </View>

            <View style={[s.section, themed.card]}>
              <Text style={[s.sectionTitle, { color: colors.text }]}>
                {t('profile.avatarFrames.description')}
              </Text>
              <Text
                selectable
                style={[s.body, { color: colors.textSecondary }]}
              >
                {description}
              </Text>
            </View>

            <View style={[s.section, themed.card]}>
              <Text style={[s.sectionTitle, { color: colors.text }]}>
                {t('profile.avatarFrames.sources')}
              </Text>
              {item && item.ownedSources.length > 0 ? (
                item.ownedSources.map((source, index) => (
                  <View
                    key={`${source.type}-${index}`}
                    style={s.sourceRow}
                  >
                    <Ionicons
                      name={
                        source.type === 'MEMBERSHIP'
                          ? 'diamond-outline'
                          : 'shield-checkmark-outline'
                      }
                      size={18}
                      color={colors.primary}
                    />
                    <View style={s.sourceText}>
                      <Text style={[s.body, { color: colors.text }]}>
                        {sourceLabel(source, t)}
                      </Text>
                      <Text
                        style={[
                          s.metadata,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {source.expiresAt
                          ? t('profile.avatarFrames.expires', {
                              date: formatDate(
                                source.expiresAt,
                                i18n.language,
                              ),
                            })
                          : t('profile.avatarFrames.permanent')}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text
                  style={[s.body, { color: colors.textSecondary }]}
                >
                  {t('profile.avatarFrames.noSources')}
                </Text>
              )}
            </View>

            <View style={[s.section, themed.card]}>
              <Text style={[s.sectionTitle, { color: colors.text }]}>
                {t('profile.avatarFrames.availability')}
              </Text>
              <Text style={[s.body, { color: colors.textSecondary }]}>
                {expiresAt
                  ? t('profile.avatarFrames.expires', {
                      date: formatDate(expiresAt, i18n.language),
                    })
                  : t('profile.avatarFrames.permanent')}
              </Text>
            </View>

            {saveError ? (
              <Text
                selectable
                style={[s.metadata, { color: colors.error }]}
              >
                {saveError}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={actionLabel}
              accessibilityState={{ disabled: actionDisabled }}
              disabled={submitting || (isNone && equipped)}
              onPress={() => void handleEquip()}
              style={[
                s.primaryButton,
                {
                  backgroundColor:
                    isNone || equipped ? colors.surface : colors.primary,
                  borderWidth: isNone || equipped ? 1 : 0,
                  borderColor: colors.surfaceBorder,
                },
                actionDisabled && s.disabled,
              ]}
            >
              <Text
                style={[
                  s.primaryButtonText,
                  {
                    color:
                      isNone || equipped
                        ? colors.text
                        : colors.white,
                  },
                ]}
              >
                {actionLabel}
              </Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
