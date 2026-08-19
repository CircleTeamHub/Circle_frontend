import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForSendSlot } from './send-slot.ts';

// 从选点页回来时位置已经被 focus effect 消费掉了；发送位被占着就直接 return 的话，
// 用户选的点既不发也不报错，彻底丢失。
test('waits out an in-flight send and then reports the slot as free', async () => {
  let busy = true;
  let waits = 0;
  const free = await waitForSendSlot({
    isBusy: () => busy,
    isMounted: () => true,
    now: () => 0,
    wait: async () => {
      waits += 1;
      if (waits >= 3) busy = false;
    },
  });

  assert.equal(free, true);
  assert.equal(waits, 3, '等到那一发结束为止');
});

test('returns immediately when nothing is in flight', async () => {
  let waits = 0;
  const free = await waitForSendSlot({
    isBusy: () => false,
    isMounted: () => true,
    wait: async () => {
      waits += 1;
    },
  });

  assert.equal(free, true);
  assert.equal(waits, 0);
});

// 等不到就要返回 false，让调用方显式报错——不能变成另一种静默丢弃。
test('gives up at the deadline instead of waiting forever', async () => {
  let clock = 0;
  const free = await waitForSendSlot({
    isBusy: () => true,
    isMounted: () => true,
    timeoutMs: 500,
    pollMs: 100,
    now: () => clock,
    wait: async (ms) => {
      clock += ms;
    },
  });

  assert.equal(free, false);
});

test('stops waiting once the screen is gone', async () => {
  let mounted = true;
  let waits = 0;
  const free = await waitForSendSlot({
    isBusy: () => true,
    isMounted: () => mounted,
    now: () => 0,
    wait: async () => {
      waits += 1;
      mounted = false;
    },
  });

  assert.equal(free, false);
  assert.equal(waits, 1);
});

test('does not claim the slot for a screen that unmounted while free', async () => {
  const free = await waitForSendSlot({
    isBusy: () => false,
    isMounted: () => false,
  });

  assert.equal(free, false);
});
