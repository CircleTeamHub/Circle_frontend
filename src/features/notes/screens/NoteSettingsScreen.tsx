import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { MenuRow } from '@/components/ui/menu-row';
import { NavHeader } from '@/components/ui/nav-header';
import {
  useNoteCollectPreferences,
  useNoteCollectPreferencesStore,
} from '@/features/notes/store/use-note-collect-preferences-store';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  container: { flex: 1 },
  section: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  sectionTitle: {
    ...Typography.small,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
  hint: {
    ...Typography.small,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
});

/** 笔记设置:从聊天里把笔记添加到「我的笔记」时,要不要先选分组、要不要编辑标题。 */
export default function NoteSettingsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const { chooseGroup, editTitle } = useNoteCollectPreferences(userId);
  const setPreference = useNoteCollectPreferencesStore((state) => state.setPreference);
  const setChooseGroup = useCallback(
    (value: boolean) => {
      if (userId) setPreference(userId, { chooseGroup: value });
    },
    [setPreference, userId],
  );
  const setEditTitle = useCallback(
    (value: boolean) => {
      if (userId) setPreference(userId, { editTitle: value });
    },
    [setPreference, userId],
  );

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <NavHeader title={t('notes.settings.title', { defaultValue: '笔记设置' })} />
      <Text style={[s.sectionTitle, { color: colors.textSecondary }]}>
        {t('notes.settings.collectSection', { defaultValue: '添加笔记时' })}
      </Text>
      <View style={[s.section, { backgroundColor: colors.surface }]}>
        <MenuRow
          icon="folder-outline"
          label={t('notes.settings.chooseGroup', { defaultValue: '选择分组' })}
          hasToggle
          toggleValue={chooseGroup}
          onToggle={setChooseGroup}
        />
        <MenuRow
          icon="create-outline"
          label={t('notes.settings.editTitle', { defaultValue: '编辑标题' })}
          hasToggle
          toggleValue={editTitle}
          onToggle={setEditTitle}
        />
      </View>
      <Text style={[s.hint, { color: colors.textSecondary }]}>
        {t('notes.settings.collectHint', {
          defaultValue: '关闭「选择分组」会放进未分组；关闭「编辑标题」会沿用原笔记标题。',
        })}
      </Text>
    </View>
  );
}
