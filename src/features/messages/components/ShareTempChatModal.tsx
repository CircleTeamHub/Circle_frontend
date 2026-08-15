import { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface ShareTempChatModalProps {
  visible: boolean;
  title: string;
  shareUrl: string | null;
  onClose: () => void;
}

const s = StyleSheet.create({
  card: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.lg,
    alignItems: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  linkBox: {
    alignSelf: 'stretch',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  actionButton: {
    alignSelf: 'stretch',
    height: 48,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
});

export default function ShareTempChatModal({
  visible,
  title,
  shareUrl,
  onClose,
}: ShareTempChatModalProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },
      card: {
        backgroundColor: colors.background,
        paddingBottom: insets.bottom + Spacing.lg,
      },
      handle: { backgroundColor: colors.surfaceBorder },
      heading: { color: colors.text, ...Typography.h3 },
      linkBox: { backgroundColor: colors.surface },
      linkText: { color: colors.textSecondary, ...Typography.small },
      copyButton: { backgroundColor: colors.primary },
      copyText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors, insets.bottom],
  );

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(shareUrl);
      Alert.alert(t('tempChats.linkCopied'));
    } catch {
      Alert.alert(t('tempChats.copyFailed'));
    }
  };

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      backdropStyle={d.backdrop}
      sheetStyle={[s.card, d.card]}
    >
      <View style={[s.handle, d.handle]} />
      <Text style={d.heading} numberOfLines={1}>
        {title}
      </Text>

      {shareUrl ? (
        <>
          <View style={[s.linkBox, d.linkBox]}>
            <Text
              style={d.linkText}
              numberOfLines={1}
              ellipsizeMode="middle"
              selectable
            >
              {shareUrl}
            </Text>
          </View>

          <Pressable
            style={[s.actionButton, d.copyButton]}
            onPress={() => void handleCopy()}
          >
            <Ionicons name="copy-outline" size={18} color={colors.white} />
            <Text style={d.copyText}>{t('tempChats.copyLink')}</Text>
          </Pressable>
        </>
      ) : null}
    </BottomSheetModal>
  );
}
