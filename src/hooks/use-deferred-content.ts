import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * 进页时先只出页面壳,重内容(消息气泡、笔记卡片)紧接着下一轮再渲染。
 *
 * native-stack 要等新页面第一次提交完才开始推入动画:首帧里同步渲染十几个气泡/卡片,
 * 点下去就得干等这段 JS 跑完,体感是「慢一秒才进」——内容越重的会话越慢。首帧只渲染页头、
 * 输入栏这些固定件,壳一提交原生端就开始推入;重内容在 requestAnimationFrame 回调里翻成 true
 * 再渲染(新架构下它等同 setTimeout(0),不是真的等一帧),赶在推入动画进行中补上
 * (动画跑在原生线程,不受 JS 占用影响)。
 *
 * 网页没有要等的推入动画(桌面分栏切会话也是原地换内容),延后只会先画一帧空壳再出内容、
 * 白闪一下:网页上首帧就是 true。
 */
export function useDeferredContent(): boolean {
  const [ready, setReady] = useState(Platform.OS === 'web');
  useEffect(() => {
    if (ready) return;
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  return ready;
}
