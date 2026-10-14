import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import type { ChatMessage } from '@/types';

interface FailedMessageRetryProps {
  message: ChatMessage;
  onRetry: (message: ChatMessage) => void;
  children: ReactNode;
}

/** A separate retry target keeps media previews and card navigation usable. */
export function FailedMessageRetry({
  message,
  onRetry,
  children,
}: FailedMessageRetryProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  if (
    message.sendStatus !== 3 ||
    !message.deliveryId ||
    !(message.type === 'sent' || message.outgoing)
  ) {
    return <>{children}</>;
  }

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('chat.messageActions.retryFailed')}
        onPress={() => onRetry(message)}
        style={styles.button}
        hitSlop={6}
      >
        <Ionicons name="alert-circle" size={22} color={colors.error} />
      </Pressable>
      <View style={styles.bubble}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  button: { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  bubble: { flexShrink: 1 },
});
