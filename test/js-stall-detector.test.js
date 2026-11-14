const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

const { startJsStallDetector, JS_STALL_THRESHOLD_MS } = loadTsModule('src/observability/js-stall-detector.ts');

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
  assert.equal([...timers.values()][0].ms, 1000);
  tick(1000);
  tick(9000);
  assert.deepEqual(stalls, [], 'confirmed on the next tick, not the late one');
  tick(1000);
  assert.deepEqual(stalls, [8000]);
  tick(1000);
  tick(1000);
  assert.deepEqual(stalls, [8000]);
});

test('ordinary jitter under the threshold is not a stall', () => {
  const { stalls, tick } = setup();
  tick(1000);
  tick(1000 + JS_STALL_THRESHOLD_MS - 1);
  tick(1000);
  tick(1000);
  assert.deepEqual(stalls, []);
});

test('the overdue tick right after the phone was locked and unlocked is not a stall', () => {
  const { stalls, tick, changeAppState } = setup();
  tick(1000);
  // 系统在前后台事件送达 JS 之前就挂起了进程：解锁后迟到的一拍先跑，事件紧跟着才到。
  tick(60_000);
  changeAppState('inactive', 5);
  changeAppState('background', 1);
  changeAppState('active', 1);
  tick(1000);
  tick(1000);
  assert.deepEqual(stalls, []);
});

test('nothing ticks outside the foreground, and coming back starts a fresh baseline', () => {
  const { stalls, tick, changeAppState, timers } = setup();
  tick(1000);
  changeAppState('background');
  assert.equal(timers.size, 0);
  changeAppState('active', 10 * 60_000);
  assert.equal(timers.size, 1);
  tick(1000);
  tick(1000);
  assert.deepEqual(stalls, []);
});

test('a stall the user walks away from is still reported', () => {
  const { stalls, tick, changeAppState, timers } = setup();
  tick(1000);
  tick(12_000);
  changeAppState('inactive', 2000);
  assert.deepEqual(stalls, [11_000]);
  assert.equal(timers.size, 0);
});

test('launching in the background stays idle until the app is active', () => {
  const { stalls, tick, changeAppState, timers } = setup({ appState: 'background' });
  assert.equal(timers.size, 0);
  changeAppState('active');
  assert.equal(timers.size, 1);
  tick(1000);
  assert.deepEqual(stalls, []);
});
