import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Spacing, Typography, useTheme } from '@/theme';
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
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
  const setUser = useAuthStore((state) => state.setUser);
  // 设置搜索结果可以带 ?field= 直达某一项,进页面就弹出对应面板。
  const params = useLocalSearchParams<{ field?: string }>();
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);

  const submitAvatar = useCallback(
    async (fileUrl: string) => {
      const current = useAuthStore.getState().user;
      if (!current) return;
      setUser(await updateUserProfile(current.id, { avatarUrl: fileUrl }, current));
    },
    [setUser],
  );
  const { changeAvatar } = useChangeAvatar({
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
        paddingBottom: insets.bottom + Spacing.lg,
        gap: Spacing.xl,
      },
      sectionTitle: {
        color: colors.textSecondary,
        ...Typography.caption,
        fontWeight: '600' as const,
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
      <Pressable style={s.row} onPress={() => handleRowPress(item)}>
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
    if (!item.editable) {
      Alert.alert(item.label, item.unsupportedMessage ?? t('settingsPage.unsupported'));
      return;
    }
    // 头像直接唤起相册;其余字段在底部面板里改,不再跳单独的编辑页。
    if (item.type === 'avatar') {
      void changeAvatar();
      return;
    }
    setEditingFieldId(item.id);
  }

  const deepLinkedField = typeof params.field === 'string' ? params.field : null;
  useEffect(() => {
    if (!deepLinkedField) return;
    if (deepLinkedField === 'avatar') {
      void changeAvatar();
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
          <Text style={d.sectionTitle}>{t('settingsPage.profileSection')}</Text>
          {profileRows.map((item, index) =>
            renderRow(item, index, profileRows.length),
          )}
        </View>
      </ScrollView>
      <ProfileFieldEditSheet fieldId={editingFieldId} onClose={closeEditor} />
    </View>
  );
}
