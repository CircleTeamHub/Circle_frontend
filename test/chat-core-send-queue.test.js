const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 发送队列本身零依赖:注入连接状态、发射函数和定时器,逐个时刻推进来测。

function loadQueueModule(timers) {
  const filePath = path.join(process.cwd(), 'src/chat-core/send-queue.ts');
  const { outputText } = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });
  const context = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      throw new Error(`unexpected require: ${request}`);
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    Promise,
    Map,
    Error,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(outputText, context);
  return context.module.exports;
}

function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      pending.delete(id);
    },
    delays: () => [...pending.values()].map((timer) => timer.ms).sort((a, b) => a - b),
    run(ms) {
      for (const [id, timer] of [...pending.entries()]) {
        if (timer.ms !== ms) continue;
        pending.delete(id);
        timer.fn();
      }
    },
  };
}

class FakeSendError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup({ connected = true } = {}) {
  const timers = createFakeTimers();
  const { createChatSendQueue, CHAT_SEND_MAX_WAIT_MS } = loadQueueModule(timers);
  const link = { connected };
  // 每次发射留一个待定的 ack,由用例决定回什么。
  const attempts = [];
  const queue = createChatSendQueue({
    isConnected: () => link.connected,
    emit: (item) =>
      new Promise((resolve, reject) => {
        attempts.push({ item, resolve, reject });
      }),
    retryDelayMs: (error) => {
      if (error?.code === 'NOT_CONNECTED' || error?.code === 'ACK_TIMEOUT') return 2_000;
      if (error?.code === 'RATE_LIMITED') return 3_000;
      return null;
    },
    waitTimeoutError: (stillConnected) =>
      new FakeSendError(stillConnected ? 'ACK_TIMEOUT' : 'NOT_CONNECTED'),
  });
  const outcomes = new Map();
  const send = (conversationId, d) => {
    const promise = queue.enqueue({ conversationId, d });
    promise.then(
      (ack) => outcomes.set(d, { ok: ack }),
      (error) => outcomes.set(d, { error: error.code }),
    );
    return promise;
  };
  const emittedDs = () => attempts.map((attempt) => attempt.item.d);
  const attemptFor = (d) => [...attempts].reverse().find((attempt) => attempt.item.d === d);
  return {
    queue,
    link,
    timers,
    attempts,
    outcomes,
    send,
    emittedDs,
    attemptFor,
    maxWaitMs: CHAT_SEND_MAX_WAIT_MS,
  };
}

test('a send goes out right away while connected and resolves with its ack', async () => {
  const { send, emittedDs, attemptFor, outcomes } = setup();
  send('c1', 'd1');
  assert.deepEqual(emittedDs(), ['d1']);
  attemptFor('d1').resolve('ack-1');
  await flush();
  assert.deepEqual(outcomes.get('d1'), { ok: 'ack-1' });
});

test('offline sends wait, then go out with the same d once the connection is back', async () => {
  const { queue, link, send, emittedDs, attemptFor, outcomes } = setup({ connected: false });
  send('c1', 'd1');
  await flush();
  assert.deepEqual(emittedDs(), [], '没连上不发');
  assert.equal(outcomes.has('d1'), false, '也不立刻判失败');

  link.connected = true;
  queue.resume();
  assert.deepEqual(emittedDs(), ['d1']);
  attemptFor('d1').resolve('ack-1');
  await flush();
  assert.deepEqual(outcomes.get('d1'), { ok: 'ack-1' });
});

test('one conversation sends in order; other conversations are not held up', async () => {
  const { queue, link, send, emittedDs, attemptFor, outcomes } = setup({ connected: false });
  send('c1', 'a');
  send('c1', 'b');
  send('c2', 'x');

  link.connected = true;
  queue.resume();
  // 每个会话只发队头:b 要等 a 有结果,c2 不受 c1 影响。
  assert.deepEqual(emittedDs().sort(), ['a', 'x']);

  attemptFor('a').resolve('ack-a');
  await flush();
  assert.deepEqual(emittedDs(), ['a', 'x', 'b']);
  attemptFor('b').resolve('ack-b');
  attemptFor('x').resolve('ack-x');
  await flush();
  assert.deepEqual([...outcomes.keys()].sort(), ['a', 'b', 'x']);
});

test('a lost connection mid-send keeps the message queued and resends the same d', async () => {
  const { queue, link, send, emittedDs, attemptFor, outcomes } = setup();
  send('c1', 'd1');
  send('c1', 'd2');
  link.connected = false;
  attemptFor('d1').reject(new FakeSendError('ACK_TIMEOUT'));
  await flush();
  assert.equal(outcomes.size, 0);
  assert.deepEqual(emittedDs(), ['d1']);

  link.connected = true;
  queue.resume();
  assert.deepEqual(emittedDs(), ['d1', 'd1'], '重发仍是同一个 d,服务端按幂等处理');
  attemptFor('d1').resolve('ack-1');
  await flush();
  assert.deepEqual(emittedDs(), ['d1', 'd1', 'd2']);
});

test('a timeout while still connected retries after a pause; rate limiting waits longer', async () => {
  const { send, emittedDs, attemptFor, timers, outcomes } = setup();
  send('c1', 'd1');
  attemptFor('d1').reject(new FakeSendError('ACK_TIMEOUT'));
  await flush();
  assert.deepEqual(timers.delays(), [2_000, 60_000]);
  timers.run(2_000);
  assert.deepEqual(emittedDs(), ['d1', 'd1']);

  attemptFor('d1').reject(new FakeSendError('RATE_LIMITED'));
  await flush();
  assert.deepEqual(timers.delays(), [3_000, 60_000]);
  timers.run(3_000);
  attemptFor('d1').resolve('ack-1');
  await flush();
  assert.deepEqual(outcomes.get('d1'), { ok: 'ack-1' });
});

test('a server rejection fails that message at once and the next one goes on', async () => {
  const { send, emittedDs, attemptFor, outcomes } = setup();
  send('c1', 'blocked');
  send('c1', 'next');
  attemptFor('blocked').reject(new FakeSendError('SENSITIVE_WORD_BLOCKED'));
  await flush();
  assert.deepEqual(outcomes.get('blocked'), { error: 'SENSITIVE_WORD_BLOCKED' });
  assert.deepEqual(emittedDs(), ['blocked', 'next']);
});

test('a message that cannot go out within the wait window fails with a not-connected error', async () => {
  const { send, timers, outcomes, maxWaitMs } = setup({ connected: false });
  assert.equal(maxWaitMs, 60_000);
  send('c1', 'd1');
  send('c1', 'd2');
  timers.run(maxWaitMs);
  await flush();
  assert.deepEqual(outcomes.get('d1'), { error: 'NOT_CONNECTED' });
  assert.deepEqual(outcomes.get('d2'), { error: 'NOT_CONNECTED' });
  assert.deepEqual(timers.delays(), [], '失败后不留定时器');
});

test('the wait window does not cut off an attempt that is already on the wire', async () => {
  const { send, timers, attemptFor, outcomes, maxWaitMs, emittedDs } = setup();
  send('c1', 'slow');
  send('c1', 'late');
  send('c1', 'behind');
  timers.run(maxWaitMs);
  await flush();
  // 正在发的那条等这次的结果;排在后面、还没发过的到点就判失败。
  assert.equal(outcomes.has('slow'), false);
  assert.deepEqual(outcomes.get('late'), { error: 'ACK_TIMEOUT' });

  attemptFor('slow').reject(new FakeSendError('ACK_TIMEOUT'));
  await flush();
  assert.deepEqual(outcomes.get('slow'), { error: 'ACK_TIMEOUT' }, '过了等待时间,这次失败就是最终结果');
  assert.deepEqual(emittedDs(), ['slow']);
});

test('an expired attempt that still gets its ack succeeds', async () => {
  const { send, timers, attemptFor, outcomes, maxWaitMs } = setup();
  send('c1', 'slow');
  timers.run(maxWaitMs);
  attemptFor('slow').resolve('ack-slow');
  await flush();
  assert.deepEqual(outcomes.get('slow'), { ok: 'ack-slow' });
});

test('aborting rejects every queued send and ignores acks that arrive afterwards', async () => {
  const { queue, send, attemptFor, outcomes, timers, link } = setup();
  send('c1', 'flying');
  link.connected = false;
  send('c2', 'waiting');
  queue.abortAll(new FakeSendError('LOGGED_OUT'));
  await flush();
  assert.deepEqual(outcomes.get('flying'), { error: 'LOGGED_OUT' });
  assert.deepEqual(outcomes.get('waiting'), { error: 'LOGGED_OUT' });
  assert.deepEqual(timers.delays(), []);

  attemptFor('flying').resolve('too-late');
  await flush();
  assert.deepEqual(outcomes.get('flying'), { error: 'LOGGED_OUT' });
});

test('enqueueing a d that is already queued shares the pending send', async () => {
  const { queue, send, emittedDs } = setup({ connected: false });
  const first = send('c1', 'd1');
  const second = queue.enqueue({ conversationId: 'c1', d: 'd1' });
  assert.equal(first, second);
  assert.deepEqual(emittedDs(), []);
  queue.resume();
  await flush();
  assert.deepEqual(emittedDs(), [], '还没连上,resume 也不发');
});

test('an emit that throws synchronously is treated like a rejected attempt', async () => {
  const timers = createFakeTimers();
  const { createChatSendQueue } = loadQueueModule(timers);
  const queue = createChatSendQueue({
    isConnected: () => true,
    emit: () => {
      throw new FakeSendError('BROKEN');
    },
    retryDelayMs: () => null,
    waitTimeoutError: () => new FakeSendError('TIMEOUT'),
  });
  await assert.rejects(queue.enqueue({ conversationId: 'c1', d: 'd1' }), (error) => error.code === 'BROKEN');
});
