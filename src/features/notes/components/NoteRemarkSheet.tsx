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
import { runNoteBatch } from '@/features/notes/utils/batch-run';
import { setNoteRemark } from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

/** 与后端 SetNoteRemarkDto 的 NOTE_REMARK_MAX_LENGTH 对齐 */
const REMARK_MAX_LENGTH = 200;

interface NoteRemarkSheetProps {
  /**
   * 非空数组即打开。单条 = [note]（携带现有备注做初始值）；
   * 多条 = 多选「下一步」→「备注」，同一段文字写到每条选中笔记上。
   */
  notes: NoteSummary[] | null;
  onClose: () => void;
  /** 保存成功（含清除）后回调；批量部分失败时只带成功的那部分 id */
  onSaved: (noteIds: string[], remark: string | null) => void;
}

/** 备注编辑弹层：输入保存，留空保存即清除。API 调用收在组件内，父层只收结果。 */
export function NoteRemarkSheet({
  notes,
  onClose,
  onSaved,
}: NoteRemarkSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const targets = notes && notes.length > 0 ? notes : null;

  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // saving 状态要下一帧才重渲染;键盘 Done 和保存按钮同帧各触发一次 handleSave
  // 时都会读到旧的 saving=false。ref 同步生效,双击/双路只放行一次提交。
  const savingRef = useRef(false);

  // 打开时起稿：单条用它现有的备注；批量在所有选中项备注一致时预填该值，
  // 否则从空白起（保存会统一覆盖）。关闭（notes→null）时不动草稿。
  useEffect(() => {
    if (!targets) return;
    const first = targets[0]?.remark ?? '';
    const shared = targets.every((item) => (item.remark ?? '') === first);
    setDraft(shared ? first : '');
    setSaving(false);
    savingRef.current = false;
    // targets 是每次 render 派生的新数组，依赖 notes 本体避免无限重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

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
    if (!targets || savingRef.current) return;
    savingRef.current = true;
    const trimmed = draft.trim();
    const next = trimmed.length > 0 ? trimmed : null;
    setSaving(true);
    // 单条与批量同一条路径：并发限流 settle，失败的逐条重试语义与其他批量操作一致。
    const { failed } = await runNoteBatch(
      targets.map((item) => item.id),
      (id) => setNoteRemark(id, next),
    );
    if (failed.length === targets.length) {
      // 一条都没保存上：保持弹层与草稿，直接原地重试。
      savingRef.current = false;
      setSaving(false);
      Alert.alert(
        t('notes.alerts.remarkFailedTitle', { defaultValue: '备注保存失败' }),
        t('common.retryLater', { defaultValue: '请稍后重试' }),
      );
      return;
    }
    const failedSet = new Set(failed);
    onSaved(
      targets.map((item) => item.id).filter((id) => !failedSet.has(id)),
      next,
    );
    if (failed.length > 0) {
      Alert.alert(
        t('notes.alerts.batchFailedTitle', { defaultValue: '部分操作失败' }),
        t('notes.alerts.batchPartialFailed', {
          count: failed.length,
          defaultValue: `有 ${failed.length} 条笔记操作失败，已保留选中，请重试。`,
        }),
      );
    }
    onClose();
  };

  return (
    <BottomSheetModal
      visible={targets != null}
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
            {targets && targets.length > 1
              ? t('notes.remarkSheet.batchTitle', {
                  count: targets.length,
                  defaultValue: `批量备注（${targets.length} 条）`,
                })
              : t('notes.remarkSheet.title', { defaultValue: '备注' })}
          </Text>
          {targets?.length === 1 ? (
            <Text style={[s.caption, d.caption]} numberOfLines={1}>
              {targets[0].title}
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
