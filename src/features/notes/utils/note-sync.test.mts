import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../../services/api/api-error.ts';
import type { NoteSummary } from '../types.ts';
import {
  applyNoteSourceStatusToSummaries,
  isRetryableNoteSyncError,
  withNoteSyncRetry,
} from './note-sync.ts';

test('note sync retries transient failures and returns the latest read', async () => {
  let attempts = 0;
  const delays: number[] = [];
  const result = await withNoteSyncRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new ApiError('temporary', { status: 503 });
      return 'fresh';
    },
    { delaysMs: [10, 20], sleep: async (delayMs) => delays.push(delayMs) },
  );

  assert.equal(result, 'fresh');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
});

test('note sync does not retry authentication or permission failures', () => {
  assert.equal(isRetryableNoteSyncError(new ApiError('unauthorized', { status: 401 })), false);
  assert.equal(isRetryableNoteSyncError(new ApiError('forbidden', { status: 403 })), false);
  assert.equal(isRetryableNoteSyncError(new ApiError('offline', { status: 0 })), true);
  assert.equal(isRetryableNoteSyncError(new ApiError('server', { status: 500 })), true);
});

test('note sync stops after the configured retry budget', async () => {
  let attempts = 0;
  await assert.rejects(
    withNoteSyncRetry(
      async () => {
        attempts += 1;
        throw new ApiError('still unavailable', { status: 503 });
      },
      { delaysMs: [1, 2], sleep: async () => undefined },
    ),
  );
  assert.equal(attempts, 3);
});

test('source status patch updates the source row and collected copies', () => {
  const source: NoteSummary = {
    id: 'source-1',
    title: 'source',
    contentPreview: null,
    status: 'ACTIVE',
    available: true,
    workStatus: 'WORKING',
    pinned: false,
    groups: [],
    cover: null,
    imageCount: 0,
    videoCount: 0,
    mediaCount: 0,
    createdAt: '',
    updatedAt: '',
  };
  const copy = {
    ...source,
    id: 'copy-1',
    title: 'edited copy title',
    contentPreview: 'edited copy content',
    collectedFrom: {
      conversationType: 'group' as const,
      conversationID: 'conversation-1',
      clientMsgID: 'message-1',
      sender: { id: 'boss', name: 'Boss' },
      sourceNoteId: 'source-1',
    },
  };
  const unchanged = { ...source, id: 'unrelated' };
  const updated = applyNoteSourceStatusToSummaries(
    [source, copy, unchanged],
    { sourceNoteId: 'source-1', status: 'UNLISTED', available: false, workStatus: 'CLOSED' },
  );

  assert.equal(updated[0].status, 'UNLISTED');
  assert.equal(updated[1].workStatus, 'CLOSED');
  assert.equal(updated[1].title, 'edited copy title');
  assert.equal(updated[1].contentPreview, 'edited copy content');
  assert.equal(updated[2], unchanged);
});
