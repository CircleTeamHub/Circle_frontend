import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface NoteShareQrSheetProps {
  visible: boolean;
  title: string;
  shareUrl: string;
  noteCount: number;
  loading: boolean;
  errorMessage: string | null;
  onClose: () => void;
}

const QR_SIZE = 196;

export function NoteShareQrSheet({
  visible,
  title,
  shareUrl,
  noteCount,
  loading,
  errorMessage,
  onClose,
}: NoteShareQrSheetProps) {
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
      qrPlaceholder: { color: colors.textSecondary, ...Typography.body },
      errorText: {
        color: colors.error,
        ...Typography.caption,
        textAlign: 'center' as const,
      },
      linkBox: { backgroundColor: colors.surface },
      linkText: { color: colors.textSecondary, ...Typography.small },
      primaryButton: { backgroundColor: colors.primary },
      primaryText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      secondaryButton: {
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.surfaceBorder,
      },
      secondaryText: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors, insets.bottom],
  );

  const shareMessage = t('notes.share.message', {
    title,
    url: shareUrl,
    defaultValue: `${title}\n${shareUrl}`,
  });

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(shareUrl);
      Alert.alert(
        t('notes.share.copiedTitle', { defaultValue: '已复制' }),
        t('notes.share.copiedMessage', {
          defaultValue: '笔记链接已复制到剪贴板。',
        }),
      );
    } catch {
      await Share.share({ message: shareMessage });
    }
  };

  const handleShare = async () => {
    if (!shareUrl) return;
    try {
      await Share.share({ message: shareMessage });
    } catch {
      Alert.alert(
        t('notes.share.failedTitle', { defaultValue: '分享失败' }),
        t('notes.share.failedMessage', {
          defaultValue: '无法打开系统分享面板，请稍后重试。',
        }),
      );
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={[s.backdrop, d.backdrop]} onPress={onClose}>
        <Pressable style={[s.card, d.card]} onPress={() => {}}>
          <View style={[s.handle, d.handle]} />
          <Text style={d.heading}>
            {t('notes.share.qrTitle', { defaultValue: '笔记二维码' })}
          </Text>
          <Text style={d.hint}>
            {t('notes.share.qrHint', {
              count: noteCount,
              defaultValue: `扫码打开当前笔记列表（${noteCount} 条）。`,
            })}
          </Text>

          <View style={[s.qrCard, d.qrCard]}>
            {loading ? (
              <ActivityIndicator color={colors.primary} />
            ) : shareUrl ? (
              <QRCode
                value={shareUrl}
                size={QR_SIZE}
                color="#111111"
                backgroundColor="#FFFFFF"
              />
            ) : (
              <Text style={d.qrPlaceholder}>
                {t('notes.share.waitingForLink', { defaultValue: '正在生成链接' })}
              </Text>
            )}
          </View>

          {errorMessage ? <Text style={d.errorText}>{errorMessage}</Text> : null}

          <View style={[s.linkBox, d.linkBox]}>
            <Text style={d.linkText} numberOfLines={1} ellipsizeMode="middle">
              {shareUrl ||
                t('notes.share.linkPending', { defaultValue: '分享链接生成中...' })}
            </Text>
          </View>

          <View style={s.actions}>
            <Pressable
              style={[s.actionButton, d.primaryButton]}
              onPress={() => void handleCopy()}
              disabled={!shareUrl}
            >
              <Ionicons name="copy-outline" size={18} color={colors.white} />
              <Text style={d.primaryText}>
                {t('notes.share.copyLink', { defaultValue: '复制链接' })}
              </Text>
            </Pressable>
            <Pressable
              style={[s.actionButton, d.secondaryButton]}
              onPress={() => void handleShare()}
              disabled={!shareUrl}
            >
              <Ionicons name="share-outline" size={18} color={colors.text} />
              <Text style={d.secondaryText}>
                {t('notes.share.systemShare', { defaultValue: '系统分享' })}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  card: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.md,
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
