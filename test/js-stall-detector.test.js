const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

const { startJsStallDetector, JS_STALL_THRESHOLD_MS, JS_STALL_TICK_MS: TICK } = loadTsModule('src/observability/js-stall-detector.ts');

function setup({ appState = 'active' } = {}) {
  let now = 10_000;
  let state = appState;
  let listener = () => {};
  const timers = new Map();
  let nextId = 1;
  const stalls = [];
  startJsStallDetector({
    now: () => now,
    getAppState: () => state,
    subscribeAppState: (fn) => {
      listener = fn;
    },
    setInterval: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { callback, ms });
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    onStall: (durationMs) => stalls.push(durationMs),
  });
  // 时钟走 ms 毫秒后，定时器才跑下一拍：JS 线程卡住时，就是这一拍迟到了很久。
  const tick = (ms) => {
    now += ms;
    for (const { callback } of [...timers.values()]) callback();
  };
  const changeAppState = (next, afterMs = 0) => {
    now += afterMs;
    state = next;
    listener();
  };
  return { stalls, tick, changeAppState, timers };
}

test('a foreground stall is reported with its length once the loop runs again', () => {
  const { stalls, tick, timers } = setup();
  assert.equal(timers.size, 1);
  // iOS 的 RCTTiming 只在下一个定时器超过 1 秒后才停掉 display link:1 秒一拍会让它在前台每帧都唤醒 JS 线程。
  assert.equal([...timers.values()][0].ms, 2000);
  tick(TICK);
  tick(TICK + 8000);
  assert.deepEqual(stalls, [], 'confirmed on the next tick, not the late one');
  tick(TICK);
  assert.deepEqual(stalls, [8000]);
  tick(TICK);
  tick(TICK);
  assert.deepEqual(stalls, [8000]);
});

test('ordinary jitter under the threshold is not a stall', () => {
  const { stalls, tick } = setup();
  tick(TICK);
  tick(TICK + JS_STALL_THRESHOLD_MS - 1);
  tick(TICK);
  tick(TICK);
  assert.deepEqual(stalls, []);
});

test('the overdue tick right after the phone was locked and unlocked is not a stall', () => {
  const { stalls, tick, changeAppState } = setup();
  tick(TICK);
  // 系统在前后台事件送达 JS 之前就挂起了进程：解锁后迟到的一拍先跑，事件紧跟着才到。
  tick(60_000);
  changeAppState('inactive', 5);
  changeAppState('background', 1);
  changeAppState('active', 1);
  tick(TICK);
  tick(TICK);
  assert.deepEqual(stalls, []);
});

test('nothing ticks outside the foreground, and coming back starts a fresh baseline', () => {
  const { stalls, tick, changeAppState, timers } = setup();
  tick(TICK);
  changeAppState('background');
  assert.equal(timers.size, 0);
  changeAppState('active', 10 * 60_000);
  assert.equal(timers.size, 1);
  tick(TICK);
  tick(TICK);
  assert.deepEqual(stalls, []);
});

test('a stall the user walks away from is still reported', () => {
  const { stalls, tick, changeAppState, timers } = setup();
  tick(TICK);
  tick(TICK + 11_000);
  changeAppState('inactive', 2000);
  assert.deepEqual(stalls, [11_000]);
  assert.equal(timers.size, 0);
});

test('launching in the background stays idle until the app is active', () => {
  const { stalls, tick, changeAppState, timers } = setup({ appState: 'background' });
  assert.equal(timers.size, 0);
  changeAppState('active');
  assert.equal(timers.size, 1);
  tick(TICK);
  assert.deepEqual(stalls, []);
});
