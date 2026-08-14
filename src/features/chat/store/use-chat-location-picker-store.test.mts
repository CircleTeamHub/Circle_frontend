import test from 'node:test';
import assert from 'node:assert/strict';
import { useChatLocationPickerStore } from './use-chat-location-picker-store.ts';

const place = {
  title: '中心公园',
  address: '某市某区某路 1 号',
  latitude: 22.5431,
  longitude: 114.0579,
};

function reset() {
  useChatLocationPickerStore.setState({ pending: null });
}

test('the originating conversation consumes its own picked location', () => {
  reset();
  const { setPickedLocation, consumePickedLocation } =
    useChatLocationPickerStore.getState();

  setPickedLocation(place, 'sg_chat-a');

  assert.deepEqual(consumePickedLocation('sg_chat-a'), place);
  // 单次消费：再进一次同一个会话不该重发。
  assert.equal(consumePickedLocation('sg_chat-a'), null);
});

// ChatDetailScreen 一获得焦点就消费并**直接发出去**，所以别的会话绝不能拿到它。
test('another conversation never receives a location picked elsewhere', () => {
  reset();
  const { setPickedLocation, consumePickedLocation } =
    useChatLocationPickerStore.getState();

  setPickedLocation(place, 'sg_chat-a');

  assert.equal(consumePickedLocation('sg_chat-b'), null);
  // 而且不能留在 store 里等原会话——孤儿结果一律丢弃。
  assert.equal(consumePickedLocation('sg_chat-a'), null);
  assert.equal(useChatLocationPickerStore.getState().pending, null);
});

// 深链直接进 /location-picker（没有 conversationID）确认出来的结果，谁也不该消费。
test('a standalone picker result is not sent to whichever chat opens next', () => {
  reset();
  const { setPickedLocation, consumePickedLocation } =
    useChatLocationPickerStore.getState();

  setPickedLocation(place, null);

  assert.equal(consumePickedLocation('sg_chat-a'), null);
  assert.equal(useChatLocationPickerStore.getState().pending, null);
});

test('clearing drops a pending result outright', () => {
  reset();
  const { setPickedLocation, clearPickedLocation, consumePickedLocation } =
    useChatLocationPickerStore.getState();

  setPickedLocation(place, 'sg_chat-a');
  clearPickedLocation();

  assert.equal(consumePickedLocation('sg_chat-a'), null);
});
