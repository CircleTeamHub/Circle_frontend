import { useSharePickerStore } from './use-share-picker-store';

// 回归:选择结果曾不分会话,哪个聊天页先拿到焦点就被哪个取走 —— 从别的 tab 进的聊天选完笔记,
// 落到消息列表后随手点开另一个会话,笔记就发到了那个会话。
beforeEach(() => {
  useSharePickerStore.setState({ pending: null });
});

test('only the chat that opened the picker gets the picked item', () => {
  useSharePickerStore.getState().setPending('peer-a', { kind: 'quick-reply', data: '你好' });

  expect(useSharePickerStore.getState().consumeFor('peer-b')).toBeNull();
});

test('a pick that reached the wrong chat is dropped, not kept for later', () => {
  useSharePickerStore.getState().setPending('peer-a', { kind: 'quick-reply', data: '你好' });

  useSharePickerStore.getState().consumeFor('peer-b');

  expect(useSharePickerStore.getState().consumeFor('peer-a')).toBeNull();
});

test('the opening chat takes the pick once', () => {
  useSharePickerStore.getState().setPending('peer-a', { kind: 'quick-reply', data: '你好' });

  expect(useSharePickerStore.getState().consumeFor('peer-a')).toEqual({ kind: 'quick-reply', data: '你好' });
  expect(useSharePickerStore.getState().consumeFor('peer-a')).toBeNull();
});
