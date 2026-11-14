import type { NoteSummary, NoteWorkStatus } from '../types';

/**
 * 场地状态是可选提醒：null / UNSET / 老接口缺字段都表示「未设置」，不能当成开工。
 * 下架（status=UNLISTED）显示成 OFF_SHELF，和开工/打烊三选一。
 */
export function resolveManagedWorkStatus(
  note: Pick<NoteSummary, 'workStatus'> & Partial<Pick<NoteSummary, 'status'>>,
): NoteWorkStatus {
  // 与 work-status.ts 的 displayedNoteWorkStatus 同一规则（这里给 node 测试直接加载，不跨文件引用）。
  if (note.status === 'UNLISTED' || note.workStatus === 'OFF_SHELF') return 'OFF_SHELF';
  return note.workStatus === 'WORKING' || note.workStatus === 'CLOSED' ? note.workStatus : 'UNSET';
}
