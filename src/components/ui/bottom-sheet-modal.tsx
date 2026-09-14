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

import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';

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
  keyboardArea: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  content: {
    width: '100%',
    // 键盘占掉下半屏时，定高/百分比高度的面板要能缩进剩下的空间，而不是顶出屏幕上沿。
    flexShrink: 1,
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
        {/* 面板里有输入框时，键盘弹起把整个面板顶上去；蒙层仍铺满全屏。
            各个 sheet 不要再自己套避让容器，嵌套会按父容器坐标重复算。 */}
        <KeyboardAvoidingContainer style={s.keyboardArea}>
          <Animated.View
            onStartShouldSetResponder={() => true}
            style={[
              s.content,
              sheetStyle,
              {
                transform: [{ translateY }],
              },
            ]}
          >
            {children}
          </Animated.View>
        </KeyboardAvoidingContainer>
      </Pressable>
    </Modal>
  );
}
