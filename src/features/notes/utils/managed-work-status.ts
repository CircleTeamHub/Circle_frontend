import type { NoteSummary, NoteWorkStatus } from '../types';

/** 场地状态是可选提醒：null / UNSET / 老接口缺字段都表示「未设置」，不能当成开工。 */
export function resolveManagedWorkStatus(
  note: Pick<NoteSummary, 'workStatus'>,
): NoteWorkStatus {
  return note.workStatus === 'WORKING' || note.workStatus === 'CLOSED'
    ? note.workStatus
    : 'UNSET';
}
