import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldWarnNoteWorkStatus } from './note-work-status.ts';

test('work status warning is shown for closed or unlisted notes', () => {
  assert.equal(shouldWarnNoteWorkStatus({ workStatus: 'CLOSED', publicationStatus: 'ACTIVE' }), true);
  assert.equal(shouldWarnNoteWorkStatus({ workStatus: 'UNSET', publicationStatus: 'ACTIVE' }), false);
  assert.equal(shouldWarnNoteWorkStatus({ workStatus: 'WORKING', publicationStatus: 'UNLISTED' }), true);
  assert.equal(shouldWarnNoteWorkStatus({ workStatus: 'WORKING', publicationStatus: 'ACTIVE' }), false);
});

test('deleted notes are left to the server authorization decision', () => {
  assert.equal(
    shouldWarnNoteWorkStatus({ workStatus: 'WORKING', publicationStatus: 'DELETED' }),
    false,
  );
});
