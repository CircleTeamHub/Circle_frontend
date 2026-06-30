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
import { UserIconBadge, UserIconRow } from '@/components/ui/user-icon-row';
import { fetchCurrentUser } from '@/services/api/auth';
import {
  fetchIconOptions,
  updateDisplayIcons,
  type UpdateDisplayIconInput,
} from '@/services/api/icons';
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
  recognitionCount?: number;
  circleId?: string;
  circleName?: string;
};

/**
 * Badge 说明的 i18n key 段（不直接返回文案，便于多语言）。
 * 实际文案在 myIcons.explain.<key>.description / .condition。
 */
type IconExplanationKey =
  | 'empty'
  | 'circle'
  | 'vip'
  | 'newUser'
  | 'topCollaborator'
  | 'verifiedProfile'
  | 'circleBuilder'
  | 'systemDefault';

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
  detailTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  detailCopyGroup: {
    gap: Spacing.xs,
  },
  detailLabel: {
    ...Typography.small,
    fontWeight: '700',
  },
  optionChip: {
    width: 76,
    minHeight: 78,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerButton: {
    minHeight: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
});

function getIconExplanationKey(option: IconOption | null): IconExplanationKey {
  if (!option) return 'empty';
  if (option.type === 'CIRCLE') return 'circle';

  switch (option.systemKey) {
    case 'VIP':
      return 'vip';
    case 'NEW_USER':
      return 'newUser';
    case 'TOP_COLLABORATOR':
      return 'topCollaborator';
    case 'VERIFIED_PROFILE':
      return 'verifiedProfile';
    case 'CIRCLE_BUILDER':
      return 'circleBuilder';
    default:
      return 'systemDefault';
  }
}

function optionToDraft(option: IconOption, sortOrder: number): DraftDisplayIcon {
  return {
    id: option.systemKey ?? option.circleId ?? `${option.type}-${option.title}`,
    title: option.title,
    imageUrl: option.imageUrl,
    fallbackIconName: option.fallbackIconName,
    type: option.type,
    sortOrder,
    systemKey: option.systemKey,
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
  const [focusedOption, setFocusedOption] = useState<IconOption | null>(null);

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
            id: icon.systemKey ?? icon.circleId ?? icon.id,
          })),
      );
    } catch (error) {
      Alert.alert(
        t('myIcons.loadFailedTitle', { defaultValue: '图标加载失败' }),
        error instanceof Error
          ? error.message
          : t('myIcons.retryLater', { defaultValue: '请稍后重试' }),
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
  const focusedExplanationKey = useMemo(
    () => getIconExplanationKey(focusedOption),
    [focusedOption],
  );

  const toggleOption = useCallback(
    (option: IconOption) => {
      const optionId =
        option.systemKey ?? option.circleId ?? `${option.type}-${option.title}`;
      setFocusedOption(option);

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
              defaultValue: `最多展示 ${MAX_DISPLAY_ICONS} 个图标`,
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
      const payload: UpdateDisplayIconInput[] = selectedIcons.map((icon, index) => ({
        displayType: icon.type,
        systemKey: icon.systemKey,
        circleId: icon.circleId,
        sortOrder: index,
      }));
      const nextDisplayIcons = await updateDisplayIcons(payload);
      const refreshedUser = await fetchCurrentUser().catch(() => null);
      setUser({
        ...(refreshedUser ?? user),
        displayIcons: refreshedUser?.displayIcons ?? nextDisplayIcons,
      });
      router.back();
    } catch (error) {
      Alert.alert(
        t('myIcons.saveFailedTitle', { defaultValue: '保存失败' }),
        error instanceof Error
          ? error.message
          : t('myIcons.retryLater', { defaultValue: '请稍后重试' }),
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
      detailLabel: { color: colors.text },
      optionChip: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      optionChipSelected: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
      },
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

  const renderOptionGroup = (title: string, options: IconOption[]) => (
    <View style={s.section}>
      <Text style={[s.title, d.title]}>{title}</Text>
      <View style={s.chipRow}>
        {options.map((option) => {
          const optionId = option.systemKey ?? option.circleId ?? `${option.type}-${option.title}`;
          const selected = selectedIcons.some((item) => item.id === optionId);
          return (
            <Pressable
              key={optionId}
              style={[
                s.optionChip,
                d.optionChip,
                selected ? d.optionChipSelected : null,
              ]}
              onPress={() => toggleOption(option)}
            >
              <UserIconBadge icon={optionToPreviewIcon(option)} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('myIcons.title', { defaultValue: '我的图标' })} />
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

        <View style={[s.card, d.card]}>
          <View style={s.detailTitleRow}>
            {focusedOption ? (
              <UserIconBadge icon={optionToPreviewIcon(focusedOption)} compact />
            ) : null}
            <Text style={[s.title, d.title]}>
              {focusedOption?.title ??
                t('myIcons.explainTitle', { defaultValue: 'Badge 说明' })}
            </Text>
          </View>
          <View style={s.detailCopyGroup}>
            <Text style={[s.detailLabel, d.detailLabel]}>
              {t('myIcons.explainIntroLabel', { defaultValue: '介绍' })}
            </Text>
            <Text style={[s.subtitle, d.subtitle]}>
              {t(`myIcons.explain.${focusedExplanationKey}.description`)}
            </Text>
          </View>
          <View style={s.detailCopyGroup}>
            <Text style={[s.detailLabel, d.detailLabel]}>
              {t('myIcons.explainConditionLabel', { defaultValue: '获得条件' })}
            </Text>
            <Text style={[s.subtitle, d.subtitle]}>
              {t(`myIcons.explain.${focusedExplanationKey}.condition`)}
            </Text>
          </View>
        </View>

        {renderOptionGroup(
          t('myIcons.systemGroup', { defaultValue: '系统图标' }),
          systemIcons,
        )}
        {renderOptionGroup(
          t('myIcons.circleGroup', { defaultValue: '我的圈子' }),
          circleIcons,
        )}

        <Pressable style={[s.footerButton, d.saveButton]} onPress={handleSave} disabled={saving}>
          <Text style={d.saveButtonText}>
            {saving
              ? t('myIcons.saving', { defaultValue: '保存中...' })
              : t('myIcons.save', { defaultValue: '保存图标' })}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
