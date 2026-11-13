import { useEffect, useState } from 'react';

/**
 * 进页时先只出页面壳,重内容(消息气泡、笔记卡片)下一帧再渲染。
 *
 * native-stack 要等新页面第一次提交完才开始推入动画:首帧里同步渲染十几个气泡/卡片,
 * 点下去就得干等这段 JS 跑完,体感是「慢一秒才进」——内容越重的会话越慢。首帧只渲染页头、
 * 输入栏这些固定件,动画立刻开始;下一帧翻成 true,重内容在推入动画进行中补上
 * (动画跑在原生线程,不受 JS 占用影响)。
 */
export function useDeferredContent(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return ready;
}
