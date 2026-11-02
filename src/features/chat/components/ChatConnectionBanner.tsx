import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { getChatConnectionNotice } from '@/chat-core/connection-notice';
import { useChatStore } from '@/chat-core/store';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface ChatConnectionBannerProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * 连不上聊天服务器时的常驻横条(消息列表、聊天页)。连上就自动收起。
 * 会话和消息都有本地缓存,没有这条提示时,服务器整个没了 App 看起来也一切正常,
 * 发出去的消息只是一直停在「发送中」。何时显示见 getChatConnectionNotice。
 */
export function ChatConnectionBanner({ style }: ChatConnectionBannerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const notice = useChatStore(getChatConnectionNotice);
  if (!notice) return null;

  return (
    <View
      testID="chat-connection-banner"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: colors.warning }, style]}
    >
      <Ionicons name="cloud-offline-outline" size={15} color={colors.white} />
      <Text style={[styles.text, { color: colors.white }]}>
        {t(
          notice === 'unreachable'
            ? 'messages.imServerUnreachable'
            : 'messages.imServerError',
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  text: {
    ...Typography.small,
    fontWeight: '600',
    flexShrink: 1,
  },
});
