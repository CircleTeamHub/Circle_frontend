import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { NavHeader } from '@/components/ui/nav-header';
import { UserIconRow } from '@/components/ui/user-icon-row';
import { fetchCurrentUser } from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';
import {
  fetchIconOptions,
  updateDisplayIcons,
  type UpdateDisplayIconInput,
} from '@/services/api/icons';
import {
  SYSTEM_BADGE_CATALOG,
  type BadgeView,
} from '@/features/profile/badge-catalog';
import {
  getMembershipTierForVipLevel,
  type MembershipTier,
} from '@/features/profile/membership-plans';
import { BadgeGridItem } from '@/features/profile/components/badge-grid-item';
import { BadgeDetailSheet } from '@/features/profile/components/badge-detail-sheet';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { DisplayIcon, IconOption, SystemIconKey } from '@/types';

const MAX_DISPLAY_ICONS = 5;

type DraftDisplayIcon = {
  id: string;
  title: string;
  imageUrl: string | null;
  fallbackIconName: string | null;
  type: 'SYSTEM' | 'CIRCLE';
  sortOrder: number;
  systemKey?: SystemIconKey;
  systemVariant?: string;
  recognitionCount?: number;
  circleId?: string;
  circleName?: string;
};

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl * 2,
    gap: Spacing.lg,
  },
  section: {
    gap: Spacing.sm,
  },
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  title: {
    ...Typography.body,
    fontWeight: '700',
  },
  subtitle: {
    ...Typography.small,
  },
  hint: {
    ...Typography.small,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  footerButton: {
    minHeight: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

function optionToDraft(option: IconOption, sortOrder: number): DraftDisplayIcon {
  return {
    id: getOptionIdentity(option),
    title: option.title,
    imageUrl: option.imageUrl,
    fallbackIconName: option.fallbackIconName,
    type: option.type,
    sortOrder,
    systemKey: option.systemKey,
    systemVariant: option.systemVariant,
    recognitionCount: option.recognitionCount,
    circleId: option.circleId,
    circleName: option.circleName,
  };
}

function optionToPreviewIcon(option: IconOption): DisplayIcon {
  return {
    ...option,
    id: option.systemKey ?? option.circleId ?? `${option.type}-${option.title}`,
    sortOrder: 0,
  };
}

function getOptionIdentity(
  option: Pick<
    IconOption,
    'type' | 'systemKey' | 'systemVariant' | 'circleId' | 'title'
  >,
) {
  if (option.type === 'SYSTEM') {
    return `system:${option.systemKey}:${option.systemVariant ?? option.systemKey ?? option.title}`;
  }

  return `circle:${option.circleId ?? option.title}`;
}

function getDisplayIconIdentity(
  icon: Pick<
    DisplayIcon,
    'type' | 'systemKey' | 'systemVariant' | 'circleId' | 'id' | 'title'
  >,
) {
  if (icon.type === 'SYSTEM') {
    return `system:${icon.systemKey}:${icon.systemVariant ?? icon.systemKey ?? icon.title}`;
  }

  return `circle:${icon.circleId ?? icon.id ?? icon.title}`;
}

// VIP 徽章档位：systemVariant 'VIP1'..'VIP4' → silver / gold / diamond / super。
function vipTierFromVariant(
  systemVariant: string | undefined,
): MembershipTier | undefined {
  const level = Number(systemVariant?.match(/\d+/)?.[0]);
  if (!level) return undefined;
  return getMembershipTierForVipLevel(level) ?? undefined;
}

// 已拥有系统徽章：按目录顺序、每类型取最高档（后端按等级升序返回，取末位）为代表。
// VIP 额外带上 tierKey，详情文案按档位区分。
function buildOwnedSystemBadges(systemIcons: IconOption[]): BadgeView[] {
  const grouped = new Map<SystemIconKey, IconOption[]>();
  for (const option of systemIcons) {
    if (!option.systemKey) continue;
    const list = grouped.get(option.systemKey) ?? [];
    list.push(option);
    grouped.set(option.systemKey, list);
  }

  return SYSTEM_BADGE_CATALOG.flatMap((entry) => {
    const owned = grouped.get(entry.systemKey);
    if (!owned || owned.length === 0) return [];
    const representative = owned[owned.length - 1];
    return [
      {
        key: `system:${entry.systemKey}`,
        explainKey: entry.explainKey,
        title: representative.title,
        previewIcon: optionToPreviewIcon(representative),
        option: representative,
        owned: true,
        tierKey:
          entry.systemKey === 'VIP'
            ? vipTierFromVariant(representative.systemVariant)
            : undefined,
      } satisfies BadgeView,
    ];
  });
}

// 圈子徽章：单独分区，逐个平铺（均为已拥有；无「未拥有圈子」概念）。
function buildCircleBadges(circleIcons: IconOption[]): BadgeView[] {
  return circleIcons.map<BadgeView>((option) => ({
    key: `circle:${option.circleId ?? option.title}`,
    explainKey: 'circle',
    title: option.circleName ?? option.title,
    previewIcon: optionToPreviewIcon(option),
    option,
    owned: true,
  }));
}

// 未拥有徽章 = 系统徽章目录 − 已拥有系统类型；灰态展示，只能查看介绍 / 获得方式。
function buildLockedBadges(
  systemIcons: IconOption[],
  resolveName: (nameKey: string) => string,
): BadgeView[] {
  const ownedSystemKeys = new Set(
    systemIcons.map((option) => option.systemKey).filter(Boolean),
  );

  return SYSTEM_BADGE_CATALOG.filter(
    (entry) => !ownedSystemKeys.has(entry.systemKey),
  ).map<BadgeView>((entry) => ({
    key: `locked:${entry.systemKey}`,
    explainKey: entry.explainKey,
    title: resolveName(entry.nameKey),
    previewIcon: entry.lockedPreview,
    option: null,
    owned: false,
  }));
}

export default function MyIconsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [systemIcons, setSystemIcons] = useState<IconOption[]>([]);
  const [circleIcons, setCircleIcons] = useState<IconOption[]>([]);
  const [selectedIcons, setSelectedIcons] = useState<DraftDisplayIcon[]>([]);
  const [detailBadge, setDetailBadge] = useState<BadgeView | null>(null);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchIconOptions();
      setSystemIcons(response.systemIcons);
      setCircleIcons(response.circleIcons);
      setSelectedIcons(
        response.displayIcons
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((icon) => ({
            ...icon,
            id: getDisplayIconIdentity(icon),
          })),
      );
    } catch (error) {
      Alert.alert(
        t('myIcons.loadFailedTitle', { defaultValue: '徽章加载失败' }),
        getApiErrorMessage(
          error,
          t('myIcons.retryLater', { defaultValue: '请稍后重试' }),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const currentDisplayIcons = useMemo<DisplayIcon[]>(
    () =>
      selectedIcons.map((icon, index) => ({
        ...icon,
        sortOrder: index,
      })),
    [selectedIcons],
  );

  const ownedSystemBadges = useMemo(
    () => buildOwnedSystemBadges(systemIcons),
    [systemIcons],
  );
  const circleBadges = useMemo(
    () => buildCircleBadges(circleIcons),
    [circleIcons],
  );
  const lockedBadges = useMemo(
    () => buildLockedBadges(systemIcons, (nameKey) => t(nameKey)),
    [systemIcons, t],
  );

  const selectedIdSet = useMemo(
    () => new Set(selectedIcons.map((icon) => icon.id)),
    [selectedIcons],
  );
  const isSelected = useCallback(
    (badge: BadgeView) =>
      badge.option ? selectedIdSet.has(getOptionIdentity(badge.option)) : false,
    [selectedIdSet],
  );
  const detailSelected = detailBadge ? isSelected(detailBadge) : false;

  const toggleDisplay = useCallback(
    (badge: BadgeView) => {
      const option = badge.option;
      if (!option) return;
      const optionId = getOptionIdentity(option);

      setSelectedIcons((current) => {
        const existingIndex = current.findIndex((item) => item.id === optionId);
        if (existingIndex >= 0) {
          return current
            .filter((item) => item.id !== optionId)
            .map((item, index) => ({ ...item, sortOrder: index }));
        }

        if (current.length >= MAX_DISPLAY_ICONS) {
          Alert.alert(
            t('myIcons.maxIcons', {
              count: MAX_DISPLAY_ICONS,
              defaultValue: `最多展示 ${MAX_DISPLAY_ICONS} 个徽章`,
            }),
          );
          return current;
        }

        return [...current, optionToDraft(option, current.length)];
      });
    },
    [t],
  );

  const handleSave = useCallback(async () => {
    if (!user) {
      router.back();
      return;
    }

    setSaving(true);
    try {
      const payload: UpdateDisplayIconInput[] = selectedIcons.map(
        (icon, index) => ({
          displayType: icon.type,
          systemKey: icon.systemKey,
          systemVariant: icon.systemVariant,
          circleId: icon.circleId,
          sortOrder: index,
        }),
      );
      const nextDisplayIcons = await updateDisplayIcons(payload);
      const refreshedUser = await fetchCurrentUser().catch(() => null);
      setUser({
        ...(refreshedUser ?? user),
        displayIcons: nextDisplayIcons,
      });
      router.back();
    } catch (error) {
      Alert.alert(
        t('myIcons.saveFailedTitle', { defaultValue: '保存失败' }),
        getApiErrorMessage(
          error,
          t('myIcons.retryLater', { defaultValue: '请稍后重试' }),
        ),
      );
    } finally {
      setSaving(false);
    }
  }, [router, selectedIcons, setUser, user, t]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      card: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
      },
      title: { color: colors.text },
      subtitle: { color: colors.textSecondary },
      hint: { color: colors.textSecondary },
      saveButton: {
        backgroundColor: saving ? colors.surfaceBorder : colors.primary,
      },
      saveButtonText: {
        color: saving ? colors.textSecondary : colors.white,
        ...Typography.body,
        fontWeight: '700' as const,
      },
    }),
    [colors, saving],
  );

  const displayingLabel = t('myIcons.displaying', { defaultValue: '展示中' });

  const renderBadgeSection = (title: string, badges: BadgeView[]) =>
    badges.length > 0 ? (
      <View style={s.section}>
        <Text style={[s.title, d.title]}>{title}</Text>
        <View style={s.grid}>
          {badges.map((badge) => (
            <BadgeGridItem
              key={badge.key}
              badge={badge}
              selected={isSelected(badge)}
              displayingLabel={displayingLabel}
              onPress={setDetailBadge}
            />
          ))}
        </View>
      </View>
    ) : null;

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('myIcons.title', { defaultValue: '我的徽章' })}
        onBackPress={handleSave}
      />
      <ScrollView
        style={s.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={s.content}
      >
        <View style={[s.card, d.card]}>
          <Text style={[s.title, d.title]}>
            {t('myIcons.currentDisplay', { defaultValue: '当前展示' })}
          </Text>
          <Text style={[s.subtitle, d.subtitle]}>
            {loading
              ? t('myIcons.loading', { defaultValue: '加载中...' })
              : t('myIcons.selectedCount', {
                  count: selectedIcons.length,
                  max: MAX_DISPLAY_ICONS,
                  defaultValue: `已选择 ${selectedIcons.length}/${MAX_DISPLAY_ICONS}`,
                })}
          </Text>
          <UserIconRow icons={currentDisplayIcons} />
        </View>

        <Text style={[s.hint, d.hint]}>
          {t('myIcons.collectionHint', {
            defaultValue: '点击任意徽章，查看它代表什么、如何获得。',
          })}
        </Text>

        {loading && ownedSystemBadges.length === 0 && circleBadges.length === 0 ? (
          <Text style={[s.subtitle, d.subtitle]}>
            {t('myIcons.loading', { defaultValue: '加载中...' })}
          </Text>
        ) : null}

        {renderBadgeSection(
          t('myIcons.ownedGroup', { defaultValue: '已拥有' }),
          ownedSystemBadges,
        )}
        {renderBadgeSection(
          t('myIcons.circleGroup', { defaultValue: '圈子徽章' }),
          circleBadges,
        )}
        {renderBadgeSection(
          t('myIcons.lockedGroup', { defaultValue: '未拥有' }),
          lockedBadges,
        )}

        <Pressable
          style={[s.footerButton, d.saveButton]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={d.saveButtonText}>
            {saving
              ? t('myIcons.saving', { defaultValue: '保存中...' })
              : t('myIcons.save', { defaultValue: '保存' })}
          </Text>
        </Pressable>
      </ScrollView>

      <BadgeDetailSheet
        badge={detailBadge}
        selected={detailSelected}
        onToggleDisplay={toggleDisplay}
        onClose={() => setDetailBadge(null)}
      />
    </View>
  );
}
