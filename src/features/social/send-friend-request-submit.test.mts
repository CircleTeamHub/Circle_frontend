import test from 'node:test';
import assert from 'node:assert/strict';
import { getFriendRequestSubmitState } from './send-friend-request-submit.ts';

test('friend request submit is disabled without a profile', () => {
  assert.deepEqual(
    getFriendRequestSubmitState({
      hasProfile: false,
      isSubmitting: false,
      isUploadingPhoto: false,
    }),
    { disabled: true, activity: 'idle' },
  );
});

test('friend request submit is disabled while submitting', () => {
  assert.deepEqual(
    getFriendRequestSubmitState({
      hasProfile: true,
      isSubmitting: true,
      isUploadingPhoto: false,
    }),
    { disabled: true, activity: 'submitting' },
  );
});

test('friend request submit is disabled while a photo is uploading', () => {
  assert.deepEqual(
    getFriendRequestSubmitState({
      hasProfile: true,
      isSubmitting: false,
      isUploadingPhoto: true,
    }),
    { disabled: true, activity: 'uploading' },
  );
});

test('friend request submit is enabled when ready', () => {
  assert.deepEqual(
    getFriendRequestSubmitState({
      hasProfile: true,
      isSubmitting: false,
      isUploadingPhoto: false,
    }),
    { disabled: false, activity: 'idle' },
  );
});
