import { NoteRatingReasonSheet } from '@/features/notes/components/NoteRatingReasonSheet';
import {
  cancelBadNoteRating,
  submitBadNoteRating,
  useNoteRatingFlowStore,
} from '@/features/notes/rating/note-rating-flow';

/** Root-level 差评 reason sheet for ratings started from a chat card or 我的笔记. */
export function NoteRatingFlowHost() {
  const visible = useNoteRatingFlowStore((state) => state.badRequest !== null);
  return (
    <NoteRatingReasonSheet
      visible={visible}
      submitting={false}
      onClose={cancelBadNoteRating}
      onSubmit={(reason, comment) => void submitBadNoteRating(reason, comment)}
    />
  );
}
