import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { NOTE_RATING_BAD_ICON, NOTE_RATING_GOOD_ICON } from '@/features/notes/components/NoteRatingCounts';
import type { NoteSummary } from '@/features/notes/types';
import {
  NOTE_WORK_STATUS_ICON,
  type SetNoteWorkStatus,
} from '@/features/notes/utils/work-status';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface NoteActionsSheetProps {
  /** 非空即打开菜单；菜单针对这条笔记 */
  note: NoteSummary | null;
  /** 当前登录用户，用于兼容旧接口缺少 canEdit 时的源笔记所有权判断。 */
  currentUserId?: string | null;
  /**
   * 非空数组即打开批量菜单(多选「下一步」)。动作集合与单选一致
   * (多选项和单条状态设置除外——状态只允许逐条修改)，逐项作用于整个选中集。
   */
  batchNotes?: NoteSummary[] | null;
  onClose: () => void;
  onPin: (note: NoteSummary) => void;
  /** 进入多选模式（并选中当前笔记） */
  onMultiSelect?: (note: NoteSummary) => void;
  /** 收藏副本：给来源笔记打好评 / 差评。 */
  onRateGood?: (note: NoteSummary) => void;
  onRateBad?: (note: NoteSummary) => void;
  /** 自己的源笔记：查看收到的差评（不能给自己打分）。 */
  onViewBadRatings?: (note: NoteSummary) => void;
  /** 打开备注编辑弹层 */
  onRemark?: (note: NoteSummary) => void;
  onEdit: (note: NoteSummary) => void;
  /** 打开分组勾选弹层（替换该笔记的分组归属） */
  onEditGroups?: (note: NoteSummary) => void;
  onShare: (note: NoteSummary) => void;
  /** 软删除进回收站（30 天内可恢复） */
  onDelete?: (note: NoteSummary) => void;
  onUnlist: (note: NoteSummary) => void;
  /** 仅源笔记可用；收藏副本由 source status 统一跟随原笔记。 */
  onSetWorkStatus?: (
    note: NoteSummary,
    workStatus: SetNoteWorkStatus,
  ) => void;
  /** 批量置顶/取消置顶（pinned = 目标状态，由「是否全部已置顶」推导） */
  onBatchPin?: (notes: NoteSummary[], pinned: boolean) => void;
  onBatchRemark?: (notes: NoteSummary[]) => void;
  onBatchEditGroups?: (notes: NoteSummary[]) => void;
  onBatchShare?: (notes: NoteSummary[]) => void;
  onBatchUnlist?: (notes: NoteSummary[]) => void;
  onBatchDelete?: (notes: NoteSummary[]) => void;
}

type NoteAction = {
  key: string;
  label: string;
  destructive?: boolean;
  run: () => void;
} & (
  | { icon: keyof typeof Ionicons.glyphMap; mciIcon?: never }
  /** For glyphs Ionicons lacks (the note rating 烟花 / 乌云). */
  | { mciIcon: keyof typeof MaterialCommunityIcons.glyphMap; icon?: never }
);

export function NoteActionsSheet({
  note,
  currentUserId,
  batchNotes,
  onClose,
  onPin,
  onMultiSelect,
  onRateGood,
  onRateBad,
  onViewBadRatings,
  onRemark,
  onEdit,
  onEditGroups,
  onShare,
  onDelete,
  onUnlist,
  onSetWorkStatus,
  onBatchPin,
  onBatchRemark,
  onBatchEditGroups,
  onBatchShare,
  onBatchUnlist,
  onBatchDelete,
}: NoteActionsSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      title: { color: colors.text },
      label: { color: colors.text },
      destructive: { color: colors.error },
      separator: { backgroundColor: colors.divider },
    }),
    [colors],
  );

  // 批量态：动作集合与单选一致（多选项除外），作用于整个选中集。
  const batch = batchNotes && batchNotes.length > 0 ? batchNotes : null;
  const allPinned = batch ? batch.every((item) => item.pinned) : false;
  const canManageWorkStatus = Boolean(
    note &&
      onSetWorkStatus &&
      !note.collectedFrom &&
      (note.canEdit === true ||
        (Boolean(currentUserId) && note.ownerId === currentUserId)),
  );

  const batchActions: NoteAction[] = batch
    ? [
        ...(onBatchPin
          ? [
              {
                key: 'pin',
                icon: allPinned
                  ? ('bookmark' as const)
                  : ('bookmark-outline' as const),
                label: allPinned
                  ? t('notes.actions.unpin', { defaultValue: '取消置顶' })
                  : t('notes.actions.pin', { defaultValue: '置顶' }),
                run: () => onBatchPin(batch, !allPinned),
              },
            ]
          : []),
        ...(onBatchRemark
          ? [
              {
                key: 'remark',
                icon: 'pricetag-outline' as const,
                label: t('notes.actions.remark', { defaultValue: '备注' }),
                run: () => onBatchRemark(batch),
              },
            ]
          : []),
        ...(onBatchEditGroups
          ? [
              {
                key: 'edit-groups',
                icon: 'albums-outline' as const,
                label: t('notes.actions.editGroups', { defaultValue: '编辑分组' }),
                run: () => onBatchEditGroups(batch),
              },
            ]
          : []),
        ...(onBatchShare
          ? [
              {
                key: 'share',
                icon: 'share-outline' as const,
                label: t('notes.actions.share', { defaultValue: '分享' }),
                run: () => onBatchShare(batch),
              },
            ]
          : []),
        ...(onBatchDelete
          ? [
              {
                key: 'delete',
                icon: 'trash-outline' as const,
                label: t('notes.actions.delete', { defaultValue: '删除' }),
                destructive: true,
                run: () => onBatchDelete(batch),
              },
            ]
          : []),
        // 全部已下架时不再出现下架项（与单选对 UNLISTED 隐藏一致）。
        ...(onBatchUnlist && batch.some((item) => item.status !== 'UNLISTED')
          ? [
              {
                key: 'unlist',
                icon: 'archive-outline' as const,
                label: t('notes.actions.unlist', { defaultValue: '下架' }),
                destructive: true,
                run: () => onBatchUnlist(batch),
              },
            ]
          : []),
      ]
    : [];

  const singleActions: NoteAction[] = note
    ? [
        {
          key: 'pin',
          icon: note.pinned ? 'bookmark' : 'bookmark-outline',
          label: note.pinned
            ? t('notes.actions.unpin', { defaultValue: '取消置顶' })
            : t('notes.actions.pin', { defaultValue: '置顶' }),
          run: () => onPin(note),
        },
        // Ratings belong to the source note: a collected copy rates it, the
        // owner's own source note lists what it received instead.
        ...(note.collectedFrom && onRateGood && onRateBad
          ? [
              {
                key: 'rate-good',
                mciIcon: NOTE_RATING_GOOD_ICON,
                label: t('notes.rating.actionGood', { defaultValue: '好评' }),
                run: () => onRateGood(note),
              },
              {
                key: 'rate-bad',
                mciIcon: NOTE_RATING_BAD_ICON,
                label: t('notes.rating.actionBad', { defaultValue: '差评' }),
                run: () => onRateBad(note),
              },
            ]
          : []),
        ...(!note.collectedFrom && onViewBadRatings
          ? [
              {
                key: 'view-bad-ratings',
                mciIcon: NOTE_RATING_BAD_ICON,
                label: t('notes.rating.viewBad', { defaultValue: '查看差评' }),
                run: () => onViewBadRatings(note),
              },
            ]
          : []),
        ...(onMultiSelect
          ? [
              {
                key: 'multi-select',
                icon: 'checkmark-done-outline' as const,
                label: t('notes.actions.multiSelect', { defaultValue: '多选' }),
                run: () => onMultiSelect(note),
              },
            ]
          : []),
        ...(onRemark
          ? [
              {
                key: 'remark',
                icon: 'pricetag-outline' as const,
                label: t('notes.actions.remark', { defaultValue: '备注' }),
                run: () => onRemark(note),
              },
            ]
          : []),
        {
          key: 'edit',
          icon: 'create-outline',
          label: t('notes.actions.editNote', { defaultValue: '编辑笔记' }),
          run: () => onEdit(note),
        },
        ...(onEditGroups
          ? [
              {
                key: 'edit-groups',
                icon: 'albums-outline' as const,
                label: t('notes.actions.editGroups', {
                  defaultValue: '编辑分组',
                }),
                run: () => onEditGroups(note),
              },
            ]
          : []),
        ...(canManageWorkStatus
          ? [
              {
                key: 'work-status-closed',
                icon: 'moon-outline' as const,
                label: t('chat.groupManagement.noteClosed', {
                  defaultValue: '打烊',
                }),
                run: () => onSetWorkStatus?.(note, 'CLOSED'),
              },
              {
                key: 'work-status-working',
                icon: 'sunny-outline' as const,
                label: t('chat.groupManagement.noteWorking', {
                  defaultValue: '开工',
                }),
                run: () => onSetWorkStatus?.(note, 'WORKING'),
              },
              {
                key: 'work-status-off-shelf',
                // 场地「下架」只是一个状态标记,笔记照样对所有人可见;和下面真正把
                // 笔记下架(UNLISTED)的那一项用不同的图标和文案,避免误以为已隐藏。
                icon: NOTE_WORK_STATUS_ICON.OFF_SHELF,
                label: t('notes.actions.venueOffShelf', {
                  defaultValue: '场地下架',
                }),
                run: () => onSetWorkStatus?.(note, 'OFF_SHELF'),
              },
            ]
          : []),
        {
          key: 'share',
          icon: 'share-outline',
          label: t('notes.actions.share', { defaultValue: '分享' }),
          run: () => onShare(note),
        },
        ...(onDelete
          ? [
              {
                key: 'delete',
                icon: 'trash-outline' as const,
                label: t('notes.actions.delete', { defaultValue: '删除' }),
                destructive: true,
                run: () => onDelete(note),
              },
            ]
          : []),
        ...(note.status === 'UNLISTED'
          ? []
          : [
              {
                key: 'unlist',
                icon: 'archive-outline' as const,
                label: t('notes.actions.unlist', { defaultValue: '下架' }),
                destructive: true,
                run: () => onUnlist(note),
              },
            ]),
      ]
    : [];

  const actions = batch ? batchActions : singleActions;
  const title = batch
    ? t('notes.selection.selectedCount', {
        count: batch.length,
        defaultValue: `已选 ${batch.length} 项`,
      })
    : note?.title;

  return (
    <BottomSheetModal
      visible={note != null || batch != null}
      onClose={onClose}
      backdropStyle={d.backdrop}
      sheetStyle={[s.sheet, d.sheet, { paddingBottom: insets.bottom || Spacing.lg }]}
    >
      <View style={[s.handle, d.handle]} />
      {title ? (
        <Text style={[s.title, d.title]} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      {actions.map((action, index) => (
        <View key={action.key}>
          {index > 0 ? <View style={[s.separator, d.separator]} /> : null}
          <Pressable
            style={s.row}
            onPress={() => {
              action.run();
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            {action.mciIcon ? (
              <MaterialCommunityIcons
                name={action.mciIcon}
                size={20}
                color={action.destructive ? colors.error : colors.text}
              />
            ) : (
              <Ionicons
                name={action.icon}
                size={20}
                color={action.destructive ? colors.error : colors.text}
              />
            )}
            <Text
              style={[s.label, action.destructive ? d.destructive : d.label]}
            >
              {action.label}
            </Text>
          </Pressable>
        </View>
      ))}
    </BottomSheetModal>
  );
}

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.sm,
  },
  title: {
    ...Typography.caption,
    fontWeight: '400',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    minHeight: 54,
  },
  label: { ...Typography.body },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.lg + 20 + Spacing.md,
  },
});
