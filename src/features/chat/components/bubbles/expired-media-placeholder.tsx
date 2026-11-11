import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, Typography, useTheme } from '@/theme';

interface ExpiredMediaPlaceholderProps {
  kind: 'image' | 'video';
  /** 占住原媒体的尺寸,气泡不塌、列表不跳。 */
  style?: StyleProp<ViewStyle>;
}

const LABEL_KEYS = {
  image: 'chat.detail.imageExpired',
  video: 'chat.detail.videoExpired',
} as const;

const s = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.sm,
  },
  label: { ...Typography.small, marginTop: Spacing.xs, textAlign: 'center' },
});

/** 图片 / 视频过了服务端保留期:对象已删,气泡里写明「已过期」。 */
export const ExpiredMediaPlaceholder: React.FC<ExpiredMediaPlaceholderProps> = ({
  kind,
  style,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const label = t(LABEL_KEYS[kind]);
  return (
    <View
      testID="chat-media-expired"
      accessibilityLabel={label}
      style={[s.box, { backgroundColor: colors.surfaceBorder }, style]}
    >
      <Ionicons name="time-outline" size={30} color={colors.textSecondary} />
      <Text style={[s.label, { color: colors.text }]}>{label}</Text>
    </View>
  );
};
