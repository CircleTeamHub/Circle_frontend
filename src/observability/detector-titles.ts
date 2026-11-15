/**
 * detector-titles.ts — 主动检测（不是 catch 到的错误）的 Sentry 标题。
 *
 * 这些上报的 Error 只是个载体，「xx 失败｜运行时错误」的通用标题看不出发生了什么；
 * 这里按 operation:kind 拼一行能直接读懂的标题。取值一律经 sentry.ts 的 readTagValue
 * （已脱敏），这里只负责排版。
 */
type Read = (key: string) => string | undefined;

const unit = (value: string | undefined, suffix: string) => (value ? `${value}${suffix}` : undefined);

const TITLES: Readonly<Record<string, (read: Read) => readonly (string | undefined)[]>> = {
  'render:commitStorm': (read) => [
    '渲染提交风暴',
    unit(read('commitsPerSecond'), ' 次/秒'),
    read('components'),
  ],
  'render:slowScreen': (read) => ['页面首次渲染慢', read('page'), unit(read('durationMs'), ' ms')],
  'navigation:focusedScreenFrozen': (read) => ['页面切回来没有解冻', read('page')],
  'navigation:duplicateTabs': (read) => ['根栈里出现多份 (tabs)', unit(read('routeCount'), ' 份')],
  'noteSave:contentDropped': (read) => [
    '笔记保存后正文被丢掉',
    read('sentBlocks') && read('returnedBlocks')
      ? `发出 ${read('sentBlocks')} 块，返回 ${read('returnedBlocks')} 块`
      : undefined,
  ],
  'noteEditor:domReadyTimeout': (read) => ['笔记编辑器一直没就绪', unit(read('durationMs'), ' ms'), read('platform')],
  'noteEditor:domLayoutCollapsed': (read) => [
    '笔记编辑器布局塌了',
    read('rootWidth') && read('rootHeight') ? `${read('rootWidth')}×${read('rootHeight')}` : undefined,
    read('viewportWidth') && read('viewportHeight') ? `视口 ${read('viewportWidth')}×${read('viewportHeight')}` : undefined,
    read('platform'),
  ],
  'chatSocket:disconnectedTooLong': (read) => [
    '聊天长连接断开过久',
    unit(read('durationMs'), ' ms'),
    read('reason'),
  ],
  'api:unknownErrorCode': (read) => ['后端返回了前端不认识的错误码', read('errorCode'), read('endpointPath')],
};

export function detectorTitle(read: Read): string | undefined {
  const build = TITLES[`${read('operation')}:${read('kind')}`];
  return build?.(read).filter((part): part is string => Boolean(part)).join('｜');
}
