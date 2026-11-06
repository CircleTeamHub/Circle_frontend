import test from 'node:test';
import assert from 'node:assert/strict';
import { isSetNoteWorkStatus, noteWorkStatusFill, SET_NOTE_WORK_STATUSES } from './work-status.ts';

test('the three venue statuses are the only set values', () => {
  assert.deepEqual([...SET_NOTE_WORK_STATUSES], ['WORKING', 'CLOSED', 'OFF_SHELF']);
  for (const value of SET_NOTE_WORK_STATUSES) assert.equal(isSetNoteWorkStatus(value), true);
  for (const value of ['UNSET', 'UNLISTED', null, undefined, '']) {
    assert.equal(isSetNoteWorkStatus(value), false, String(value));
  }
});

test('each status uses its own fill colour', () => {
  const colors = { workingFill: 'green', closedFill: 'orange', offShelfFill: 'grey' } as never;
  assert.equal(noteWorkStatusFill('WORKING', colors), 'green');
  assert.equal(noteWorkStatusFill('CLOSED', colors), 'orange');
  assert.equal(noteWorkStatusFill('OFF_SHELF', colors), 'grey');
});
