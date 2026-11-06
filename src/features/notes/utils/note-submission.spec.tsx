import { createPendingNoteSubmission, noteSubmissionMatchesResult } from './note-submission';
import type { CreateNoteInput, NoteDetail } from '../types';

test('successful rich-text reconciliation avoids rebuilding JSON snapshots', () => {
  const blocks = [{ id: 'local', type: 'paragraph', content: [{ type: 'text', text: 'Rich text', styles: { bold: true } }] }];
  const input: CreateNoteInput = { title: 'Note', media: [], contentJson: blocks, sections: { text: { content: 'Rich text', contentJson: blocks } } };
  const pending = createPendingNoteSubmission(input, null);
  const result = { id: 'saved', ...input, groups: [], pinned: false } as unknown as NoteDetail;
  const serialize = jest.spyOn(JSON, 'stringify');
  try {
    expect(noteSubmissionMatchesResult(pending, result)).toBe(true);
    expect(serialize).not.toHaveBeenCalled();
  } finally { serialize.mockRestore(); }
});

test('canonical comparison ignores property order and absent optional values but rejects changed styles', () => {
  const input: CreateNoteInput = {
    title: 'Note', media: [],
    contentJson: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body', styles: { bold: true, italic: false } }] }],
  };
  const pending = createPendingNoteSubmission(input, null);
  const result = {
    id: 'saved', title: 'Note', media: [], groups: [],
    contentJson: [{ content: [{ styles: { italic: false, bold: true, color: undefined }, text: 'Body', type: 'text' }], type: 'paragraph', id: 'server' }],
  } as unknown as NoteDetail;
  expect(noteSubmissionMatchesResult(pending, result)).toBe(true);
  const changed = JSON.parse(JSON.stringify(result)) as NoteDetail;
  (changed.contentJson![0] as { content: { styles: { bold: boolean } }[] }).content[0].styles.bold = false;
  expect(noteSubmissionMatchesResult(pending, changed)).toBe(false);
});
