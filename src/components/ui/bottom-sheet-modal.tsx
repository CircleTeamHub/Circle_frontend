import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type FlatListProps,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PanResponderGestureState,
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

// 下拉关闭的判定：拖过面板高度的三成（且至少 120pt）才关；快速下甩要同时
// 拖出 48pt 以上，避免手指轻轻一带、或本想滚列表时整块面板就没了。
const DISMISS_MIN_DISTANCE = 120;
const DISMISS_HEIGHT_RATIO = 0.3;
const DISMISS_VELOCITY = 1.6;
const DISMISS_FLING_MIN_DISTANCE = 48;
const DISMISS_DURATION = 180;
// 判定为下拉手势前要走过的竖向距离，太小会把列表的正常滚动误判成拖面板。
const DRAG_ACTIVATION_DISTANCE = 10;
// 下滑关闭默认只认从面板顶部（拖拽条 + 标题行）开始的手势。面板正文里常有
// ScrollView / 长列表，从正文开始的下拉必须留给它们滚动，不能把整个面板关掉。
const DISMISS_HANDLE_ZONE = 56;
// 列表偏移在这个范围内都算「到顶」，吸收 iOS 惯性停靠的亚像素误差。
const SCROLL_TOP_TOLERANCE = 1;

type BottomSheetScrollContextValue = {
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  registerScrollable: () => () => void;
};

const BottomSheetScrollContext = createContext<BottomSheetScrollContextValue | null>(null);

/**
 * 面板里的列表用它代替 FlatList，面板据此判断列表是否在顶部：
 * 列表没到顶时下滑只滚列表；到顶后从正文任意位置下滑，列表钉住不动、改为拖面板。
 * 没有接入它的面板仍然只能从顶部把手区域拖动关闭。
 * 顶部回弹关掉，否则 iOS 上列表回弹和面板位移会叠在一起往下跑。
 */
export function BottomSheetFlatList<ItemT>({ onScroll, ...props }: FlatListProps<ItemT>) {
  const sheetScroll = useContext(BottomSheetScrollContext);
  useEffect(() => sheetScroll?.registerScrollable(), [sheetScroll]);
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    sheetScroll?.onScroll(event);
    onScroll?.(event);
  }, [onScroll, sheetScroll]);

  return (
    <FlatList
      {...props}
      onScroll={handleScroll}
      scrollEventThrottle={sheetScroll ? 16 : props.scrollEventThrottle}
      bounces={sheetScroll ? false : props.bounces}
      overScrollMode={sheetScroll ? 'never' : props.overScrollMode}
    />
  );
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
  avoidKeyboard = true,
}: BottomSheetModalProps) {
  const progress = useRef(new Animated.Value(1)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // 面板上沿在 Modal 根坐标系里的位置；Modal 铺满窗口，与手势的 y0 同一坐标系。
  const sheetTopRef = useRef<number | null>(null);
  const sheetHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const scrollableCountRef = useRef(0);
  // 本次手势是否允许拖面板。面板根节点为了挡住蒙层点击会在按下时就成为
  // 响应者，所以移动/松手阶段也必须按起点判断，不能只靠「移动时是否接管」。
  const dragAllowedRef = useRef(false);

  const canDragFrom = (y0: number) => {
    const sheetTop = sheetTopRef.current;
    const startsInHandleZone = sheetTop !== null && y0 - sheetTop <= DISMISS_HANDLE_ZONE;
    // 正文里的列表已接入且滚到顶时，正文下拉也归面板。
    const listAtTop =
      scrollableCountRef.current > 0 && scrollOffsetRef.current <= SCROLL_TOP_TOLERANCE;
    return startsInHandleZone || listAtTop;
  };
  const shouldClaim = (gesture: PanResponderGestureState) =>
    canDragFrom(gesture.y0) &&
    gesture.dy > DRAG_ACTIVATION_DISTANCE &&
    Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5;

  const scrollContext = useMemo<BottomSheetScrollContextValue>(() => ({
    onScroll: (event) => {
      scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
    },
    registerScrollable: () => {
      scrollableCountRef.current += 1;
      return () => {
        scrollableCountRef.current -= 1;
      };
    },
  }), []);

  const springBack = () => {
    Animated.spring(dragY, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  };

  const pan = useRef(
    PanResponder.create({
      // 冒泡阶段：没有子节点接手时的常规判定。
      onMoveShouldSetPanResponder: (_event, gesture) => shouldClaim(gesture),
      // 捕获阶段：抢在列表之前判定，列表已在顶部时下拉归面板、列表钉住不动；
      // 列表还没到顶就放给列表滚，同一次手势里不会两边一起动。
      onMoveShouldSetPanResponderCapture: (_event, gesture) => shouldClaim(gesture),
      onPanResponderGrant: (_event, gesture) => {
        dragAllowedRef.current = canDragFrom(gesture.y0);
      },
      // 拿到手势后不让给列表，否则拖到一半面板会被弹回。
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, gesture) => {
        if (!dragAllowedRef.current) return;
        // 从越过激活距离那一刻开始跟手，面板不会一下跳 10pt。
        dragY.setValue(Math.max(0, gesture.dy - DRAG_ACTIVATION_DISTANCE));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (!dragAllowedRef.current) return;
        dragAllowedRef.current = false;
        const dragged = Math.max(0, gesture.dy - DRAG_ACTIVATION_DISTANCE);
        const distanceThreshold = Math.max(
          DISMISS_MIN_DISTANCE,
          sheetHeightRef.current * DISMISS_HEIGHT_RATIO,
        );
        const shouldDismiss =
          dragged > distanceThreshold ||
          (gesture.vy > DISMISS_VELOCITY && dragged > DISMISS_FLING_MIN_DISTANCE);
        if (shouldDismiss) {
          Animated.timing(dragY, {
            toValue: Math.max(sheetHeightRef.current, 260),
            duration: DISMISS_DURATION,
            useNativeDriver: true,
          }).start(() => {
            // 不在这里把 dragY 复位：Modal 还要淡出一两帧，复位会让面板
            // 先跳回原位再消失（「闪一下」）。复位留到下次打开时做。
            onCloseRef.current();
          });
          return;
        }
        springBack();
      },
      onPanResponderTerminate: () => {
        dragAllowedRef.current = false;
        springBack();
      },
    }),
  ).current;

  useEffect(() => {
    // 关闭时什么都不复位，让面板停在拖走后的位置随 Modal 淡出。
    if (!visible) return;

    dragY.setValue(0);
    scrollOffsetRef.current = 0;
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
        sheetHeightRef.current = event.nativeEvent.layout.height;
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
      <BottomSheetScrollContext.Provider value={scrollContext}>
        {children}
      </BottomSheetScrollContext.Provider>
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
