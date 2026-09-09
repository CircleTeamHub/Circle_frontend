import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDialogButtonLayout,
  type DialogButton,
} from './app-dialog-buttons.ts';

const cancel: DialogButton = { text: '取消', style: 'cancel' };
const del: DialogButton = { text: '删除', style: 'destructive' };
const ok: DialogButton = { text: '确定' };

test('single button becomes a full-width primary action', () => {
  const layout = resolveDialogButtonLayout([ok]);
  assert.equal(layout.direction, 'row');
  assert.deepEqual(
    layout.slots.map((slot) => slot.role),
    ['primary'],
  );
});

test('single destructive button is still a filled (red) action', () => {
  const layout = resolveDialogButtonLayout([del]);
  assert.deepEqual(layout.slots.map((slot) => slot.role), ['destructive']);
});

test('two buttons: cancel goes left as secondary, the other is primary', () => {
  const layout = resolveDialogButtonLayout([ok, cancel]);
  assert.equal(layout.direction, 'row');
  assert.deepEqual(
    layout.slots.map((slot) => [slot.button.text, slot.role]),
    [
      ['取消', 'cancel'],
      ['确定', 'primary'],
    ],
  );
});

test('two buttons: destructive confirm is a red filled action', () => {
  const layout = resolveDialogButtonLayout([cancel, del]);
  assert.deepEqual(
    layout.slots.map((slot) => [slot.button.text, slot.role]),
    [
      ['取消', 'cancel'],
      ['删除', 'destructive'],
    ],
  );
});

test('two buttons without cancel: first is secondary, last is primary', () => {
  const later: DialogButton = { text: '稍后' };
  const update: DialogButton = { text: '更新' };
  const layout = resolveDialogButtonLayout([later, update]);
  assert.deepEqual(
    layout.slots.map((slot) => [slot.button.text, slot.role]),
    [
      ['稍后', 'secondary'],
      ['更新', 'primary'],
    ],
  );
});

test('three or more buttons stack as a menu with cancel pinned to the bottom', () => {
  const save: DialogButton = { text: '保存图片' };
  const share: DialogButton = { text: '分享' };
  const layout = resolveDialogButtonLayout([cancel, save, del, share]);
  assert.equal(layout.direction, 'column');
  assert.deepEqual(
    layout.slots.map((slot) => [slot.button.text, slot.role]),
    [
      ['保存图片', 'option'],
      ['删除', 'optionDestructive'],
      ['分享', 'option'],
      ['取消', 'cancel'],
    ],
  );
});

test('empty list yields an empty row so the host can fall back to a default OK', () => {
  const layout = resolveDialogButtonLayout([]);
  assert.equal(layout.direction, 'row');
  assert.deepEqual(layout.slots, []);
});

test('layout never mutates the input array', () => {
  const input = [ok, cancel];
  const snapshot = [...input];
  resolveDialogButtonLayout(input);
  assert.deepEqual(input, snapshot);
});
