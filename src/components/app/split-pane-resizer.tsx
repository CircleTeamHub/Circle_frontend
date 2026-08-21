import { useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import {
  SPLIT_RESIZER_HIT_WIDTH,
} from '@/hooks/use-desktop-split-layout';
import { clampListPaneWidth, useSplitPaneStore } from '@/stores/splitPaneStore';
import { useTheme } from '@/theme';

/**
 * 分栏的可拖拽分割线（桌面网页版）。
 *
 * 视觉是一条 1px 描边，热区放宽到 10px 才好抓；hover / 拖拽时整条染成主色，
 * 给出"这里能拖"的可供性。鼠标拖拽走 PanResponder —— RNW 把鼠标事件喂给
 * 同一套 responder 系统，因此不需要为 web 单独写一份。
 *
 * 宽度写进 splitPaneStore（持久化），会话列表与浮动 tab 条读同一个值，
 * 拖动时同帧一起变。
 */
interface SplitPaneResizerProps {
  /** 分割线左侧那一栏当前的宽度（拖拽以它为基准）。 */
  paneWidth: number;
}

export function SplitPaneResizer({ paneWidth }: SplitPaneResizerProps) {
  const { colors } = useTheme();
  const setListPaneWidth = useSplitPaneStore((state) => state.setListPaneWidth);
  const resetListPaneWidth = useSplitPaneStore(
    (state) => state.resetListPaneWidth,
  );
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);
  // 当前宽度的镜像。responder 只能读 ref，**绝不能**把 paneWidth 写进下面的
  // useMemo 依赖：拖动第一帧宽度就会变，依赖一变 PanResponder 整个重建，
  // 进行中的手势当场失去响应者 —— 表现就是"按住能拖一下就断，像拖不动"。
  const paneWidthRef = useRef(paneWidth);
  paneWidthRef.current = paneWidth;
  /** 本次拖拽起点的宽度：move 用 起点 + dx 计算，避免误差累积。 */
  const startWidthRef = useRef(paneWidth);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // 拖出热区后仍要持有手势，别让祖先把它抢走。
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          startWidthRef.current = paneWidthRef.current;
          setActive(true);
        },
        onPanResponderMove: (_event, gestureState) => {
          setListPaneWidth(startWidthRef.current + gestureState.dx);
        },
        onPanResponderRelease: () => setActive(false),
        onPanResponderTerminate: () => setActive(false),
      }),
    // setListPaneWidth 来自 zustand，引用恒定 → responder 建一次用到底。
    [setListPaneWidth],
  );

  const highlighted = active || hovered;

  return (
    <View
      {...panResponder.panHandlers}
      style={[
        s.hitArea,
        cursorStyle,
        { backgroundColor: highlighted ? colors.primaryLight : 'transparent' },
      ]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      accessibilityRole="adjustable"
      accessibilityLabel="调整会话列表宽度"
      onAccessibilityAction={(event) => {
        // 键盘/辅助技术：左右各 24px 一档，双击手柄以外的复位入口。
        if (event.nativeEvent.actionName === 'increment') {
          setListPaneWidth(clampListPaneWidth(paneWidth + 24));
        } else if (event.nativeEvent.actionName === 'decrement') {
          setListPaneWidth(clampListPaneWidth(paneWidth - 24));
        } else if (event.nativeEvent.actionName === 'activate') {
          resetListPaneWidth();
        }
      }}
      accessibilityActions={[
        { name: 'increment' },
        { name: 'decrement' },
        { name: 'activate' },
      ]}
    >
      <View
        style={[
          s.line,
          { backgroundColor: highlighted ? colors.primary : colors.divider },
        ]}
      />
    </View>
  );
}

// RN 的 ViewStyle 没有 cursor；RNW 认它，用一次断言喂进去。
const cursorStyle = Platform.select({
  web: { cursor: 'col-resize', userSelect: 'none' } as unknown as ViewStyle,
  default: {} as ViewStyle,
});

const s = StyleSheet.create({
  hitArea: {
    width: SPLIT_RESIZER_HIT_WIDTH,
    alignItems: 'center',
    // 拖拽时鼠标可能滑出热区，扩大命中不靠这里，靠 responder 一直持有手势。
  },
  line: {
    width: StyleSheet.hairlineWidth,
    flex: 1,
  },
});
