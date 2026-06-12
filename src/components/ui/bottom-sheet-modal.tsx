import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface BottomSheetModalProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  backdropStyle?: StyleProp<ViewStyle>;
  sheetStyle?: StyleProp<ViewStyle>;
  closeOnBackdropPress?: boolean;
  statusBarTranslucent?: boolean;
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  content: {
    width: '100%',
  },
});

export function BottomSheetModal({
  visible,
  onClose,
  children,
  backdropStyle,
  sheetStyle,
  closeOnBackdropPress = true,
  statusBarTranslucent = true,
}: BottomSheetModalProps) {
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;

    progress.setValue(1);
    Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [progress, visible]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 36],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent={statusBarTranslucent}
    >
      <Pressable
        style={[s.backdrop, backdropStyle]}
        onPress={closeOnBackdropPress ? onClose : undefined}
      >
        <Animated.View
          style={[
            s.content,
            sheetStyle,
            {
              transform: [{ translateY }],
            },
          ]}
        >
          <Pressable onPress={() => {}}>{children}</Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
