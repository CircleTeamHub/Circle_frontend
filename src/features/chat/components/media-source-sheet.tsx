import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { useTheme, Radius, Spacing, Typography } from '@/theme';

export type MediaSourceAction = 'photo' | 'video' | 'camera';

interface MediaSourceSheetProps {
  visible: boolean;
  onSelect: (action: MediaSourceAction) => void;
  onClose: () => void;
}

const MEDIA_ACTIONS: readonly {
  id: MediaSourceAction;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
  fallback: string;
}[] = [
  {
    id: 'photo',
    icon: 'images-outline',
    labelKey: 'chat.attachments.mediaPhoto',
    fallback: '照片',
  },
  {
    id: 'video',
    icon: 'videocam-outline',
    labelKey: 'chat.attachments.mediaVideo',
    fallback: '视频',
  },
  {
    id: 'camera',
    icon: 'camera-outline',
    labelKey: 'chat.attachments.camera',
    fallback: '拍照',
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
  },
  header: {
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 60,
  },
  title: {
    ...Typography.h3,
    textAlign: 'center',
  },
  closeButton: {
    position: 'absolute',
    right: Spacing.md,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  action: {
    flex: 1,
    maxWidth: 104,
    minHeight: 102,
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.lg,
  },
  iconSurface: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
  },
  label: {
    ...Typography.body,
    textAlign: 'center',
  },
});

export function MediaSourceSheet({
  visible,
  onSelect,
  onClose,
}: MediaSourceSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      title: { color: colors.text },
      closeButton: { backgroundColor: colors.inputBg },
      iconSurface: {
        backgroundColor: colors.inputBg,
        borderColor: colors.surfaceBorder,
      },
      label: { color: colors.text },
    }),
    [colors],
  );

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      backdropStyle={d.backdrop}
      sheetStyle={[
        s.sheet,
        d.sheet,
        { paddingBottom: Math.max(insets.bottom, Spacing.md) },
      ]}
    >
      <View style={[s.handle, d.handle]} />
      <View style={s.header}>
        <Text style={[s.title, d.title]} numberOfLines={1}>
          {t('chat.attachments.mediaHub', { defaultValue: '自媒体' })}
        </Text>
        <Pressable
          style={({ pressed }) => [
            s.closeButton,
            d.closeButton,
            pressed && { opacity: 0.65 },
          ]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={s.actions}>
        {MEDIA_ACTIONS.map((action) => {
          const label = t(action.labelKey, { defaultValue: action.fallback });
          return (
            <Pressable
              key={action.id}
              style={({ pressed }) => [s.action, pressed && { opacity: 0.55 }]}
              onPress={() => {
                if (process.env.EXPO_OS === 'ios') {
                  void Haptics.selectionAsync();
                }
                onSelect(action.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={label}
            >
              <View style={[s.iconSurface, d.iconSurface]}>
                <Ionicons name={action.icon} size={28} color={colors.primary} />
              </View>
              <Text style={[s.label, d.label]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </BottomSheetModal>
  );
}
