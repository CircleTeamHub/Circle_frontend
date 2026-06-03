import { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface MomentCommentInputProps {
  replyTo: { id: string; nickname: string } | null;
  // onSubmit 可以返回 Promise；reject 时输入框保持打开（含已输入文本）让用户重试。
  // 仅在 resolve 时由父组件决定是否调用 onDismiss。
  onSubmit: (content: string, replyToId?: string) => void | Promise<void>;
  onDismiss: () => void;
}

const s = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
  },
  backdrop: {
    flex: 1,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    height: 36,
    borderRadius: Radius.xxl,
    paddingHorizontal: Spacing.md,
    ...Typography.bodyRegular,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export const MomentCommentInput: React.FC<MomentCommentInputProps> = ({
  replyTo,
  onSubmit,
  onDismiss,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed, replyTo?.id);
      // onSubmit 成功后由父组件决定是否调用 onDismiss（一般会清掉 commentTarget）。
      setText('');
    } catch {
      // 父组件已经处理过错误展示。这里只负责把 submitting 复位 + 输入文本保留。
    } finally {
      setSubmitting(false);
    }
  }, [text, submitting, replyTo, onSubmit]);

  return (
    <KeyboardAvoidingView
      style={s.overlay}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Tap backdrop to dismiss */}
      <Pressable style={s.backdrop} onPress={onDismiss} />

      {/* Input bar */}
      <View
        style={[
          s.container,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.divider,
            paddingBottom: insets.bottom || Spacing.sm,
          },
        ]}
      >
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder={
            replyTo
              ? t('discover.commentInput.replyTo', {
                  nickname: replyTo.nickname,
                  defaultValue: `回复 ${replyTo.nickname}`,
                })
              : t('discover.commentInput.placeholder', {
                  defaultValue: '写评论...',
                })
          }
          placeholderTextColor={colors.textSecondary}
          autoFocus
          onSubmitEditing={handleSend}
          returnKeyType="send"
          style={[
            s.input,
            { backgroundColor: colors.background, color: colors.text },
          ]}
        />
        <Pressable
          onPress={handleSend}
          disabled={submitting || !text.trim()}
          style={[
            s.sendBtn,
            {
              backgroundColor:
                text.trim() && !submitting
                  ? colors.primary
                  : colors.surfaceBorder,
            },
          ]}
        >
          <Ionicons name="send" size={16} color={colors.white} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
};
