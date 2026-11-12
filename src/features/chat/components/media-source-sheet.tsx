import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { useTheme, Radius, Spacing, Typography } from '@/theme';

/**
 * album:应用内相册选图后直接发送;edit:选一张照片进编辑器再发送;camera:拍照后进编辑器。
 * 相册与编辑发送都在选图页里填描述。
 */
export type MediaSourceAction = 'album' | 'camera' | 'edit';

interface MediaSourceSheetProps {
  visible: boolean;
  onSelect: (action: MediaSourceAction) => void;
  onClose: () => void;
  /** iOS:面板完全关闭后调用,下一个全屏弹层要等到这时才能弹出。 */
  onDismiss?: () => void;
}

const MEDIA_ACTIONS: readonly {
  id: MediaSourceAction;
  labelKey: string;
  fallback: string;
}[] = [
  {
    // 照片和视频在同一个相册里一起选,不再分两个入口。
    id: 'album',
    labelKey: 'chat.attachments.mediaAlbum',
    fallback: '相册',
  },
  {
    id: 'camera',
    labelKey: 'chat.attachments.camera',
    fallback: '拍照',
  },
  {
    id: 'edit',
    labelKey: 'chat.attachments.editAndSend',
    fallback: '编辑发送',
  },
];

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    paddingTop: Spacing.sm,
    borderCurve: 'continuous',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.xs,
  },
  row: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  label: {
    ...Typography.body,
    textAlign: 'center',
  },
  divider: {
    height: Spacing.sm,
  },
});

export function MediaSourceSheet({
  visible,
  onSelect,
  onClose,
  onDismiss,
}: MediaSourceSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      label: { color: colors.text },
      cancel: { color: colors.error },
      divider: { backgroundColor: colors.inputBg },
    }),
    [colors],
  );

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      backdropStyle={d.backdrop}
      sheetStyle={[
        s.sheet,
        d.sheet,
        { paddingBottom: Math.max(insets.bottom, Spacing.md) },
      ]}
    >
      <View style={[s.handle, d.handle]} />
      {MEDIA_ACTIONS.map((action) => {
        const label = t(action.labelKey, { defaultValue: action.fallback });
        return (
          <Pressable
            key={action.id}
            style={({ pressed }) => [s.row, pressed && { opacity: 0.55 }]}
            onPress={() => {
              if (process.env.EXPO_OS === 'ios') {
                void Haptics.selectionAsync();
              }
              onSelect(action.id);
            }}
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            <Text style={[s.label, d.label]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
      <View style={[s.divider, d.divider]} />
      <Pressable
        style={({ pressed }) => [s.row, pressed && { opacity: 0.55 }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
      >
        <Text style={[s.label, d.cancel]}>{t('common.cancel')}</Text>
      </Pressable>
    </BottomSheetModal>
  );
}
