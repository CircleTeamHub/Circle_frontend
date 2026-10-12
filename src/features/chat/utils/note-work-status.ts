import type { NoteCardData } from '@/types';

/**
 * 已知打烊或下架只给发送者提示，不阻止发送。老板未设置状态时不弹强提醒。
 */
export function shouldWarnNoteWorkStatus(
  note: Pick<NoteCardData, 'workStatus' | 'publicationStatus'> & {
    status?: 'ACTIVE' | 'UNLISTED' | 'DELETED';
  },
): boolean {
  return (
    note.workStatus === 'CLOSED' ||
    note.publicationStatus === 'UNLISTED' ||
    note.status === 'UNLISTED'
  );
}
