import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import type { NoteSummary } from '@/features/notes/types';
import { setNoteRemark } from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

/** 与后端 SetNoteRemarkDto 的 NOTE_REMARK_MAX_LENGTH 对齐 */
const REMARK_MAX_LENGTH = 200;

interface NoteRemarkSheetProps {
  /** 非空即打开；携带当前备注做初始值 */
  note: NoteSummary | null;
  onClose: () => void;
  /** 保存成功（含清除）后回调，父层就地更新列表里的这条笔记 */
  onSaved: (noteId: string, remark: string | null) => void;
}

/** 备注编辑弹层：输入保存，留空保存即清除。API 调用收在组件内，父层只收结果。 */
export function NoteRemarkSheet({
  note,
  onClose,
  onSaved,
}: NoteRemarkSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // saving 状态要下一帧才重渲染;键盘 Done 和保存按钮同帧各触发一次 handleSave
  // 时都会读到旧的 saving=false。ref 同步生效,双击/双路只放行一次提交。
  const savingRef = useRef(false);

  // 针对哪条笔记打开就用哪条的现有备注起稿；关闭（note→null）时不动草稿。
  useEffect(() => {
    if (note) {
      setDraft(note.remark ?? '');
      setSaving(false);
      savingRef.current = false;
    }
  }, [note]);

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      title: { color: colors.text },
      caption: { color: colors.textSecondary },
      input: {
        color: colors.text,
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.background,
      },
      saveBtn: { backgroundColor: colors.primary },
      saveBtnText: { color: colors.white },
    }),
    [colors],
  );

  const handleSave = async () => {
    if (!note || savingRef.current) return;
    savingRef.current = true;
    const trimmed = draft.trim();
    const next = trimmed.length > 0 ? trimmed : null;
    setSaving(true);
    try {
      await setNoteRemark(note.id, next);
    } catch {
      savingRef.current = false;
      setSaving(false);
      Alert.alert(
        t('notes.alerts.remarkFailedTitle', { defaultValue: '备注保存失败' }),
        t('common.retryLater', { defaultValue: '请稍后重试' }),
      );
      return;
    }
    onSaved(note.id, next);
    onClose();
  };

  return (
    <BottomSheetModal
      visible={note != null}
      onClose={onClose}
      backdropStyle={d.backdrop}
      sheetStyle={s.sheetWrap}
    >
      {/* 输入框贴底，键盘弹起时整个面板上移 */}
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
            {t('notes.remarkSheet.title', { defaultValue: '备注' })}
          </Text>
          {note ? (
            <Text style={[s.caption, d.caption]} numberOfLines={1}>
              {note.title}
            </Text>
          ) : null}
          <TextInput
            style={[s.input, d.input]}
            value={draft}
            onChangeText={setDraft}
            placeholder={t('notes.remarkSheet.placeholder', {
              defaultValue: '输入备注，留空保存即清除',
            })}
            placeholderTextColor={colors.textSecondary}
            maxLength={REMARK_MAX_LENGTH}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void handleSave()}
          />
          <Pressable
            style={[s.saveBtn, d.saveBtn, saving ? s.saveBtnDisabled : null]}
            onPress={() => void handleSave()}
            disabled={saving}
            accessibilityRole="button"
          >
            <Text style={[s.saveBtnText, d.saveBtnText]}>
              {saving
                ? t('notes.remarkSheet.saving', { defaultValue: '保存中...' })
                : t('notes.remarkSheet.save', { defaultValue: '保存' })}
            </Text>
          </Pressable>
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
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.xs,
  },
  title: { ...Typography.h3, fontWeight: '700' },
  caption: { ...Typography.caption, fontWeight: '400' },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
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
