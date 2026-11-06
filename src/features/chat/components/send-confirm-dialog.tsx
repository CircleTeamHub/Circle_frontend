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
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';

const PLACEHOLDER_ALPHA = 0.35;

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

/** 下划线:平时一条细线,聚焦时换成主题色粗线。 */
const UNDERLINE_IDLE = StyleSheet.hairlineWidth * 2;
const UNDERLINE_FOCUSED = 2;

const s = StyleSheet.create({
  card: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.md,
    borderRadius: Radius.xl,
  },
  title: {
    ...Typography.h3,
    fontWeight: '700',
  },
  // 要发的内容(「共 2 条笔记」、媒体缩略图)放进一块浅底,和下面的留言区分开。
  preview: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  captionField: {
    gap: Spacing.xs,
  },
  // 不垫底色:深色主题里输入框底色和卡片同色,框看不出来。改成一条下划线。
  input: {
    ...Typography.body,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 0,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  counter: {
    ...Typography.tinyRegular,
    alignSelf: 'flex-end',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: {
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  buttonText: {
    ...Typography.body,
    fontWeight: '600',
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
  const [focused, setFocused] = useState(false);

  // 每次打开都是一份新的附言,不把上一次没发出去的残留带到别的会话。
  useEffect(() => {
    if (visible) setCaption('');
  }, [visible]);

  const d = useMemo(
    () => ({
      card: { backgroundColor: colors.surface },
      title: { color: colors.text },
      preview: { backgroundColor: withAlpha(colors.text, 0.06) },
      input: { color: colors.text },
      underlineIdle: {
        borderBottomWidth: UNDERLINE_IDLE,
        borderBottomColor: withAlpha(colors.text, 0.25),
      },
      underlineFocused: {
        borderBottomWidth: UNDERLINE_FOCUSED,
        borderBottomColor: colors.primary,
      },
      counter: { color: withAlpha(colors.text, PLACEHOLDER_ALPHA) },
      cancel: { borderColor: withAlpha(colors.text, 0.25) },
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
        {children ? <View style={[s.preview, d.preview]}>{children}</View> : null}
        <View style={s.captionField}>
          <TextInput
            style={[s.input, d.input, focused ? d.underlineFocused : d.underlineIdle]}
            value={caption}
            onChangeText={setCaption}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            selectionColor={colors.primary}
            placeholder={placeholder}
            // 「给朋友留言（可选）」只是提示，用淡灰；暗色主题的 textSecondary 是纯白，太抢眼。
            placeholderTextColor={withAlpha(colors.text, PLACEHOLDER_ALPHA)}
            maxLength={SEND_CAPTION_MAX_LENGTH}
            multiline
            editable={!sending}
            accessibilityLabel={placeholder}
          />
          {caption.length > 0 ? (
            <Text style={[s.counter, d.counter]}>
              {caption.length}/{SEND_CAPTION_MAX_LENGTH}
            </Text>
          ) : null}
        </View>
        <View style={s.actions}>
          <Pressable
            style={[s.button, s.cancel, d.cancel]}
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
