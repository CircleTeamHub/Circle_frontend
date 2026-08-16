import test from 'node:test';
import assert from 'node:assert/strict';
import type { NoteSummary } from '../../notes/types.ts';
import {
  MAX_NOTE_BATCH_SELECTION,
  buildNoteSendTasks,
  hasAnyNoteSendOption,
  isAllNoteSendOptions,
  notePacingDelayMs,
  resolveSendableNoteLocation,
  sectionsToImport,
  withAllNoteSendOptions,
  type ImportedNoteChatMedia,
  type NoteSendOptions,
} from './note-batch-send.ts';

function makeNote(overrides: Partial<NoteSummary> = {}): NoteSummary {
  return {
    id: 'note-1',
    title: 'Trip',
    contentPreview: 'hello',
    status: 'ACTIVE',
    available: true,
    pinned: false,
    groups: [],
    cover: null,
    imageCount: 1,
    videoCount: 1,
    mediaCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function options(overrides: Partial<NoteSendOptions> = {}): NoteSendOptions {
  return { card: false, media: false, showcase: false, location: false, ...overrides };
}

test('sectionsToImport maps only media/showcase toggles', () => {
  assert.deepEqual(sectionsToImport(options({ media: true })), ['media']);
  assert.deepEqual(sectionsToImport(options({ showcase: true })), ['showcase']);
  assert.deepEqual(sectionsToImport(options({ media: true, showcase: true })), [
    'media',
    'showcase',
  ]);
  assert.deepEqual(sectionsToImport(options({ card: true, location: true })), []);
});

test('hasAnyNoteSendOption is false only when everything is off', () => {
  assert.equal(hasAnyNoteSendOption(options()), false);
  assert.equal(hasAnyNoteSendOption(options({ location: true })), true);
  assert.equal(hasAnyNoteSendOption(options({ card: true })), true);
});

test('withAllNoteSendOptions toggles all four without mutating the input', () => {
  const original = options({ card: true });
  const allOn = withAllNoteSendOptions(original, true);
  assert.deepEqual(allOn, { card: true, media: true, showcase: true, location: true });
  assert.deepEqual(original, options({ card: true }));

  const allOff = withAllNoteSendOptions(allOn, false);
  assert.equal(hasAnyNoteSendOption(allOff), false);
  assert.equal(isAllNoteSendOptions(allOn), true);
  assert.equal(isAllNoteSendOptions(original), false);
});

test('resolveSendableNoteLocation validates coordinates and trims labels', () => {
  assert.deepEqual(
    resolveSendableNoteLocation({
      title: ' 北京 ',
      address: '东城区',
      latitude: 39.9,
      longitude: 116.4,
    }),
    { latitude: 39.9, longitude: 116.4, title: '北京', address: '东城区' },
  );

  const noLabels = resolveSendableNoteLocation({
    title: '  ',
    address: null,
    latitude: -90,
    longitude: 180,
  });
  assert.deepEqual(noLabels, { latitude: -90, longitude: 180 });

  assert.equal(resolveSendableNoteLocation(null), null);
  assert.equal(resolveSendableNoteLocation(undefined), null);
  assert.equal(
    resolveSendableNoteLocation({ latitude: 39.9, longitude: null }),
    null,
  );
  assert.equal(
    resolveSendableNoteLocation({ latitude: 90.1, longitude: 0 }),
    null,
  );
  assert.equal(
    resolveSendableNoteLocation({ latitude: 0, longitude: -180.5 }),
    null,
  );
  assert.equal(
    resolveSendableNoteLocation({
      latitude: '39.9' as unknown as number,
      longitude: 116.4,
    }),
    null,
  );
});

test('buildNoteSendTasks emits only the card when just card is checked', () => {
  const note = makeNote();
  const tasks = buildNoteSendTasks(note, options({ card: true }), [], null);
  assert.deepEqual(tasks, [{ kind: 'note-card', note }]);
});

test('buildNoteSendTasks orders card, then imported media, then location', () => {
  const note = makeNote();
  const imported: ImportedNoteChatMedia[] = [
    {
      id: 'm-1',
      section: 'media',
      type: 'IMAGE',
      key: 'chat/me/a.jpg',
      width: 800,
      height: 600,
    },
    {
      id: 'm-2',
      section: 'showcase',
      type: 'VIDEO',
      key: 'chat/me/b.mp4',
      width: null,
      height: null,
      durationMs: 12400,
      size: 1024,
    },
  ];
  const tasks = buildNoteSendTasks(
    note,
    options({ card: true, media: true, showcase: true, location: true }),
    imported,
    { latitude: 1, longitude: 2, title: 'T', address: null },
  );

  assert.deepEqual(tasks, [
    { kind: 'note-card', note },
    { kind: 'image', noteId: 'note-1', key: 'chat/me/a.jpg', width: 800, height: 600 },
    {
      kind: 'video',
      noteId: 'note-1',
      key: 'chat/me/b.mp4',
      width: undefined,
      height: undefined,
      duration: 13,
      size: 1024,
    },
    { kind: 'location', noteId: 'note-1', latitude: 1, longitude: 2, title: 'T' },
  ]);
});

test('buildNoteSendTasks dedupes imported items by object key', () => {
  const note = makeNote();
  const dup: ImportedNoteChatMedia[] = [
    { id: 'm-1', section: 'media', type: 'IMAGE', key: 'chat/me/same.jpg' },
    { id: 'm-2', section: 'showcase', type: 'IMAGE', key: 'chat/me/same.jpg' },
    { id: 'm-3', section: 'showcase', type: 'IMAGE', key: 'chat/me/other.jpg' },
  ];
  const tasks = buildNoteSendTasks(note, options({ media: true, showcase: true }), dup, null);
  assert.deepEqual(
    tasks.map((task) => (task.kind === 'image' ? task.key : task.kind)),
    ['chat/me/same.jpg', 'chat/me/other.jpg'],
  );
});

test('buildNoteSendTasks video duration is ceiled seconds with a 1s floor', () => {
  const note = makeNote();
  const imported: ImportedNoteChatMedia[] = [
    { id: 'm-1', section: 'media', type: 'VIDEO', key: 'chat/me/short.mp4', durationMs: 200 },
    { id: 'm-2', section: 'media', type: 'VIDEO', key: 'chat/me/none.mp4', durationMs: null },
  ];
  const tasks = buildNoteSendTasks(note, options({ media: true }), imported, null);
  assert.equal(tasks[0].kind, 'video');
  assert.equal(tasks[0].kind === 'video' ? tasks[0].duration : null, 1);
  assert.equal(tasks[1].kind === 'video' ? tasks[1].duration : -1, undefined);
});

test('buildNoteSendTasks skips location when unchecked or invalid', () => {
  const note = makeNote();
  const valid = { latitude: 1, longitude: 2 };
  assert.deepEqual(buildNoteSendTasks(note, options({ card: true }), [], valid), [
    { kind: 'note-card', note },
  ]);
  assert.deepEqual(
    buildNoteSendTasks(note, options({ location: true }), [], null),
    [],
  );
});

test('notePacingDelayMs kicks in above the safe burst size', () => {
  assert.equal(notePacingDelayMs(1), 0);
  assert.equal(notePacingDelayMs(15), 0);
  assert.equal(notePacingDelayMs(16), 600);
  assert.equal(notePacingDelayMs(80), 600);
});

test('selection cap stays at nine notes', () => {
  assert.equal(MAX_NOTE_BATCH_SELECTION, 9);
});
