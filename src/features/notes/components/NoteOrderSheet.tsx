import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NoteSummary } from '@/features/notes/types';
import { moveToFront } from '@/features/notes/utils/note-sort';
import { useDragReorder } from '@/hooks/use-drag-reorder';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const ROW_HEIGHT = 56;
const ROW_STRIDE = ROW_HEIGHT + Spacing.sm;

type Props = {
  visible: boolean;
  /** 当前分组里按手动顺序排好的笔记。 */
  notes: readonly NoteSummary[];
  onClose: () => void;
  /** 顺序变了就回调新的 id 顺序（只含这组笔记）。 */
  onReorder: (nextIds: string[]) => void;
};

/**
 * 手动排序：按住左侧拖柄上下拖，或点右侧箭头把一条移到最前（几百条笔记时不用一路拖上去）。
 * 置顶的笔记在列表里始终排最前，拖到它们上面也会回到置顶之后。
 */
export function NoteOrderSheet({ visible, notes, onClose, onReorder }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const ids = useMemo(() => notes.map((note) => note.id), [notes]);
  const byId = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const { orderedIds, draggingId, dragY, getHandlers } = useDragReorder({
    ids,
    rowStride: ROW_STRIDE,
    onCommit: onReorder,
  });
  const untitled = t('notes.edit.untitledNote', { defaultValue: '未命名笔记' });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View
        style={[
          s.screen,
          { backgroundColor: colors.background, paddingTop: insets.top + Spacing.sm, paddingBottom: insets.bottom },
        ]}
      >
        <View style={s.header}>
          <Text style={[s.title, { color: colors.text }]}>
            {t('notes.sort.adjust', { defaultValue: '调整顺序' })}
          </Text>
          <Pressable style={s.done} hitSlop={8} accessibilityRole="button" onPress={onClose}>
            <Text style={[s.doneText, { color: colors.link }]}>
              {t('notes.sort.done', { defaultValue: '完成' })}
            </Text>
          </Pressable>
        </View>
        <Text style={[s.hint, { color: colors.textSecondary }]}>
          {t('notes.sort.adjustHint', { defaultValue: '按住左侧拖动调整位置，点右侧箭头移到最前' })}
        </Text>
        <ScrollView
          style={s.list}
          contentContainerStyle={s.listContent}
          scrollEnabled={!draggingId}
        >
          {orderedIds.map((id, index) => {
            const note = byId.get(id);
            if (!note) return null;
            const dragging = draggingId === id;
            const title = note.title || untitled;
            return (
              <Animated.View
                key={id}
                style={[
                  s.row,
                  { backgroundColor: colors.surface },
                  dragging
                    ? { transform: [{ translateY: dragY }], zIndex: 2 }
                    : draggingId
                      ? s.rowDimmed
                      : null,
                ]}
              >
                <View
                  {...getHandlers(id)}
                  style={s.handle}
                  accessibilityLabel={t('notes.sort.dragHandle', { defaultValue: '拖动调整位置' })}
                >
                  <Ionicons name="reorder-three-outline" size={20} color={colors.textSecondary} />
                </View>
                {note.pinned ? <Ionicons name="pin" size={14} color={colors.primary} /> : null}
                <Text style={[s.rowTitle, { color: colors.text }]} numberOfLines={1}>
                  {title}
                </Text>
                {index > 0 ? (
                  <Pressable
                    style={s.toFront}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('notes.sort.moveToFront', { title, defaultValue: '把「{{title}}」移到最前' })}
                    disabled={Boolean(draggingId)}
                    onPress={() => onReorder(moveToFront(orderedIds, id))}
                  >
                    <Ionicons name="arrow-up-circle-outline" size={22} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
              </Animated.View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  title: { ...Typography.h3, fontWeight: '700' },
  done: { minHeight: 44, justifyContent: 'center' },
  doneText: { ...Typography.body, fontWeight: '600' },
  hint: { ...Typography.small },
  list: { flex: 1 },
  listContent: { gap: Spacing.sm, paddingTop: Spacing.sm, paddingBottom: Spacing.lg },
  row: {
    height: ROW_HEIGHT,
    borderRadius: Radius.md,
    paddingRight: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  rowDimmed: { opacity: 0.78 },
  handle: { width: 44, height: ROW_HEIGHT, justifyContent: 'center', alignItems: 'center' },
  rowTitle: { ...Typography.bodyRegular, flex: 1 },
  toFront: { width: 32, height: 44, justifyContent: 'center', alignItems: 'flex-end' },
});
