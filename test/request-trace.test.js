const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

const { createRequestTraceHooks } = loadTsModule('src/observability/request-trace.ts');

// 照 RN XMLHttpRequest 的行为写的替身：原生事件广播给所有实例，按 _requestId 认领；
// requestId 未回来之前到的事件会被丢掉（iOS 上 requestId 经回调异步交回）。
function makeXhrClass() {
  class FakeXhr {
    constructor() {
      this.readyState = 1;
      this._requestId = null;
      this.listeners = [];
    }
    setRequestHeader() {}
    send() {}
    abort() {
      this.setReadyState(4);
    }
    addEventListener(type, listener) {
      if (type === 'readystatechange') this.listeners.push(listener);
    }
    setReadyState(state) {
      this.readyState = state;
      this.listeners.forEach((listener) => listener());
    }
    __didCreateRequest(requestId) {
      this._requestId = requestId;
    }
    __didReceiveResponse(requestId) {
      if (requestId === this._requestId) this.setReadyState(2);
    }
  }
  return FakeXhr;
}

function setup({ appStates = ['active'] } = {}) {
  let now = 1_000;
  let appStateListener = () => {};
  const intervals = [];
  const cleared = [];
  let appStateCalls = 0;
  const FakeXhr = makeXhrClass();
  const hooks = createRequestTraceHooks({
    now: () => now,
    getAppState: () => appStates[Math.min(appStateCalls++, appStates.length - 1)],
    subscribeAppState: (listener) => {
      appStateListener = listener;
    },
    setInterval: (callback, ms) => {
      intervals.push({ callback, ms });
      return intervals.length;
    },
    clearInterval: (handle) => cleared.push(handle),
    xhrPrototype: FakeXhr.prototype,
  });
  const send = (requestId) => {
    const xhr = new FakeXhr();
    xhr.setRequestHeader('X-Request-Id', requestId);
    xhr.send();
    return xhr;
  };
  return {
    hooks,
    send,
    FakeXhr,
    intervals,
    cleared,
    advance: (ms) => {
      now += ms;
    },
    changeAppState: () => appStateListener(),
  };
}

test('a request whose response never reaches JS is reported as acked, not done, even after the abort', () => {
  const { hooks, send, advance } = setup();
  hooks.begin('r1');
  const xhr = send('r1');
  advance(40);
  xhr.__didCreateRequest(7);
  advance(7960);
  xhr.abort(); // 定时器到点，fetch 中止 XHR —— 那不算「完成」

  const trace = hooks.finish('r1', true);
  assert.equal(trace.xhrStage, 'acked');
  assert.equal(trace.xhrAckMs, 40);
  assert.equal(trace.xhrDoneMs, undefined);
  assert.equal(trace.xhrEarlyEvent, false);
});

test('native response events that arrive before the request id are flagged as early', () => {
  const { hooks, send, FakeXhr } = setup();
  hooks.begin('r1');
  const xhr = send('r1');
  // 原生先把响应事件发过来（广播到某个实例），JS 这时还不知道 9 是谁 —— 事件被丢掉。
  new FakeXhr().__didReceiveResponse(9);
  xhr.__didCreateRequest(9);

  const trace = hooks.finish('r1', true);
  assert.equal(trace.xhrEarlyEvent, true);
  assert.equal(trace.xhrStage, 'acked');
});

test('headers and body milestones are measured from send', () => {
  const { hooks, send, advance } = setup();
  hooks.begin('r1');
  const xhr = send('r1');
  xhr.__didCreateRequest(3);
  advance(300);
  xhr.__didReceiveResponse(3);
  advance(50);
  xhr.setReadyState(3);

  const trace = hooks.finish('r1', true);
  assert.equal(trace.xhrStage, 'loading');
  assert.equal(trace.xhrHeadersMs, 300);
});

test('a request that never reached XHR.send is untracked', () => {
  const { hooks } = setup();
  hooks.begin('r1');
  const trace = hooks.finish('r1', true);
  assert.equal(trace.xhrStage, 'untracked');
  assert.equal(trace.xhrAckMs, undefined);
});

test('successful requests return no trace but count as completed while another waited', () => {
  const { hooks } = setup();
  hooks.begin('stuck');
  hooks.begin('ok-1');
  hooks.begin('ok-2');
  assert.equal(hooks.finish('ok-1', false), undefined);
  assert.equal(hooks.finish('ok-2', false), undefined);
  hooks.begin('still-going');

  const trace = hooks.finish('stuck', true);
  assert.equal(trace.completedWhileWaiting, 2);
  assert.equal(trace.inflight, 1);
});

test('the largest JS event-loop stall during the wait is captured', () => {
  const { hooks, intervals, advance } = setup();
  hooks.begin('r1');
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 500);
  advance(500);
  intervals[0].callback(); // 准时
  advance(5_500);
  intervals[0].callback(); // JS 线程被占 5s 才轮到
  advance(100);

  const trace = hooks.finish('r1', true);
  assert.equal(trace.loopLagMs, 5_000);
});

test('a stall still in progress when the request fails is counted', () => {
  const { hooks, advance } = setup();
  hooks.begin('r1');
  advance(9_000); // 采样器一次都没轮到
  const trace = hooks.finish('r1', true);
  assert.equal(trace.loopLagMs, 8_500);
});

test('the lag sampler only runs while requests are in flight', () => {
  const { hooks, intervals, cleared } = setup();
  hooks.begin('a');
  hooks.begin('b');
  assert.equal(intervals.length, 1);
  hooks.finish('a', false);
  assert.deepEqual(cleared, []);
  hooks.finish('b', false);
  assert.deepEqual(cleared, [1]);
  hooks.begin('c');
  assert.equal(intervals.length, 2);
});

test('an app-state change during the wait is recorded', () => {
  const { hooks } = setup({ appStates: ['background', 'active'] });
  hooks.begin('r1');
  const trace = hooks.finish('r1', true);
  assert.equal(trace.appState, 'active');
  assert.equal(trace.appStateChanged, true);
});

test('only requests carrying an X-Request-Id are tracked, and tracking is bounded', () => {
  const { hooks, FakeXhr } = setup();
  const anonymous = new FakeXhr();
  anonymous.send(); // 不是 apiClient 发的：不记账
  for (let i = 0; i < 100; i += 1) {
    const xhr = new FakeXhr();
    xhr.setRequestHeader('x-request-id', `leak-${i}`);
    xhr.send();
  }
  hooks.begin('leak-0');
  // 最早的记录已被淘汰，不会无限增长。
  assert.equal(hooks.finish('leak-0', true).xhrStage, 'untracked');
});

test('a request is "receiving" only between its response headers and completion', () => {
  const { hooks, send } = setup();
  hooks.begin('r1');
  const xhr = send('r1');
  xhr.__didCreateRequest(5);
  assert.equal(hooks.isReceiving('r1'), false); // 还没收到响应头：卡住的候选
  xhr.__didReceiveResponse(5);
  assert.equal(hooks.isReceiving('r1'), true); // 慢，但在下载
  xhr.setReadyState(4);
  assert.equal(hooks.isReceiving('r1'), false); // XHR 已完成，交没交到 JS 由 fetch 那边决定
  assert.equal(hooks.isReceiving('unknown'), false);
});

test('a trip to background and back during the wait is recorded even though both ends are active', () => {
  const { hooks, advance, changeAppState } = setup({ appStates: ['active', 'active'] });
  hooks.begin('r1');
  advance(1_000);
  changeAppState(); // 去后台
  advance(20_000);
  changeAppState(); // 回前台
  const trace = hooks.finish('r1', true);
  assert.equal(trace.appState, 'active');
  assert.equal(trace.appStateChanged, true);
});

test('an app-state change before the request started does not count', () => {
  const { hooks, advance, changeAppState } = setup();
  changeAppState();
  advance(10);
  hooks.begin('r1');
  assert.equal(hooks.finish('r1', true).appStateChanged, false);
});

test('re-creating the hooks (Fast Refresh) neither stacks wrappers nor keeps the old recorder', () => {
  const FakeXhr = makeXhrClass();
  let originalSends = 0;
  FakeXhr.prototype.send = function send() {
    originalSends += 1;
  };
  const deps = {
    now: () => 1_000,
    getAppState: () => 'active',
    setInterval: () => 1,
    clearInterval: () => {},
    xhrPrototype: FakeXhr.prototype,
  };
  const stale = createRequestTraceHooks(deps);
  const current = createRequestTraceHooks(deps);
  stale.begin('r1');
  current.begin('r1');

  const xhr = new FakeXhr();
  xhr.setRequestHeader('X-Request-Id', 'r1');
  xhr.send();

  assert.equal(originalSends, 1);
  assert.equal(current.finish('r1', true).xhrStage, 'sent');
  assert.equal(stale.finish('r1', true).xhrStage, 'untracked');
});
