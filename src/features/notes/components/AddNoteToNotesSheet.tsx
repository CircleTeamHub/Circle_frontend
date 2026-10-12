import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { FloatingModal } from '@/components/ui/floating-modal';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import type { NoteGroup } from '@/features/notes/types';
import { buildCollectedNoteTitle } from '@/features/notes/utils/note-collect-title';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export type AddNoteToNotesSelection = {
  targetNoteGroupId: string | null;
  title: string;
};

type AddNoteToNotesSheetProps = {
  visible: boolean;
  noteTitle: string;
  username?: string;
  groups: NoteGroup[];
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onRetryGroups?: () => void;
  onConfirm: (selection: AddNoteToNotesSelection) => void;
};

/** 收藏笔记的两步确认：先选私有分组，再编辑标题并保存。 */
export function AddNoteToNotesSheet({
  visible,
  noteTitle,
  username,
  groups,
  loading = false,
  saving = false,
  error = null,
  onClose,
  onRetryGroups,
  onConfirm,
}: AddNoteToNotesSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [step, setStep] = useState<'group' | 'title'>('group');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const titleInputRef = useRef<TextInput>(null);

  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const defaultTitle = useMemo(
    () =>
      buildCollectedNoteTitle({
        groupName: selectedGroup?.name,
        username,
        originalTitle: noteTitle,
      }),
    [noteTitle, selectedGroup?.name, username],
  );

  useEffect(() => {
    if (!visible) {
      Keyboard.dismiss();
      return;
    }
    setStep('group');
    setSelectedGroupId(null);
    setTitle('');
  }, [visible, noteTitle]);

  useEffect(() => {
    if (step === 'title') {
      const timer = setTimeout(() => titleInputRef.current?.focus(), 120);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [step]);

  const handlePickGroup = (groupId: string | null) => {
    // The chat composer may still own the keyboard when this sheet opens.
    // Dismiss that keyboard before switching to the title step so the modal's
    // keyboard avoidance starts from its own TextInput instead of inheriting a
    // stale inset from the underlying chat screen.
    Keyboard.dismiss();
    setSelectedGroupId(groupId);
    setTitle(
      buildCollectedNoteTitle({
        groupName: groups.find((group) => group.id === groupId)?.name,
        username,
        originalTitle: noteTitle,
      }),
    );
    setStep('title');
  };

  const handleConfirm = () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    Keyboard.dismiss();
    onConfirm({ targetNoteGroupId: selectedGroupId, title: trimmed });
  };

  const d = {
    backdrop: { backgroundColor: colors.overlay },
    sheet: { backgroundColor: colors.surface },
    handle: { backgroundColor: colors.surfaceBorder },
    title: { color: colors.text },
    caption: { color: colors.textSecondary },
    row: { backgroundColor: colors.background, borderColor: colors.surfaceBorder },
    rowText: { color: colors.text },
    primary: { backgroundColor: colors.primary },
    primaryText: { color: colors.white },
  };

  return (
    <FloatingModal
      visible={visible}
      onClose={onClose}
      backdropStyle={d.backdrop}
      cardStyle={s.sheetWrap}
      closeOnBackdropPress={!saving}
      avoidKeyboard
    >
      <View style={[s.sheet, d.sheet, { paddingBottom: insets.bottom || Spacing.lg }]}>
        <View style={[s.handle, d.handle]} />
        <Text style={[s.title, d.title]}>
          {step === 'group'
            ? t('notes.collect.chooseGroup', { defaultValue: '添加到哪个笔记分组？' })
            : t('notes.collect.editTitle', { defaultValue: '编辑收藏标题' })}
        </Text>
        {step === 'group' ? (
          <>
            <Text style={[s.caption, d.caption]}>
              {t('notes.collect.groupHint', {
                defaultValue: '先选择分组，下一步可以修改标题。',
              })}
            </Text>
            {loading ? (
              <ActivityIndicator style={s.loader} color={colors.primary} />
            ) : error ? (
              <View style={s.errorBox}>
                <Text style={[s.caption, d.caption]}>{error}</Text>
                {onRetryGroups ? (
                  <Pressable onPress={onRetryGroups} style={s.retry}>
                    <Text style={{ ...Typography.small, color: colors.primary }}>
                      {t('common.retry', { defaultValue: '重试' })}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <ScrollView
                style={s.list}
                contentContainerStyle={s.listContent}
                {...keyboardDismissOnDragProps}
              >
                <Pressable
                  style={[s.row, d.row]}
                  onPress={() => handlePickGroup(null)}
                  accessibilityRole="button"
                >
                  <View style={[s.icon, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="folder-open-outline" size={18} color={colors.primary} />
                  </View>
                  <Text style={[s.rowText, d.rowText]}>
                    {t('notes.collect.ungrouped', { defaultValue: '未分组' })}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </Pressable>
                {groups.map((group) => (
                  <Pressable
                    key={group.id}
                    style={[s.row, d.row]}
                    onPress={() => handlePickGroup(group.id)}
                    accessibilityRole="button"
                  >
                    <View style={[s.icon, { backgroundColor: colors.primaryLight }]}>
                      <Ionicons name="folder-outline" size={18} color={colors.primary} />
                    </View>
                    <Text style={[s.rowText, d.rowText]} numberOfLines={1}>
                      {group.name}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </>
        ) : (
          <ScrollView
            style={s.titleScroll}
            contentContainerStyle={s.titleContent}
            bounces={false}
            {...keyboardDismissOnDragProps}
          >
            <Text style={[s.caption, d.caption]}>
              {t('notes.collect.titleHint', { defaultValue: '默认标题可以直接修改，保存后生成你的笔记副本。' })}
            </Text>
            <TextInput
              ref={titleInputRef}
              // Keep the input controlled by the draft. Falling back to the
              // default while `title` is empty makes clearing/replacing the
              // title impossible and leaves the save button looking active
              // even though the handler has nothing to persist.
              value={title}
              onChangeText={setTitle}
              style={[s.input, { color: colors.text, borderColor: colors.surfaceBorder }]}
              placeholder={defaultTitle}
              placeholderTextColor={colors.textSecondary}
              maxLength={120}
              returnKeyType="done"
              onSubmitEditing={handleConfirm}
              editable={!saving}
              accessibilityLabel={t('notes.collect.titleLabel', { defaultValue: '收藏标题' })}
            />
            <View style={s.actions}>
              <Pressable
                style={[s.secondaryButton, { borderColor: colors.surfaceBorder }]}
                onPress={() => {
                  Keyboard.dismiss();
                  setStep('group');
                }}
                disabled={saving}
              >
                <Text style={{ ...Typography.body, color: colors.text }}>
                  {t('common.back', { defaultValue: '上一步' })}
                </Text>
              </Pressable>
              <Pressable
                style={[s.primaryButton, d.primary, !title.trim() || saving ? s.disabled : null]}
                onPress={handleConfirm}
                disabled={saving || !title.trim()}
              >
                {saving ? <ActivityIndicator color={colors.white} /> : <Text style={{ ...Typography.body, color: colors.white }}>
                  {t('common.save', { defaultValue: '保存' })}
                </Text>}
              </Pressable>
            </View>
          </ScrollView>
        )}
      </View>
    </FloatingModal>
  );
}

const s = StyleSheet.create({
  sheetWrap: {
    width: '100%',
    alignSelf: 'stretch',
    borderRadius: Radius.xxl,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  sheet: {
    width: '100%',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    maxHeight: '100%',
    minHeight: 0,
    flexShrink: 1,
    borderRadius: Radius.xxl,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: Radius.full, marginBottom: Spacing.md },
  title: { ...Typography.h3, textAlign: 'center', marginBottom: Spacing.xs },
  caption: { ...Typography.small, textAlign: 'center', marginBottom: Spacing.md },
  loader: { marginVertical: Spacing.xl },
  errorBox: { alignItems: 'center', paddingVertical: Spacing.lg },
  retry: { padding: Spacing.sm },
  list: { maxHeight: 320 },
  listContent: { gap: Spacing.sm, paddingBottom: Spacing.sm },
  titleScroll: { flexShrink: 1, minHeight: 0 },
  titleContent: { paddingBottom: Spacing.xs },
  row: { minHeight: 52, borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 32, height: 32, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  rowText: { ...Typography.body, flex: 1 },
  input: { ...Typography.body, minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  secondaryButton: { flex: 1, minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { flex: 1, minHeight: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.55 },
});
