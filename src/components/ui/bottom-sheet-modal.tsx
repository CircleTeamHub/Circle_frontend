import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
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
  avoidKeyboard?: boolean;
}

const DISMISS_DISTANCE = 84;
const DISMISS_VELOCITY = 1.1;
const DISMISS_DURATION = 160;
// 下滑关闭只认从面板顶部（拖拽条 + 标题行）开始的手势。面板正文里常有
// ScrollView / 长列表，从正文开始的下拉必须留给它们滚动，不能把整个面板关掉。
const DISMISS_HANDLE_ZONE = 56;

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
  avoidKeyboard = true,
}: BottomSheetModalProps) {
  const progress = useRef(new Animated.Value(1)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // 面板上沿在 Modal 根坐标系里的位置；Modal 铺满窗口，与手势的 y0 同一坐标系。
  const sheetTopRef = useRef<number | null>(null);

  const pan = useRef(
    PanResponder.create({
      // The sheet already owns the initial responder to keep the backdrop from
      // closing when a child is pressed. Only a clearly downward vertical move
      // that starts in the header zone is treated as a dismiss gesture.
      onMoveShouldSetPanResponder: (_event, gesture) => {
        const sheetTop = sheetTopRef.current;
        if (sheetTop === null) return false;
        const startsInHandleZone = gesture.y0 - sheetTop <= DISMISS_HANDLE_ZONE;
        return (
          startsInHandleZone &&
          gesture.dy > 6 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx)
        );
      },
      onPanResponderMove: (_event, gesture) => {
        dragY.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_event, gesture) => {
        const shouldDismiss =
          gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY;
        if (shouldDismiss) {
          Animated.timing(dragY, {
            toValue: 260,
            duration: DISMISS_DURATION,
            useNativeDriver: true,
          }).start(() => {
            dragY.setValue(0);
            onCloseRef.current();
          });
          return;
        }
        Animated.spring(dragY, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragY, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  useEffect(() => {
    dragY.setValue(0);
    if (!visible) return;

    progress.setValue(1);
    Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [dragY, progress, visible]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 36],
  });
  const totalTranslateY = Animated.add(translateY, dragY);

  const sheetContent = (
    <Animated.View
      {...pan.panHandlers}
      testID="bottom-sheet-content"
      onLayout={(event) => {
        sheetTopRef.current = event.nativeEvent.layout.y;
      }}
      onStartShouldSetResponder={() => true}
      style={[
        s.content,
        sheetStyle,
        {
          transform: [{ translateY: totalTranslateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );

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
        {avoidKeyboard ? (
          <KeyboardAvoidingContainer style={s.keyboardArea}>
            {sheetContent}
          </KeyboardAvoidingContainer>
        ) : (
          <View style={s.keyboardArea}>{sheetContent}</View>
        )}
      </Pressable>
    </Modal>
  );
}
