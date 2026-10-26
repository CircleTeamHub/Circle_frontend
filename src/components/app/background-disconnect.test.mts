import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundDisconnect } from './background-disconnect.ts';

// 安卓后台:离开超过一段时间就断开聊天长连接、交给推送。切出去马上回来不能断
// (回来要重连、重新对账,群多时比多挂几十秒更费电);还有消息没发完不能断。
function harness(options: { busy?: () => boolean } = {}) {
  const timers = new Map<number, { fn: () => void; delay: number }>();
  let nextId = 1;
  let disconnects = 0;
  const controller = createBackgroundDisconnect({
    delayMs: 60_000,
    shouldStayConnected: options.busy ?? (() => false),
    disconnect: () => {
      disconnects += 1;
    },
    setTimer: (fn, delay) => {
      const id = nextId++;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
  });
  const fire = () => {
    const entries = [...timers.entries()];
    timers.clear();
    for (const [, timer] of entries) timer.fn();
  };
  return {
    controller,
    fire,
    pending: () => [...timers.values()],
    disconnects: () => disconnects,
  };
}

test('disconnects once the app has stayed in the background for the delay', () => {
  const env = harness();
  env.controller.onBackground();
  assert.deepEqual(env.pending().map((t) => t.delay), [60_000]);
  env.fire();
  assert.equal(env.disconnects(), 1);
});

test('coming back before the delay keeps the connection', () => {
  const env = harness();
  env.controller.onBackground();
  env.controller.onForeground();
  assert.equal(env.pending().length, 0);
  assert.equal(env.disconnects(), 0);
});

test('repeated background events do not stack timers', () => {
  const env = harness();
  env.controller.onBackground();
  env.controller.onBackground();
  assert.equal(env.pending().length, 1);
});

test('unfinished sends keep the connection and it checks again later', () => {
  let busy = true;
  const env = harness({ busy: () => busy });
  env.controller.onBackground();
  env.fire();
  assert.equal(env.disconnects(), 0);
  assert.equal(env.pending().length, 1, 're-armed while sends are unfinished');

  busy = false;
  env.fire();
  assert.equal(env.disconnects(), 1);
});

test('dispose cancels a pending disconnect', () => {
  const env = harness();
  env.controller.onBackground();
  env.controller.dispose();
  assert.equal(env.pending().length, 0);
});
