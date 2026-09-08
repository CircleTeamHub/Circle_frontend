import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hideTopNotice,
  showTopNotice,
  topNotice,
  useTopNoticeStore,
} from './top-notice-store.ts';

test.beforeEach(() => {
  useTopNoticeStore.getState().reset();
});

test('showTopNotice replaces the current notice (latest wins, no queue)', () => {
  showTopNotice({ type: 'success', title: '已保存' });
  const second = showTopNotice({ type: 'error', title: '保存失败' });

  const { current } = useTopNoticeStore.getState();
  assert.equal(current?.id, second);
  assert.equal(current?.title, '保存失败');
  assert.equal(current?.type, 'error');
});

test('defaults: info type and a per-type duration', () => {
  showTopNotice({ title: '提示' });
  const info = useTopNoticeStore.getState().current;
  assert.equal(info?.type, 'info');
  assert.ok(info && info.durationMs > 0);

  showTopNotice({ type: 'error', title: '出错了' });
  const error = useTopNoticeStore.getState().current;
  assert.ok(error && info && error.durationMs > info.durationMs, 'errors stay longer');
});

test('explicit durationMs is honoured', () => {
  showTopNotice({ title: '慢一点', durationMs: 9000 });
  assert.equal(useTopNoticeStore.getState().current?.durationMs, 9000);
});

test('hideTopNotice(id) only hides that notice, not a newer one', () => {
  const stale = showTopNotice({ title: 'old' });
  const fresh = showTopNotice({ title: 'new' });

  hideTopNotice(stale);
  assert.equal(useTopNoticeStore.getState().current?.id, fresh);

  hideTopNotice(fresh);
  assert.equal(useTopNoticeStore.getState().current, null);
});

test('hideTopNotice() without an id clears whatever is showing', () => {
  showTopNotice({ title: 'x' });
  hideTopNotice();
  assert.equal(useTopNoticeStore.getState().current, null);
});

test('typed helpers set the type and pass the message through', () => {
  topNotice.success('已复制', '链接已复制到剪贴板');
  const current = useTopNoticeStore.getState().current;
  assert.equal(current?.type, 'success');
  assert.equal(current?.title, '已复制');
  assert.equal(current?.message, '链接已复制到剪贴板');

  topNotice.warning('注意');
  assert.equal(useTopNoticeStore.getState().current?.type, 'warning');
});
