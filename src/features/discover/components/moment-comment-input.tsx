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
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface MomentCommentInputProps {
  replyTo: { id: string; nickname: string } | null;
  onSubmit: (content: string, replyToId?: string) => void;
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
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed, replyTo?.id);
    setText('');
    onDismiss();
  }, [text, replyTo, onSubmit, onDismiss]);

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
          placeholder={replyTo ? `回复 ${replyTo.nickname}` : '写评论...'}
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
          style={[
            s.sendBtn,
            {
              backgroundColor: text.trim()
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
