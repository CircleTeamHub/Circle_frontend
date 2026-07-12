import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import type { NoteSummary } from '@/features/notes/types';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface NoteActionsSheetProps {
  /** 非空即打开菜单；菜单针对这条笔记 */
  note: NoteSummary | null;
  onClose: () => void;
  onPin: (note: NoteSummary) => void;
  onEdit: (note: NoteSummary) => void;
  onShare: (note: NoteSummary) => void;
  onUnlist: (note: NoteSummary) => void;
}

type NoteAction = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  destructive?: boolean;
  run: () => void;
};

export function NoteActionsSheet({
  note,
  onClose,
  onPin,
  onEdit,
  onShare,
  onUnlist,
}: NoteActionsSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      title: { color: colors.textSecondary },
      label: { color: colors.text },
      destructive: { color: colors.error },
      separator: { backgroundColor: colors.divider },
    }),
    [colors],
  );

  const actions: NoteAction[] = note
    ? [
        {
          key: 'pin',
          icon: note.pinned ? 'bookmark' : 'bookmark-outline',
          label: note.pinned
            ? t('notes.actions.unpin', { defaultValue: '取消置顶' })
            : t('notes.actions.pin', { defaultValue: '置顶' }),
          run: () => onPin(note),
        },
        {
          key: 'edit',
          icon: 'create-outline',
          label: t('notes.actions.edit', { defaultValue: '编辑' }),
          run: () => onEdit(note),
        },
        {
          key: 'share',
          icon: 'share-outline',
          label: t('notes.actions.share', { defaultValue: '分享' }),
          run: () => onShare(note),
        },
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

  return (
    <BottomSheetModal
      visible={note != null}
      onClose={onClose}
      backdropStyle={d.backdrop}
      sheetStyle={[s.sheet, d.sheet, { paddingBottom: insets.bottom || Spacing.lg }]}
    >
      <View style={[s.handle, d.handle]} />
      {note ? (
        <Text style={[s.title, d.title]} numberOfLines={1}>
          {note.title}
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
            <Ionicons
              name={action.icon}
              size={20}
              color={action.destructive ? colors.error : colors.text}
            />
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
