import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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
import type { DisplayIcon, IconOption } from '@/types';

const MAX_DISPLAY_ICONS = 5;

type DraftDisplayIcon = {
  id: string;
  title: string;
  imageUrl: string | null;
  fallbackIconName: string | null;
  type: 'SYSTEM' | 'CIRCLE';
  sortOrder: number;
  systemKey?: 'VIP' | 'NEW_USER';
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
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  selectedMeta: {
    flex: 1,
    gap: 4,
  },
  selectedActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
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

function optionToDraft(option: IconOption, sortOrder: number): DraftDisplayIcon {
  return {
    id: option.systemKey ?? option.circleId ?? `${option.type}-${option.title}`,
    title: option.title,
    imageUrl: option.imageUrl,
    fallbackIconName: option.fallbackIconName,
    type: option.type,
    sortOrder,
    systemKey: option.systemKey,
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
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [systemIcons, setSystemIcons] = useState<IconOption[]>([]);
  const [circleIcons, setCircleIcons] = useState<IconOption[]>([]);
  const [selectedIcons, setSelectedIcons] = useState<DraftDisplayIcon[]>([]);

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
        '图标加载失败',
        error instanceof Error ? error.message : '请稍后重试',
      );
    } finally {
      setLoading(false);
    }
  }, []);

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

  const toggleOption = useCallback((option: IconOption) => {
    const optionId = option.systemKey ?? option.circleId ?? `${option.type}-${option.title}`;

    setSelectedIcons((current) => {
      const existingIndex = current.findIndex((item) => item.id === optionId);
      if (existingIndex >= 0) {
        return current
          .filter((item) => item.id !== optionId)
          .map((item, index) => ({ ...item, sortOrder: index }));
      }

      if (current.length >= MAX_DISPLAY_ICONS) {
        Alert.alert('最多展示 5 个图标');
        return current;
      }

      return [
        ...current,
        optionToDraft(option, current.length),
      ];
    });
  }, []);

  const moveSelectedIcon = useCallback((id: string, direction: -1 | 1) => {
    setSelectedIcons((current) => {
      const index = current.findIndex((item) => item.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next.map((entry, order) => ({ ...entry, sortOrder: order }));
    });
  }, []);

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
        '保存失败',
        error instanceof Error ? error.message : '请稍后重试',
      );
    } finally {
      setSaving(false);
    }
  }, [router, selectedIcons, setUser, user]);

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
      actionIcon: { color: colors.textSecondary },
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
      <NavHeader title="我的图标" />
      <ScrollView
        style={s.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={s.content}
      >
        <View style={[s.card, d.card]}>
          <Text style={[s.title, d.title]}>当前展示</Text>
          <Text style={[s.subtitle, d.subtitle]}>
            {loading ? '加载中...' : `已选择 ${selectedIcons.length}/${MAX_DISPLAY_ICONS}`}
          </Text>
          <UserIconRow icons={currentDisplayIcons} />
          {selectedIcons.map((icon, index) => (
            <View key={icon.id} style={s.selectedRow}>
              <View style={s.selectedMeta}>
                <Text style={[s.title, d.title]}>{icon.title}</Text>
                <Text style={[s.subtitle, d.subtitle]}>
                  {icon.type === 'SYSTEM' ? '系统图标' : icon.circleName ?? '我的圈子'}
                </Text>
              </View>
              <View style={s.selectedActions}>
                <Pressable onPress={() => moveSelectedIcon(icon.id, -1)} disabled={index === 0}>
                  <Ionicons name="arrow-up-outline" size={18} color={colors.textSecondary} />
                </Pressable>
                <Pressable
                  onPress={() => moveSelectedIcon(icon.id, 1)}
                  disabled={index === selectedIcons.length - 1}
                >
                  <Ionicons name="arrow-down-outline" size={18} color={colors.textSecondary} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>

        {renderOptionGroup('系统图标', systemIcons)}
        {renderOptionGroup('我的圈子', circleIcons)}

        <Pressable style={[s.footerButton, d.saveButton]} onPress={handleSave} disabled={saving}>
          <Text style={d.saveButtonText}>{saving ? '保存中...' : '保存图标'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
