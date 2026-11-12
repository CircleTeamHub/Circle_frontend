import { UploadProgressHost } from '@/components/app/UploadProgressHost';
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
import { useTheme } from '@/theme';

interface BottomSheetModalProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  backdropStyle?: StyleProp<ViewStyle>;
  sheetStyle?: StyleProp<ViewStyle>;
  closeOnBackdropPress?: boolean;
  statusBarTranslucent?: boolean;
  avoidKeyboard?: boolean;
  /**
   * iOS only (React Native's Modal never fires it on Android): called once the sheet has
   * fully closed. iOS cannot present another Modal while this one is still dismissing.
   */
  onDismiss?: () => void;
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
  root: {
    flex: 1,
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
  onDismiss,
}: BottomSheetModalProps) {
  const { colors } = useTheme();
  // 默认就压暗背后的页面:面板常和页面同底色,没有蒙层两者分不出边界。
  // 调用方传了 backdropStyle 的照旧覆盖。
  const d = useMemo(() => ({ backdrop: { backgroundColor: colors.overlay } }), [colors.overlay]);
  const progress = useRef(new Animated.Value(1)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // 面板上沿在 Modal 根坐标系里的位置；Modal 铺满窗口，与触摸的 pageY 同一坐标系。
  const sheetTopRef = useRef<number | null>(null);
  // 手指按下的位置。PanResponder 的 y0 要到接管时才赋值：接管前是 0，接管时是当时手指的
  // 位置而不是起点，判断手势从哪开始只能在按下时自己记。
  const touchStartYRef = useRef(0);
  const sheetHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const scrollableCountRef = useRef(0);

  const canDragFromTouchStart = () => {
    const sheetTop = sheetTopRef.current;
    const startsInHandleZone =
      sheetTop !== null && touchStartYRef.current - sheetTop <= DISMISS_HANDLE_ZONE;
    // 正文里的列表已接入且滚到顶时，正文下拉也归面板。
    const listAtTop =
      scrollableCountRef.current > 0 && scrollOffsetRef.current <= SCROLL_TOP_TOLERANCE;
    return startsInHandleZone || listAtTop;
  };
  const shouldClaim = (gesture: PanResponderGestureState) =>
    canDragFromTouchStart() &&
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
      // 捕获阶段只记位置，返回 false 不抢手势。
      onStartShouldSetPanResponderCapture: (event) => {
        touchStartYRef.current = event.nativeEvent.pageY;
        return false;
      },
      // 冒泡阶段：没有子节点接手时的常规判定。
      onMoveShouldSetPanResponder: (_event, gesture) => shouldClaim(gesture),
      // 捕获阶段：抢在列表之前判定，列表已在顶部时下拉归面板、列表钉住不动；
      // 列表还没到顶就放给列表滚，同一次手势里不会两边一起动。
      onMoveShouldSetPanResponderCapture: (_event, gesture) => shouldClaim(gesture),
      // 拿到手势后不让给列表，否则拖到一半面板会被弹回。
      onPanResponderTerminationRequest: () => false,
      // 接管时 dy 已清零，从这里开始算就是跟手的，面板不会跳一下。
      onPanResponderMove: (_event, gesture) => {
        dragY.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_event, gesture) => {
        const dragged = Math.max(0, gesture.dy);
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
      onPanResponderTerminate: springBack,
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
      onDismiss={onDismiss}
      statusBarTranslucent={statusBarTranslucent}
    >
      <View style={s.root}>
        {/* 蒙层是面板的兄弟节点，不能包着面板：iOS 新架构下 ScrollView 只要祖先是 JS responder
            就不让滚，蒙层或面板按下就占住 responder 的话，手指落在纯文字上列表就滑不动。 */}
        <Pressable
          testID="bottom-sheet-backdrop"
          accessible={false}
          style={[StyleSheet.absoluteFill, d.backdrop, backdropStyle]}
          onPress={closeOnBackdropPress ? onClose : undefined}
        />
        {/* 面板里有输入框时，键盘弹起把整个面板顶上去；蒙层仍铺满全屏。
            各个 sheet 不要再自己套避让容器，嵌套会按父容器坐标重复算。 */}
        {avoidKeyboard ? (
          <KeyboardAvoidingContainer testID="bottom-sheet-area" pointerEvents="box-none" style={s.keyboardArea}>
            {sheetContent}
          </KeyboardAvoidingContainer>
        ) : (
          <View testID="bottom-sheet-area" pointerEvents="box-none" style={s.keyboardArea}>{sheetContent}</View>
        )}
      </View>
      <UploadProgressHost />
    </Modal>
  );
}
