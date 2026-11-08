/**
 * 底部 tab 栏选中指示器「从哪一格滑过来」的全局记录。
 *
 * 原生端每个 tab 首页各画一份 bar(TabRootScreen),切 tab 时看见的是新那页的那份;
 * 它自己记的位置是它上次被看见时的,可能早就过时(失焦前最后一次渲染还会把指示器挪到新 tab)。
 * 所以起点按全局记:用户上一次看见指示器停在哪一格。每次换格记一笔(seq 递增),
 * 每份 bar 对同一笔只滑一次;同一次提交里先渲染哪份都拿到同一个起点。
 * 圈子(独立圆按钮)不在 bar 里:选中时指示器隐藏、不记,离开时从它之前那一格出发。
 */
let track = { seq: 0, from: -1, to: -1 };

/**
 * bar 的选中格变成 `index`(>= 0)时调用。返回这份 bar 要从哪一格滑过来;不用滑(首次出现、
 * 原地重渲染、从圈子回到同一格)时返回 null。`handled` 是这份 bar 自己已经滑过的那一笔。
 */
export function indicatorSlideStart(index: number, handled: { current: number }): number | null {
  if (index !== track.to) track = { seq: track.seq + 1, from: track.to, to: index };
  const fresh = handled.current !== track.seq;
  handled.current = track.seq;
  return fresh && track.from >= 0 ? track.from : null;
}
