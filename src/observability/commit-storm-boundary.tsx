import React, { useCallback, type ReactNode } from 'react';
import { AppState, Keyboard, Platform, StyleSheet, View, type GestureResponderEvent, type ViewProps } from 'react-native';
import { createCommitStormDetector } from './commit-storm-detector';
import { diagnosticNow } from './http-diagnostics';
import { subscribeReactCommits } from './react-commit-hook';
import { reportHandledFailure, toStableCode } from './report-failure';

let detector: ReturnType<typeof createCommitStormDetector> | null = null;

/**
 * 启动提交风暴检测（见 commit-storm-detector）。只在原生端：web 的鼠标、滚轮不走 touch 事件，
 * 排除不了用户操作。钩子只在生产包里装（index.ts），开发包里这里订阅了也收不到回调。
 */
export function startCommitStormDetector(): void {
  if (Platform.OS === 'web' || detector) return;
  const created = createCommitStormDetector({
    now: diagnosticNow,
    isAppActive: () => AppState.currentState === 'active',
    isKeyboardVisible: () => Keyboard.isVisible(),
    onStorm: ({ commitsPerSecond, durationMs, components }) => {
      reportHandledFailure('render', 'commitStorm', new Error('React commit storm'), {
        commitsPerSecond,
        durationMs,
        components: components.join(','),
        // 按源头组件分 issue：新冒出来的空转不会被旧的那条吞掉。
        code: toStableCode(components[0] ?? 'unknown'),
      });
    },
  });
  detector = created;
  subscribeReactCommits(created.onCommit);
}

type TouchCaptureProps = {
  onTouchStartCapture?: (event: GestureResponderEvent) => void;
  onTouchMoveCapture?: (event: GestureResponderEvent) => void;
  onTouchEndCapture?: (event: GestureResponderEvent) => void;
  onTouchCancelCapture?: (event: GestureResponderEvent) => void;
};
// RN 的 TS 声明漏了捕获阶段的触摸回调；Flow 类型（ViewPropTypes）和原生 view config 里都有。
const CaptureView = View as unknown as React.ComponentType<ViewProps & TouchCaptureProps>;

type Props = { children: ReactNode };

/** 包住整棵 App：捕获阶段看所有触摸，用来排除「用户在滑、在点」引起的密集提交。 */
export const CommitStormTouchBoundary: React.FC<Props> = ({ children }) => {
  const onTouch = useCallback((event: GestureResponderEvent) => {
    detector?.onTouch(event.nativeEvent.touches.length);
  }, []);
  const onTouchCancel = useCallback(() => {
    detector?.onTouchCancel();
  }, []);

  if (Platform.OS === 'web') return <>{children}</>;
  return (
    <CaptureView
      style={styles.root}
      onTouchStartCapture={onTouch}
      onTouchMoveCapture={onTouch}
      onTouchEndCapture={onTouch}
      onTouchCancelCapture={onTouchCancel}
    >
      {children}
    </CaptureView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
});
