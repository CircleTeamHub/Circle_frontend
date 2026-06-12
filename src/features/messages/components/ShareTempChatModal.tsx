import { useMemo } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
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
  onShareSystem: (title: string, shareUrl: string) => void;
}

const QR_SIZE = 200;

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
  qrCard: {
    width: QR_SIZE + Spacing.lg * 2,
    height: QR_SIZE + Spacing.lg * 2,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkBox: {
    alignSelf: 'stretch',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  actions: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: Spacing.md,
  },
  actionButton: {
    flex: 1,
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
  onShareSystem,
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
      hint: {
        color: colors.textSecondary,
        ...Typography.caption,
        textAlign: 'center' as const,
      },
      qrCard: { backgroundColor: colors.white },
      linkBox: { backgroundColor: colors.surface },
      linkText: { color: colors.textSecondary, ...Typography.small },
      copyButton: { backgroundColor: colors.primary },
      copyText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      shareButton: {
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.surfaceBorder,
      },
      shareText: {
        color: colors.text,
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
      // 剪贴板不可用时退回系统分享面板（含复制项）。
      onShareSystem(title, shareUrl);
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
          <View style={[s.qrCard, d.qrCard]}>
            <QRCode
              value={shareUrl}
              size={QR_SIZE}
              color="#111111"
              backgroundColor="#FFFFFF"
            />
          </View>
          <Text style={d.hint}>{t('tempChats.scanHint')}</Text>

          <View style={[s.linkBox, d.linkBox]}>
            <Text
              style={d.linkText}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {shareUrl}
            </Text>
          </View>

          <View style={s.actions}>
            <Pressable
              style={[s.actionButton, d.copyButton]}
              onPress={() => void handleCopy()}
            >
              <Ionicons name="copy-outline" size={18} color={colors.white} />
              <Text style={d.copyText}>{t('tempChats.copyLink')}</Text>
            </Pressable>
            <Pressable
              style={[s.actionButton, d.shareButton]}
              onPress={() => onShareSystem(title, shareUrl)}
            >
              <Ionicons
                name="share-outline"
                size={18}
                color={colors.text}
              />
              <Text style={d.shareText}>{t('tempChats.shareSystem')}</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </BottomSheetModal>
  );
}
