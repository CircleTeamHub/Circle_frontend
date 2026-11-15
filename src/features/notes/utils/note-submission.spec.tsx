import { createPendingNoteSubmission, noteContentDropped, noteSubmissionMatchesResult } from './note-submission';
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

describe('noteContentDropped', () => {
  const paragraph = (text: string) => ({ type: 'paragraph', props: { textColor: 'default' }, content: [{ type: 'text', text, styles: {} }] });
  const image = { type: 'image', props: { objectKey: 'notes/u1/a.jpg', textColor: 'default' }, content: [] };
  const emptyLine = { type: 'paragraph', props: { textColor: 'default' }, content: [] };
  const blocks = [paragraph('第一段'), emptyLine, image, paragraph('第二段')];
  const pendingFor = (contentJson: Record<string, unknown>[]) =>
    createPendingNoteSubmission({ title: 'Note', media: [], contentJson, sections: { text: { content: '', contentJson } } }, 'note-1');
  const resultWith = (contentJson: unknown) => ({ id: 'note-1', title: 'Note', media: [], groups: [], contentJson, sections: { text: { contentJson } } }) as unknown as NoteDetail;

  // 线上真实发生过：后端 ValidationPipe 把正文的每个块清成了空数组，PATCH 照样 200。
  test('blocks the server emptied out are caught even though the block count is unchanged', () => {
    expect(noteContentDropped(pendingFor(blocks), resultWith([[], [], [], []]))).toEqual({ sentBlocks: 3, returnedBlocks: 0 });
  });

  test('a server that kept every block that had text or media is fine, empty lines aside', () => {
    expect(noteContentDropped(pendingFor(blocks), resultWith([paragraph('第一段'), image, paragraph('第二段')]))).toBeNull();
  });

  test('a partially dropped body is caught too', () => {
    expect(noteContentDropped(pendingFor(blocks), resultWith([paragraph('第一段')]))).toEqual({ sentBlocks: 3, returnedBlocks: 1 });
  });

  test('a response without any body field says nothing either way', () => {
    const bare = { id: 'note-1', title: 'Note', media: [], groups: [] } as unknown as NoteDetail;
    expect(noteContentDropped(pendingFor(blocks), bare)).toBeNull();
    expect(noteContentDropped(pendingFor(blocks), resultWith(null))).toEqual({ sentBlocks: 3, returnedBlocks: 0 });
  });

  test('a note sent without body text has nothing to lose', () => {
    expect(noteContentDropped(pendingFor([emptyLine]), resultWith([]))).toBeNull();
  });
});
