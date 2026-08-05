import { useEffect, useState } from 'react';

/**
 * 纯函数：从 startedAt 到 now 的整秒数；未开始时为 0。
 * 地板为 1 —— 计时刚起步时显示「0 秒」既没意义也会闪一下。抽出来便于无 React 环境单测。
 */
export function elapsedSecondsSince(
  startedAt: number | null,
  now: number,
): number {
  if (startedAt == null) return 0;
  return Math.max(1, Math.round((now - startedAt) / 1000));
}

/**
 * 计时 hook：startedAt 为 null 时**完全不排定时器**，一次渲染都不触发。
 *
 * 它取代的是 expo-audio 的 useAudioRecorderState(recorder, 250)：那个 hook 从挂载到
 * 卸载每 250ms 同步调一次 native getStatus() 并 setState 一个全新对象（引用永远不等，
 * 不会 bail out），于是整个聊天页常驻 4Hz 重渲染——不只是录音时，而是只要页面开着。
 * 每次重渲染都要重跑消息映射 useMemo 并重新 diff 整个 FlatList，在低端机上会把任何
 * 别的卡顿放大成肉眼可见的无响应。
 *
 * 这里只在真正录音期间按 1Hz 走，而 UI 显示的本就只是整秒。录音时长的**权威值**
 * 另有来源：发送前直接读 voiceRecorder.getStatus().durationMillis，不依赖这个计时。
 */
export function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt == null) return;
    // 立刻对齐一次：startedAt 变化时沿用上一轮的 now 会让首帧显示上一次录音的秒数。
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return elapsedSecondsSince(startedAt, now);
}
