const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { ApiError } = loadTsModule('src/services/api/api-error.ts');
const textStats = loadTsModule('src/features/notes/utils/note-text-stats.ts', {
  requireShim: () => loadTsModule('src/features/notes/utils/note-blocks.ts'),
});
const utils = loadTsModule('src/features/notes/utils/note-submission.ts', {
  requireShim: (id) => id === '@/services/api/api-error' ? { ApiError } : textStats,
});
function input(overrides = {}) {
  return { title: 'Original', content: '', contentJson: [], media: [], groupIds: [], clientDraftID: 'draft',
    sections: { media: { items: [] }, showcase: { items: [] }, audio: { items: [] }, contacts: { items: [] }, groups: { items: [] }, location: null }, ...overrides };
}
function result(write, overrides = {}) {
  return { id: 'note', ...write, title: write.title.trim(), groups: write.groupIds.map((id) => ({ id })), ...overrides };
}
test('the durable submission is immutable and excludes private read signatures', () => {
  const write = input({ media: [{ type: 'IMAGE', objectKey: 'notes/owner/photo', url: 'https://private/photo?secret', sortOrder: 0 }] });
  const pending = utils.createPendingNoteSubmission(write, null);
  write.title = 'New edit'; write.media[0].objectKey = 'replacement';
  assert.equal(pending.input.title, 'Original');
  assert.equal(pending.input.media[0].objectKey, 'notes/owner/photo');
  assert.equal(pending.input.media[0].url, undefined);
  assert.ok(!JSON.stringify(pending).includes('secret'));
});
test('only explicit precommit HTTP rejections unlock a submission', () => {
  for (const status of [400, 401, 403, 404, 413, 422, 429]) assert.equal(utils.isDefinitiveNoteSubmissionFailure(new ApiError('Rejected', { status, failureKind: 'http' })), true);
  for (const options of [{ status: 409, failureKind: 'http' }, { status: 408, failureKind: 'http' }, { status: 500, failureKind: 'http' }, { status: 200, failureKind: 'invalid-json' }, { status: 0, failureKind: 'timeout' }, { status: 401, failureKind: 'session-changed' }]) assert.equal(utils.isDefinitiveNoteSubmissionFailure(new ApiError('Uncertain', options)), false);
  assert.equal(utils.isDefinitiveNoteSubmissionFailure(new Error('Unknown')), false);
});
test('normal canonicalization, media signatures/IDs, card names and group order still acknowledge the same write', () => {
  const block = { id: 'local-block', type: 'image', props: { objectKey: 'notes/owner/photo', url: 'https://old?sig' } };
  const write = input({ title: '  ' + '😀'.repeat(121) + '  ', contentJson: [block], groupIds: ['b', 'a'], sections: {
    media: { items: [{ type: 'IMAGE', objectKey: 'notes/owner/photo', sortOrder: 0 }] },
    contacts: { items: [{ id: 'friend', name: 'Old name' }] },
  } });
  const pending = utils.createPendingNoteSubmission(write, null);
  const canonical = result(write, { title: '😀'.repeat(120), contentJson: [{ ...block, id: 'server-block', props: { ...block.props, url: 'https://new?sig', posterUrl: null } }],
    sections: { media: { items: [{ ...write.sections.media.items[0], id: 'row-id', url: 'https://signed?new', width: 100 }] }, contacts: { items: [{ id: 'friend', name: 'Canonical name', faceURL: 'https://avatar' }] } }, groups: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(utils.noteSubmissionMatchesResult(pending, canonical), true);
  const automatic = utils.createPendingNoteSubmission(input({ title: '', content: 'body' }), null);
  assert.equal(utils.noteSubmissionMatchesResult(automatic, result(automatic.input, { title: 'body', content: 'body' })), true);
});
test('a different replay cannot acknowledge changes to text, region ownership, cards, groups or source note', () => {
  const write = input({ contentJson: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }] });
  const pending = utils.createPendingNoteSubmission(write, 'note');
  for (const different of [{ title: 'Different' }, { id: 'other-note' }, { contentJson: [{ type: 'paragraph', content: [{ type: 'text', text: 'Changed body' }] }] }, { groups: [{ id: 'other-group' }] }, { sections: { media: { items: [{ type: 'IMAGE', objectKey: 'different' }] } } }]) assert.equal(utils.noteSubmissionMatchesResult(pending, result(write, different)), false);
  assert.equal(utils.noteSubmissionMatchesResult(pending, {}), false);
});

test('preserved noteLayout order and media/text region bindings must match even when visible text and media keys match', () => {
  const content = [{ type: 'paragraph', content: [{ type: 'text', text: 'Same body' }] }];
  const layout = { type: 'noteLayout', props: {
    order: ['title', 'text', 'image', 'image'],
    blocks: [{ id: 'title-fixed', kind: 'title' }, { id: 'text-a', kind: 'text' }, { id: 'image-a', kind: 'image' }, { id: 'image-b', kind: 'image' }],
    textBlocks: [{ id: 'text-a', content }],
    mediaBlocks: [{ id: 'image-a', target: 'media', objectKeys: ['notes/owner/a'] }, { id: 'image-b', target: 'media', objectKeys: ['notes/owner/b'] }],
  } };
  const write = input({ contentJson: [...content, layout], sections: { media: { items: [
    { type: 'IMAGE', objectKey: 'notes/owner/a', sortOrder: 0 }, { type: 'IMAGE', objectKey: 'notes/owner/b', sortOrder: 1 },
  ] } } });
  const pending = utils.createPendingNoteSubmission(write, null);
  assert.equal(utils.noteSubmissionMatchesResult(pending, result(write)), true);
  for (const mutate of [
    (props) => { [props.blocks[2], props.blocks[3]] = [props.blocks[3], props.blocks[2]]; },
    (props) => { [props.mediaBlocks[0].objectKeys, props.mediaBlocks[1].objectKeys] = [props.mediaBlocks[1].objectKeys, props.mediaBlocks[0].objectKeys]; },
    (props) => { props.mediaBlocks[0].target = 'showcase'; },
    (props) => { props.textBlocks[0].id = 'image-a'; },
  ]) {
    const replay = JSON.parse(JSON.stringify(write.contentJson));
    mutate(replay.at(-1).props);
    assert.equal(utils.noteSubmissionMatchesResult(pending, result(write, { contentJson: replay })), false);
  }
});

test('submitted media metadata is preserved; only omitted metadata may be filled by canonical responses', () => {
  const item = { type: 'VIDEO', objectKey: 'notes/owner/video', mimeType: 'video/mp4', size: 40, width: 320, height: 180, durationMs: 1200, sortOrder: 0 };
  const write = input({ media: [item], sections: { media: { items: [{ ...item, width: 999 }] } } });
  const pending = utils.createPendingNoteSubmission(write, null);
  const canonical = result(write, { media: [{ ...item, id: 'server-row', url: 'https://signed?new' }], sections: { media: { items: [{ ...item, url: 'https://signed?new' }] } } });
  // Backend derives section metadata from top-level media, not the reference.
  assert.equal(utils.noteSubmissionMatchesResult(pending, canonical), true);
  for (const field of ['mimeType', 'size', 'width', 'height', 'durationMs']) {
    const changed = typeof item[field] === 'number' ? item[field] + 1 : 'video/other';
    assert.equal(utils.noteSubmissionMatchesResult(pending, { ...canonical, media: [{ ...canonical.media[0], [field]: changed }] }), false);
    assert.equal(utils.noteSubmissionMatchesResult(pending, { ...canonical, sections: { media: { items: [{ ...canonical.sections.media.items[0], [field]: changed }] } } }), false);
  }
  const sparse = input({ media: [{ type: item.type, objectKey: item.objectKey, sortOrder: 0 }], sections: { media: { items: [{ type: item.type, objectKey: item.objectKey, sortOrder: 0 }] } } });
  assert.equal(utils.noteSubmissionMatchesResult(utils.createPendingNoteSubmission(sparse, null), canonical), true);
});
