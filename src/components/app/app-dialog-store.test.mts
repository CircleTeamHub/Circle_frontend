import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dismissDialog,
  resolveDialogDismissal,
  showDialog,
  useAppDialogStore,
} from './app-dialog-store.ts';

test.beforeEach(() => {
  useAppDialogStore.getState().reset();
});

test('showDialog enqueues in call order and returns an id', () => {
  const first = showDialog({ title: 'A' });
  const second = showDialog({ title: 'B', message: 'b' });

  const { queue } = useAppDialogStore.getState();
  assert.equal(queue.length, 2);
  assert.equal(queue[0].id, first);
  assert.equal(queue[0].title, 'A');
  assert.equal(queue[1].id, second);
  assert.notEqual(first, second);
});

test('dismissDialog removes exactly that dialog', () => {
  const first = showDialog({ title: 'A' });
  const second = showDialog({ title: 'B' });

  dismissDialog(first);

  const { queue } = useAppDialogStore.getState();
  assert.deepEqual(
    queue.map((dialog) => dialog.id),
    [second],
  );
});

test('identical dialog fired twice while the first is still pending is collapsed', () => {
  const buttons = [{ text: '取消', style: 'cancel' as const }, { text: '退出' }];
  showDialog({ title: '退出群聊', message: '确定？', buttons });
  showDialog({ title: '退出群聊', message: '确定？', buttons });

  assert.equal(useAppDialogStore.getState().queue.length, 1);
});

test('prompt dialogs are never collapsed (each carries its own input)', () => {
  showDialog({ title: '重命名', prompt: { defaultValue: 'a' } });
  showDialog({ title: '重命名', prompt: { defaultValue: 'a' } });

  assert.equal(useAppDialogStore.getState().queue.length, 2);
});

test('dismissal: explicit cancelable wins and does not press any button', () => {
  const cancel = { text: '取消', style: 'cancel' as const };
  const decision = resolveDialogDismissal({
    id: 1,
    title: 'x',
    buttons: [cancel, { text: '确定' }],
    cancelable: true,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.cancelButton, undefined);
});

test('dismissal: explicit cancelable=false locks the dialog even with a cancel button', () => {
  const decision = resolveDialogDismissal({
    id: 1,
    title: 'x',
    buttons: [{ text: '取消', style: 'cancel' }, { text: '确定' }],
    cancelable: false,
  });
  assert.equal(decision.allowed, false);
});

test('dismissal: a cancel button implies dismissable, and the dismissal presses it', () => {
  const cancel = { text: '取消', style: 'cancel' as const, onPress: () => {} };
  const decision = resolveDialogDismissal({
    id: 1,
    title: 'x',
    buttons: [cancel, { text: '确定' }],
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.cancelButton, cancel);
});

test('dismissal: no cancel button and no flag means the dialog stays put', () => {
  const decision = resolveDialogDismissal({
    id: 1,
    title: 'x',
    buttons: [{ text: '知道了' }],
  });
  assert.equal(decision.allowed, false);
});
