import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { diagnosticNow } from '@/observability/http-diagnostics';
import { reportHandledFailure } from '@/observability/report-failure';

/** 冷启动的老安卓机要先拉起 WebView、再加载 Expo DOM 包，几秒是正常的；10 秒还没好就是坏了。 */
export const DOM_READY_TIMEOUT_MS = 10_000;
// 计时器自己迟到这么久，说明 JS 线程整个卡住了（归 js-stall-detector）。
const TIMER_LATE_TOLERANCE_MS = 2000;

/**
 * 笔记编辑器（Expo DOM / WebView）的两类「不报错的坏」：
 * - 一直没就绪：web 上 WebView 是桩、onLoadEnd 永不回调，曾经整页一直转圈；
 * - 就绪了但布局塌了：Expo DOM 的 #root 是横排 flex，文字栏曾缩成 22px 宽，点哪儿都打不了字。
 * DOM 侧挂载两帧后量一次自己的根节点和视口，经 onEditorReady 报回来。
 */
export function useNoteEditorDomHealth(enabled: boolean, fitContent: boolean) {
  const ready = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const startedAt = diagnosticNow();
    const timer = setTimeout(() => {
      const late = diagnosticNow() - startedAt - DOM_READY_TIMEOUT_MS;
      if (ready.current || late > TIMER_LATE_TOLERANCE_MS || AppState.currentState !== 'active') return;
      reportHandledFailure('noteEditor', 'domReadyTimeout', new Error('note editor never reported ready'), {
        durationMs: DOM_READY_TIMEOUT_MS,
        platform: Platform.OS,
      });
    }, DOM_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [enabled]);

  return useCallback(
    (rootWidth: number, rootHeight: number, viewportWidth: number, viewportHeight: number) => {
      ready.current = true;
      // 文字栏模式本来就只有一行高，只看宽度；全屏模式宽高都该铺满视口。
      const collapsed = rootWidth < viewportWidth / 2 || (!fitContent && rootHeight < viewportHeight / 2);
      if (!collapsed) return;
      reportHandledFailure('noteEditor', 'domLayoutCollapsed', new Error('note editor laid out collapsed'), {
        rootWidth,
        rootHeight,
        viewportWidth,
        viewportHeight,
        platform: Platform.OS,
      });
    },
    [fitContent],
  );
}
