import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { FloatingModal } from '@/components/ui/floating-modal';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

/** 附言是一句话的补充说明,不当长文输入框用。 */
export const SEND_CAPTION_MAX_LENGTH = 500;

interface SendConfirmDialogProps {
  visible: boolean;
  title: string;
  /** 标题下方的内容预览(转发对象、待发媒体缩略图等)。 */
  children?: ReactNode;
  placeholder: string;
  sending?: boolean;
  confirmLabel?: string;
  onCancel: () => void;
  /** caption 已去掉首尾空白,没填时是空字符串。 */
  onConfirm: (caption: string) => void;
}

const s = StyleSheet.create({
  card: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  title: {
    ...Typography.h3,
  },
  input: {
    ...Typography.body,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    ...Typography.body,
  },
});

/**
 * 发送前的确认弹窗:展示要发的内容,并允许附一句话。
 * 附言在调用方那边作为一条独立文字消息,排在被发送的内容之后。
 */
export function SendConfirmDialog({
  visible,
  title,
  children,
  placeholder,
  sending = false,
  confirmLabel,
  onCancel,
  onConfirm,
}: SendConfirmDialogProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [caption, setCaption] = useState('');

  // 每次打开都是一份新的附言,不把上一次没发出去的残留带到别的会话。
  useEffect(() => {
    if (visible) setCaption('');
  }, [visible]);

  const d = useMemo(
    () => ({
      card: { backgroundColor: colors.surface },
      title: { color: colors.text },
      input: { backgroundColor: colors.inputBg, color: colors.text },
      cancel: { backgroundColor: colors.inputBg },
      cancelText: { color: colors.text },
      confirm: { backgroundColor: colors.primary },
      confirmText: { color: colors.white },
    }),
    [colors],
  );

  return (
    <FloatingModal
      visible={visible}
      onClose={onCancel}
      backdropStyle={{ backgroundColor: colors.overlay }}
      closeOnBackdropPress={!sending}
    >
      <View style={[s.card, d.card]}>
        <Text style={[s.title, d.title]} numberOfLines={2}>
          {title}
        </Text>
        {children}
        <TextInput
          style={[s.input, d.input]}
          value={caption}
          onChangeText={setCaption}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          maxLength={SEND_CAPTION_MAX_LENGTH}
          multiline
          editable={!sending}
          accessibilityLabel={placeholder}
        />
        <View style={s.actions}>
          <Pressable
            style={[s.button, d.cancel]}
            onPress={onCancel}
            disabled={sending}
            accessibilityRole="button"
          >
            <Text style={[s.buttonText, d.cancelText]}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            style={[s.button, d.confirm, sending && { opacity: 0.6 }]}
            onPress={() => onConfirm(caption.trim())}
            disabled={sending}
            accessibilityRole="button"
          >
            {sending ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={[s.buttonText, d.confirmText]}>
                {confirmLabel ?? t('common.send')}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </FloatingModal>
  );
}
