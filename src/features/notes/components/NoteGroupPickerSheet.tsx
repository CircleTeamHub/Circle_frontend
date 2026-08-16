import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import type { NoteGroup, NoteSummary } from '@/features/notes/types';
import { runNoteBatch } from '@/features/notes/utils/batch-run';
import { commonGroupIds, toggleId } from '@/features/notes/utils/note-selection';
import { updateNoteGroupIds } from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface NoteGroupPickerSheetProps {
  /** 非空即打开；单条编辑传 [note]，多选批量传所有选中笔记 */
  notes: NoteSummary[] | null;
  groups: NoteGroup[];
  onClose: () => void;
  /** 保存结束回调（部分失败也回调）：父层刷新列表、退出多选 */
  onSaved: (result: { failedCount: number }) => void;
}

/**
 * 分组勾选弹层：保存 = 把每条目标笔记的分组**替换**为勾选集合。
 * 初始勾选取所有目标共同所属的分组；批量场景会明示替换语义。
 */
export function NoteGroupPickerSheet({
  notes,
  groups,
  onClose,
  onSaved,
}: NoteGroupPickerSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const [chosenIds, setChosenIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (notes && notes.length > 0) {
      setChosenIds(commonGroupIds(notes));
      setSaving(false);
    }
  }, [notes]);

  const chosenSet = useMemo(() => new Set(chosenIds), [chosenIds]);

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      title: { color: colors.text },
      caption: { color: colors.textSecondary },
      row: { backgroundColor: colors.background },
      rowName: { color: colors.text },
      rowCount: { color: colors.textSecondary },
      saveBtn: { backgroundColor: colors.primary },
      saveBtnText: { color: colors.white },
    }),
    [colors],
  );

  const handleSave = async () => {
    if (!notes || notes.length === 0 || saving) return;
    setSaving(true);
    const { failed } = await runNoteBatch(
      notes.map((note) => note.id),
      (id) => updateNoteGroupIds(id, chosenIds).then(() => undefined),
    );
    if (failed.length > 0) {
      Alert.alert(
        t('notes.alerts.saveFailedTitle', { defaultValue: '保存失败' }),
        t('notes.alerts.saveMembershipsPartialFailed', {
          defaultValue:
            '部分笔记分组可能已保存，列表已刷新为最新状态。请确认后重试。',
        }),
      );
    }
    onSaved({ failedCount: failed.length });
    onClose();
  };

  return (
    <BottomSheetModal
      visible={notes != null}
      onClose={onClose}
      backdropStyle={d.backdrop}
      sheetStyle={[
        s.sheet,
        d.sheet,
        { paddingBottom: insets.bottom || Spacing.lg },
      ]}
    >
      <View style={[s.handle, d.handle]} />
      <Text style={[s.title, d.title]}>
        {t('notes.groupPicker.title', { defaultValue: '编辑分组' })}
      </Text>
      {notes && notes.length === 1 ? (
        <Text style={[s.caption, d.caption]} numberOfLines={1}>
          {notes[0].title}
        </Text>
      ) : null}
      {notes && notes.length > 1 ? (
        <Text style={[s.caption, d.caption]}>
          {t('notes.groupPicker.batchHint', {
            count: notes.length,
            defaultValue: `保存后将替换所选 ${notes.length} 条笔记的分组。`,
          })}
        </Text>
      ) : null}
      {groups.length === 0 ? (
        <Text style={[s.empty, d.caption]}>
          {t('notes.groupPicker.empty', {
            defaultValue: '暂无分组，请先在「管理分组」中创建。',
          })}
        </Text>
      ) : (
        <ScrollView style={s.list} contentContainerStyle={s.listContent}>
          {groups.map((group) => {
            const chosen = chosenSet.has(group.id);
            return (
              <Pressable
                key={group.id}
                style={[s.row, d.row]}
                onPress={() => setChosenIds((prev) => toggleId(prev, group.id))}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
              >
                <View style={s.rowText}>
                  <Text style={[s.rowName, d.rowName]} numberOfLines={1}>
                    {group.name}
                  </Text>
                  <Text style={[s.rowCount, d.rowCount]}>
                    {t('notes.manageGroups.noteCount', {
                      count: group.noteCount,
                      defaultValue: `${group.noteCount} 条笔记`,
                    })}
                  </Text>
                </View>
                <Ionicons
                  name={chosen ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={chosen ? colors.primary : colors.textSecondary}
                />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {groups.length > 0 ? (
        <Pressable
          style={[s.saveBtn, d.saveBtn, saving ? s.saveBtnDisabled : null]}
          onPress={() => void handleSave()}
          disabled={saving}
          accessibilityRole="button"
        >
          <Text style={[s.saveBtnText, d.saveBtnText]}>
            {saving
              ? t('notes.groupPicker.saving', { defaultValue: '保存中...' })
              : t('notes.groupPicker.save', { defaultValue: '保存' })}
          </Text>
        </Pressable>
      ) : null}
    </BottomSheetModal>
  );
}

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.xs,
  },
  title: { ...Typography.h3, fontWeight: '700' },
  caption: { ...Typography.caption, fontWeight: '400' },
  list: { maxHeight: 320 },
  listContent: { gap: Spacing.sm },
  row: {
    minHeight: 56,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  rowText: { flex: 1 },
  rowName: { ...Typography.bodyRegular, fontWeight: '600' },
  rowCount: { ...Typography.small, marginTop: 2 },
  empty: {
    textAlign: 'center',
    paddingVertical: Spacing.xl,
    ...Typography.bodyRegular,
  },
  saveBtn: {
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { ...Typography.body, fontWeight: '600' },
});
