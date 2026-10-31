import { Animated, Easing, StyleSheet } from 'react-native';
import { useEffect, useRef } from 'react';
import { ChatBubbleIcon } from '@/components/app/chat-bubble-icon';

type AssistantAvatarProps = {
  size?: number;
  spinning?: boolean;
};

export function AssistantAvatar({ size = 40, spinning = false }: AssistantAvatarProps) {
  const rotation = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!spinning) {
      animationRef.current?.stop();
      animationRef.current = null;
      rotation.stopAnimation(() => {
        rotation.setValue(0);
      });
      return;
    }

    animationRef.current?.stop();
    const animation = Animated.loop(
      Animated.timing(rotation, {
        duration: 820,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    animationRef.current = animation;
    animation.start();

    return () => {
      animation.stop();
      if (animationRef.current === animation) animationRef.current = null;
    };
  }, [rotation, spinning]);

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      accessible={false}
      pointerEvents="none"
      style={[styles.container, { width: size, height: size, transform: [{ rotate }] }]}
    >
      <ChatBubbleIcon size={size} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
