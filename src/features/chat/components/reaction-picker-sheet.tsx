import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { EmojiPicker } from './emoji-picker';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface ReactionPickerSheetProps {
  visible: boolean;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const s = StyleSheet.create({
  sheet: { borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, paddingTop: Spacing.sm },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: Radius.full },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.lg },
  title: { ...Typography.h3 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

export function ReactionPickerSheet({ visible, onSelect, onClose }: ReactionPickerSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      avoidKeyboard={false}
      sheetStyle={[s.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom || Spacing.lg }]}
    >
      <View style={[s.handle, { backgroundColor: colors.surfaceBorder }]} />
      <View style={s.header}>
        <Text style={[s.title, { color: colors.text }]}>{t('chat.messageActions.react')}</Text>
        <Pressable style={s.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>
      <EmojiPicker onSelect={onSelect} />
    </BottomSheetModal>
  );
}
