import { ApiError } from '@/services/api/api-error';
import {
  createNote,
  deleteNoteDraft,
  fetchNoteDetail,
  fetchNoteDraft,
  fetchNoteDrafts,
  updateNote,
} from '@/services/api/notes';
import {
  loadLocalNoteDraft,
  saveLocalNoteDraft,
  type NoteEditorDraftRecord,
} from './note-editor-drafts';
import { publishInterruptedNotes, trackOpenNoteEditor } from './interrupted-note-recovery';

function mockStore(): Map<string, string> {
  const holder = globalThis as { __recoveryStorage?: Map<string, string> };
  holder.__recoveryStorage ??= new Map();
  return holder.__recoveryStorage;
}
jest.mock('@/storage', () => ({
  storage: {
    getString: (key: string) => mockStore().get(key),
    set: (key: string, value: string) => mockStore().set(key, value),
    remove: (key: string) => mockStore().delete(key),
  },
}));
jest.mock('@/storage/page-snapshots', () => ({
  readPageSnapshot: () => null,
  writePageSnapshot: jest.fn(),
}));
jest.mock('./note-recording-storage', () => ({
  isNoteRecordingId: () => false,
  removeNoteRecording: jest.fn(async () => undefined),
  restoreNoteRecording: jest.fn(async () => undefined),
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/services/api/notes', () => ({
  createNote: jest.fn(),
  deleteNoteDraft: jest.fn(async () => undefined),
  fetchNoteDetail: jest.fn(),
  fetchNoteDraft: jest.fn(),
  fetchNoteDrafts: jest.fn(async () => []),
  updateNote: jest.fn(),
}));

// 删过的草稿 id 在进程里一直有围栏(按账号 + id):每个用例换一个账号,互不影响。
let USER = 'user-0';
let userSeq = 0;
const NOW = Date.parse('2026-11-16T12:00:00Z');
let clock = NOW;

function record(overrides: Partial<NoteEditorDraftRecord> = {}): NoteEditorDraftRecord {
  return {
    version: 1,
    id: 'draft-1',
    noteId: null,
    title: '',
    content: '写到一半',
    contentJson: [{ type: 'paragraph', content: [{ type: 'text', text: '写到一半' }] }],
    sections: {
      text: { content: '写到一半', contentJson: [] },
      media: {
        items: [
          { type: 'IMAGE', objectKey: 'notes/me/done.jpg', sortOrder: 0 },
          { type: 'IMAGE', objectKey: 'notes/me/still-uploading.jpg', sortOrder: 1 },
        ],
      },
      showcase: { items: [{ type: 'IMAGE', objectKey: 'notes/me/done.jpg', sortOrder: 0 }] },
      audio: { items: [] },
    },
    groupIds: ['g1'],
    mediaKeys: ['notes/me/done.jpg'],
    composerBlocks: [],
    textBlocksById: {},
    mediaItems: [],
    showcaseItems: [],
    audioItems: [],
    mediaOwnerByClientId: {},
    contactItems: [],
    groupCardItems: [],
    location: { title: '', address: '', latitude: null, longitude: null },
    createdAt: NOW,
    updatedAt: NOW,
    city: '上海',
    ...overrides,
  } as NoteEditorDraftRecord;
}

const run = () =>
  publishInterruptedNotes({ userId: USER, fallbackTitle: '未命名笔记', isCurrent: () => true, now: (clock += 60 * 60_000) });

beforeEach(() => {
  USER = `user-${++userSeq}`;
  mockStore().clear();
  jest.clearAllMocks();
  jest.mocked(fetchNoteDrafts).mockResolvedValue([]);
  jest.mocked(createNote).mockResolvedValue({ id: 'note-new' } as never);
  jest.mocked(updateNote).mockResolvedValue({ id: 'note-old' } as never);
});

test('a new note left behind by a crash is published as a note, with only finished uploads and a default title', async () => {
  saveLocalNoteDraft(USER, record());
  await expect(run()).resolves.toBe(1);
  expect(createNote).toHaveBeenCalledWith({
    title: '未命名笔记',
    city: '上海',
    content: '写到一半',
    contentJson: record().contentJson,
    sections: expect.objectContaining({
      media: { items: [{ type: 'IMAGE', objectKey: 'notes/me/done.jpg', sortOrder: 0 }] },
      showcase: { items: [{ type: 'IMAGE', objectKey: 'notes/me/done.jpg', sortOrder: 0 }] },
    }),
    groupIds: ['g1'],
    // 同一对象在两个分区里只算一次。
    media: [{ type: 'IMAGE', objectKey: 'notes/me/done.jpg', sortOrder: 0 }],
    clientDraftID: 'draft-1',
    status: 'ACTIVE',
  });
  expect(loadLocalNoteDraft(USER, 'draft-1')).toBeNull();
  expect(deleteNoteDraft).toHaveBeenCalledWith('draft-1');
});

test('interrupted edits to an existing note update it and keep it pinned', async () => {
  saveLocalNoteDraft(USER, record({ noteId: 'note-old', title: '旧标题' }));
  jest.mocked(fetchNoteDetail).mockResolvedValue({ id: 'note-old', pinned: true } as never);
  await expect(run()).resolves.toBe(1);
  expect(updateNote).toHaveBeenCalledWith('note-old', expect.objectContaining({ title: '旧标题', pinned: true }));
  expect(createNote).not.toHaveBeenCalled();
});

test('if the note being edited no longer exists, the content is kept as a new note', async () => {
  saveLocalNoteDraft(USER, record({ noteId: 'note-gone', title: '没了' }));
  jest.mocked(fetchNoteDetail).mockRejectedValue(new ApiError('NOT_FOUND', { status: 404, failureKind: 'http' }));
  await expect(run()).resolves.toBe(1);
  expect(updateNote).not.toHaveBeenCalled();
  expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ title: '没了', status: 'ACTIVE' }));
});

test('a save that was already sent when the app died is replayed exactly, not rebuilt from newer content', async () => {
  const sent = { title: '发出去的那次', media: [], clientDraftID: 'draft-1', status: 'ACTIVE' as const };
  saveLocalNoteDraft(USER, record({ title: '之后又改了', pendingSubmission: { noteId: null, input: sent } }));
  await expect(run()).resolves.toBe(1);
  expect(createNote).toHaveBeenCalledWith(sent);
});

test('a draft whose editor is still open somewhere is left alone', async () => {
  saveLocalNoteDraft(USER, record());
  const close = trackOpenNoteEditor('draft-1');
  try {
    await expect(run()).resolves.toBe(0);
    expect(createNote).not.toHaveBeenCalled();
    expect(loadLocalNoteDraft(USER, 'draft-1')).not.toBeNull();
  } finally {
    close();
  }
});

test('a failed publish keeps the content for the next visit', async () => {
  saveLocalNoteDraft(USER, record());
  jest.mocked(createNote).mockRejectedValueOnce(new ApiError('NETWORK', { status: 0 }));
  await expect(run()).resolves.toBe(0);
  expect(loadLocalNoteDraft(USER, 'draft-1')).not.toBeNull();
  await expect(run()).resolves.toBe(1);
});

test('an opened-but-empty new note is cleared without creating anything', async () => {
  saveLocalNoteDraft(USER, record({ title: ' ', content: '', mediaKeys: [], sections: {} }));
  await expect(run()).resolves.toBe(0);
  expect(createNote).not.toHaveBeenCalled();
  expect(loadLocalNoteDraft(USER, 'draft-1')).toBeNull();
});

test('server drafts from another device are published only once they have sat untouched for a while', async () => {
  const at = clock + 60 * 60_000;
  jest.mocked(fetchNoteDrafts).mockResolvedValue([
    { id: 'remote-idle', title: '另一台', contentPreview: null, mediaCount: 0, createdAt: '', updatedAt: new Date(at - 31 * 60_000).toISOString() },
    { id: 'remote-busy', title: '正在写', contentPreview: null, mediaCount: 0, createdAt: '', updatedAt: new Date(at - 60_000).toISOString() },
  ]);
  jest.mocked(fetchNoteDraft).mockResolvedValue({
    id: 'remote-idle', title: '另一台', content: '内容', contentJson: null, sections: null,
    groupIds: [], mediaKeys: [], sourceNoteId: null, contentPreview: null, mediaCount: 0, createdAt: '', updatedAt: '',
  });
  await expect(run()).resolves.toBe(1);
  expect(fetchNoteDraft).toHaveBeenCalledTimes(1);
  expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ title: '另一台', clientDraftID: 'remote-idle' }));
});
