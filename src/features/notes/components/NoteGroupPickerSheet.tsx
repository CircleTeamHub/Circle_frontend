import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import {
  GROUP_NAME_MAX_LENGTH,
  MAX_NOTE_GROUPS,
} from '@/features/notes/components/GroupManagerSheet';
import type { NoteGroup, NoteSummary } from '@/features/notes/types';
import { runNoteBatch } from '@/features/notes/utils/batch-run';
import {
  applyGroupMembershipChanges,
  groupMembershipStates,
  type GroupMembershipChange,
  type GroupMembershipState,
} from '@/features/notes/utils/note-selection';
import { createNoteGroup, updateNoteGroupIds } from '@/services/api/notes';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface NoteGroupPickerSheetProps {
  /** 非空即打开；单条编辑传 [note]，多选批量传所有选中笔记 */
  notes: NoteSummary[] | null;
  groups: NoteGroup[];
  onClose: () => void;
  /** 保存结束回调（部分失败也回调）：父层刷新列表、退出多选 */
  onSaved: (result: { failedCount: number }) => void;
  /** 弹层内就地新建分组成功：父层把它并进 groups 状态 */
  onGroupCreated: (group: NoteGroup) => void;
}

/**
 * 分组勾选弹层：把所选笔记**加入/移出**分组，不做整套替换。
 * 三态底图：✓=所选全部在该分组，−=部分在，○=都不在；
 * 勾选=全部加入、取消=全部移出，没动过的分组保持每条笔记原样。
 */
export function NoteGroupPickerSheet({
  notes,
  groups,
  onClose,
  onSaved,
  onGroupCreated,
}: NoteGroupPickerSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  // 只记录用户显式改动过的分组（加入/移出），保存时按笔记逐条套用。
  const [changes, setChanges] = useState<
    Record<string, GroupMembershipChange>
  >({});
  const [saving, setSaving] = useState(false);
  // 就地新建分组的内联输入行。
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);

  useEffect(() => {
    if (notes && notes.length > 0) {
      setChanges({});
      setSaving(false);
      setCreatingOpen(false);
      setNewGroupName('');
      setCreatingGroup(false);
    }
  }, [notes]);

  const handleOpenCreate = () => {
    if (groups.length >= MAX_NOTE_GROUPS) {
      Alert.alert(
        t('notes.alerts.groupLimitTitle', { defaultValue: '分组已达上限' }),
        t('notes.alerts.groupLimitMessage', {
          max: MAX_NOTE_GROUPS,
          defaultValue: `最多只能创建 ${MAX_NOTE_GROUPS} 个分组。`,
        }),
      );
      return;
    }
    setCreatingOpen(true);
  };

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name || creatingGroup) return;
    setCreatingGroup(true);
    try {
      const created = await createNoteGroup(name);
      onGroupCreated(created);
      // 在这里新建分组的意图就是把所选笔记放进去：默认标记为「加入」。
      setChanges((prev) => ({ ...prev, [created.id]: 'add' }));
      setNewGroupName('');
      setCreatingOpen(false);
    } catch (error) {
      Alert.alert(
        t('notes.alerts.saveFailedTitle', { defaultValue: '保存失败' }),
        getApiErrorMessage(
          error,
          t('notes.alerts.saveGroupFailed', {
            defaultValue: '分组保存失败，请稍后再试。',
          }),
        ),
      );
      if (__DEV__) {
        console.warn('[NoteGroupPickerSheet] createNoteGroup failed', error);
      }
    } finally {
      setCreatingGroup(false);
    }
  };

  const baseStates = useMemo(
    () => groupMembershipStates(notes ?? [], groups),
    [groups, notes],
  );

  const effectiveState = (groupId: string): GroupMembershipState => {
    const change = changes[groupId];
    if (change === 'add') return 'all';
    if (change === 'remove') return 'none';
    return baseStates.get(groupId) ?? 'none';
  };

  const toggleGroup = (groupId: string) => {
    setChanges((prev) => {
      const base = baseStates.get(groupId) ?? 'none';
      const change = prev[groupId];
      const effective =
        change === 'add' ? 'all' : change === 'remove' ? 'none' : base;
      const nextOp: GroupMembershipChange =
        effective === 'all' ? 'remove' : 'add';
      // 转一圈回到底图状态时清掉改动记录，避免发无意义的写请求。
      if (
        (nextOp === 'add' && base === 'all') ||
        (nextOp === 'remove' && base === 'none')
      ) {
        const { [groupId]: _dropped, ...rest } = prev;
        return rest;
      }
      return { ...prev, [groupId]: nextOp };
    });
  };

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
    // 只给净变化非零的笔记发请求：没动任何分组 = 直接关掉，零网络开销。
    const ops = applyGroupMembershipChanges(notes, changes);
    if (ops.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    const nextGroupIds = new Map(ops.map((op) => [op.id, op.groupIds]));
    const { failed } = await runNoteBatch(
      ops.map((op) => op.id),
      (id) => updateNoteGroupIds(id, nextGroupIds.get(id) ?? []).then(() => undefined),
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
      sheetStyle={s.sheetWrap}
    >
      {/* 就地新建分组会呼出键盘：整个面板随键盘上移 */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={[
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
            defaultValue: `勾选把所选 ${notes.length} 条笔记加入分组，取消勾选则移出；没动过的分组保持各自原样。`,
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
            const state = effectiveState(group.id);
            return (
              <Pressable
                key={group.id}
                style={[s.row, d.row]}
                onPress={() => toggleGroup(group.id)}
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked: state === 'all' ? true : state === 'some' ? 'mixed' : false,
                }}
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
                  name={
                    state === 'all'
                      ? 'checkmark-circle'
                      : state === 'some'
                        ? 'remove-circle'
                        : 'ellipse-outline'
                  }
                  size={22}
                  color={state === 'none' ? colors.textSecondary : colors.primary}
                />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {creatingOpen ? (
        <View style={s.createRow}>
          <TextInput
            style={[
              s.createInput,
              {
                color: colors.text,
                borderColor: colors.surfaceBorder,
                backgroundColor: colors.background,
              },
            ]}
            placeholder={t('notes.manageGroups.namePlaceholder', {
              defaultValue: '输入分组名添加新的分组',
            })}
            placeholderTextColor={colors.textSecondary}
            value={newGroupName}
            onChangeText={setNewGroupName}
            maxLength={GROUP_NAME_MAX_LENGTH}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void handleCreateGroup()}
          />
          <Pressable
            style={[
              s.createConfirmBtn,
              d.saveBtn,
              creatingGroup ? s.saveBtnDisabled : null,
            ]}
            onPress={() => void handleCreateGroup()}
            disabled={creatingGroup}
            accessibilityRole="button"
          >
            <Text style={[s.saveBtnText, d.saveBtnText]}>
              {creatingGroup
                ? t('notes.groupPicker.saving', { defaultValue: '保存中...' })
                : t('common.confirm', { defaultValue: '确认' })}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={[s.createBtn, { borderColor: colors.surfaceBorder }]}
          onPress={handleOpenCreate}
          accessibilityRole="button"
        >
          <Ionicons name="add" size={18} color={colors.primary} />
          <Text style={[s.createBtnText, { color: colors.primary }]}>
            {t('notes.manageGroups.createNew', { defaultValue: '新增分组' })}
          </Text>
        </Pressable>
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
        </View>
      </KeyboardAvoidingView>
    </BottomSheetModal>
  );
}

const s = StyleSheet.create({
  sheetWrap: { width: '100%' },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  createInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    ...Typography.bodyRegular,
  },
  createConfirmBtn: {
    height: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtn: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  createBtnText: { ...Typography.bodyRegular, fontWeight: '600' },
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
