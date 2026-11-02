import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import type { ChatMessage } from '@/types';

interface FailedMessageRetryProps {
  message: ChatMessage;
  onRetry: (message: ChatMessage) => void;
  children: ReactNode;
}

// Widest outgoing row: plaza poster card 264 + gap 8 + avatar 36, plus the 32pt
// retry target and the list's 2pt side insets. Narrower screens (320pt) stack the
// retry under the row so a fixed-width card is never pushed off screen.
const MIN_WIDTH_FOR_SIDE_RETRY = 344;

/** A separate retry target keeps media previews and card navigation usable. */
export function FailedMessageRetry({
  message,
  onRetry,
  children,
}: FailedMessageRetryProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  if (
    message.sendStatus !== 3 ||
    !message.deliveryId ||
    !(message.type === 'sent' || message.outgoing)
  ) {
    return <>{children}</>;
  }

  return (
    <View
      testID="failed-message-retry"
      style={width >= MIN_WIDTH_FOR_SIDE_RETRY ? styles.row : styles.stacked}
    >
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
  stacked: { flexDirection: 'column-reverse', alignItems: 'flex-end' },
  button: { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  bubble: { flexShrink: 1 },
});
