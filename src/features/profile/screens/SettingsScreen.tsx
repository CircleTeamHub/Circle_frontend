import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { AvatarPhotoViewer } from '@/components/ui/avatar-photo-viewer';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useAuthStore, type AuthUser } from '@/stores/authStore';
import { useChangeAvatar } from '@/hooks/use-change-avatar';
import { updateUserProfile } from '@/services/api/profile';
import { reportHandledFailure } from '@/observability/report-failure';
import { ProfileFieldEditSheet } from '@/features/profile/components/profile-field-edit-sheet';
import {
  formatProfileFieldValue,
  getProfileEditField,
} from '@/features/profile/profile-edit-config';

interface SettingsRowItem {
  id: string;
  label: string;
  value?: string;
  type?: 'avatar' | 'text';
  editable: boolean;
  unsupportedMessage?: string;
}

const PROFILE_ROW_IDS = [
  'avatar',
  'nickname',
  'gender',
  'birthday',
  'city',
  'bio',
  'wechat',
  'phone',
  'email',
  'qq',
] as const;

const s = StyleSheet.create({
  section: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    paddingHorizontal: Spacing.md,
  },
  // 与其他设置页同一套卡片：圆角底板 + 行内分隔线。
  card: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
    overflow: 'hidden',
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: 12,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexShrink: 1,
  },
});

function getFieldValue(user: AuthUser | null, fieldId: string) {
  const field = getProfileEditField(fieldId);

  if (!user || !field || !('valueKey' in field) || !field.valueKey) {
    return '';
  }

  const value = user[field.valueKey as keyof AuthUser];
  return typeof value === 'string' ? value : '';
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const setUser = useAuthStore((state) => state.setUser);
  // 设置搜索结果可以带 ?field= 直达某一项,进页面就弹出对应面板。
  const params = useLocalSearchParams<{ field?: string }>();
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [avatarPreviewKey, setAvatarPreviewKey] = useState<string | null>(null);
  const avatarSubjectKey = `${sessionEpoch}:${user?.id ?? ''}`;

  const submitAvatar = useCallback(
    async (fileUrl: string) => {
      const { user: current, sessionEpoch: epoch } = useAuthStore.getState();
      if (!current || current.id !== user?.id) return;
      const updated = await updateUserProfile(current.id, { avatarUrl: fileUrl }, current);
      const latest = useAuthStore.getState();
      if (latest.sessionEpoch === epoch && latest.user?.id === current.id) setUser(updated);
    },
    [setUser, user?.id],
  );
  const { changeAvatar, changing } = useChangeAvatar({
    submit: submitAvatar,
    // submit 里已经回写了全局用户,这里不用再做什么。
    onChanged: () => {},
    failureTitle: t('validation.saveFailed'),
    onFailure: (error) => reportHandledFailure('profile', 'avatarUpdate', error),
  });

  const profileRows = PROFILE_ROW_IDS.map((fieldId) => {
    const field = getProfileEditField(fieldId);

    if (!field) {
      return null;
    }

    return {
      id: field.id,
      label: field.label,
      type: field.rowType,
      value: formatProfileFieldValue(fieldId, getFieldValue(user, fieldId)),
      editable: field.editable,
      unsupportedMessage:
        'unsupportedMessage' in field ? field.unsupportedMessage : undefined,
    } satisfies SettingsRowItem;
  }).filter(Boolean) as SettingsRowItem[];

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      content: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
        paddingBottom: insets.bottom + Spacing.xl,
        gap: Spacing.lg,
      },
      sectionTitle: {
        color: colors.textSecondary,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
      card: {
        backgroundColor: colors.surface,
        boxShadow: '0 10px 26px rgba(59, 130, 246, 0.08)',
      },
      rowLabel: {
        color: colors.text,
        ...Typography.body,
      },
      rowValue: {
        color: colors.textSecondary,
        ...Typography.caption,
        textAlign: 'right' as const,
        flexShrink: 1,
      },
    }),
    [colors, insets.bottom],
  );

  const renderRow = (item: SettingsRowItem, index: number, total: number) => (
    <View key={item.id}>
      <Pressable
        style={({ pressed }) => [s.row, pressed ? s.rowPressed : null]}
        onPress={() => handleRowPress(item)}
        accessibilityRole="button"
        accessibilityLabel={[item.label, item.type !== 'avatar' ? item.value : null].filter(Boolean).join(', ')}
      >
        <Text style={d.rowLabel}>{item.label}</Text>
        <View style={s.rowRight}>
          {item.type === 'avatar' ? (
            <Avatar
              size={40}
              name={user?.nickname ?? user?.accountId ?? 'C'}
              uri={user?.avatarUrl ?? undefined}
            />
          ) : item.value ? (
            <Text style={d.rowValue} numberOfLines={1}>
              {item.value}
            </Text>
          ) : null}
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textSecondary}
          />
        </View>
      </Pressable>
      {index < total - 1 ? <Divider /> : null}
    </View>
  );

  function handleRowPress(item: SettingsRowItem) {
    if (item.id === 'email') {
      router.push('/(tabs)/profile/change-email');
      return;
    }
    if (!item.editable) {
      Alert.alert(item.label, item.unsupportedMessage ?? t('settingsPage.unsupported'));
      return;
    }
    if (item.type === 'avatar') {
      setAvatarPreviewKey(avatarSubjectKey);
      return;
    }
    setEditingFieldId(item.id);
  }

  const deepLinkedField = typeof params.field === 'string' ? params.field : null;
  useEffect(() => {
    if (!deepLinkedField) return;
    if (deepLinkedField === 'email') {
      router.push('/(tabs)/profile/change-email');
      return;
    }
    if (deepLinkedField === 'avatar') {
      setAvatarPreviewKey(avatarSubjectKey);
      return;
    }
    setEditingFieldId(deepLinkedField);
    // 只对进页面时带的参数响应一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkedField]);

  const closeEditor = useCallback(() => setEditingFieldId(null), []);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('profile.accountSettings')} />
      <ScrollView
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>
            {t('settingsPage.profileSection')}
          </Text>
          <View style={[s.card, d.card]}>
            {profileRows.map((item, index) =>
              renderRow(item, index, profileRows.length),
            )}
          </View>
        </View>
      </ScrollView>
      <ProfileFieldEditSheet fieldId={editingFieldId} onClose={closeEditor} />
      {user && avatarPreviewKey === avatarSubjectKey ? (
        <AvatarPhotoViewer
          key={avatarSubjectKey}
          visible
          uri={user.avatarUrl}
          name={user.nickname ?? user.accountId}
          changing={changing}
          onChange={changeAvatar}
          onClose={() => setAvatarPreviewKey(null)}
        />
      ) : null}
    </View>
  );
}
