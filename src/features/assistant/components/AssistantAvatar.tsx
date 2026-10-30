import { StyleSheet, View } from 'react-native';
import { ChatBubbleIcon } from '@/components/app/chat-bubble-icon';

type AssistantAvatarProps = {
  size?: number;
};

export function AssistantAvatar({ size = 40 }: AssistantAvatarProps) {
  return (
    <View
      accessible={false}
      pointerEvents="none"
      style={[styles.container, { width: size, height: size }]}
    >
      <ChatBubbleIcon size={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
