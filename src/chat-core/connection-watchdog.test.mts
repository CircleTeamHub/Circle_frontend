import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_STUCK_DISCONNECT_MS, createConnectionWatchdog } from './connection-watchdog.ts';

function setup({ reconnectPending = false } = {}) {
  let clock = 0;
  let pending = reconnectPending;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextId = 1;
  const stuck: number[] = [];
  const watchdog = createConnectionWatchdog({
    now: () => clock,
    setTimeout: (run, ms) => {
      const id = nextId++;
      timers.set(id, { at: clock + ms, run });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id as number);
    },
    isReconnectPending: () => pending,
    onStuck: (durationMs) => stuck.push(durationMs),
  });
  const advance = (ms: number) => {
    const until = clock + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].run();
    }
    clock = until;
  };
  return { watchdog, stuck, advance, setPending: (value: boolean) => { pending = value; } };
}

const down = { expected: true, foreground: true, connected: false };

test('a foreground session left disconnected with nothing reconnecting is reported once', () => {
  const { watchdog, stuck, advance } = setup();
  watchdog.update(down);
  advance(CHAT_STUCK_DISCONNECT_MS - 1);
  assert.deepEqual(stuck, []);
  advance(1);
  assert.deepEqual(stuck, [CHAT_STUCK_DISCONNECT_MS]);

  watchdog.update(down);
  advance(CHAT_STUCK_DISCONNECT_MS * 3);
  assert.equal(stuck.length, 1);
});

// 离线时 socket.io 一直在退避重连，connect_error 已经报过了；这里只抓「没人在重连」的。
test('a disconnect that socket.io is still retrying is not reported, however long', () => {
  const { watchdog, stuck, advance, setPending } = setup({ reconnectPending: true });
  watchdog.update(down);
  advance(CHAT_STUCK_DISCONNECT_MS * 5);
  assert.deepEqual(stuck, []);

  setPending(false);
  advance(CHAT_STUCK_DISCONNECT_MS);
  assert.equal(stuck.length, 1);
  assert.ok(stuck[0] >= CHAT_STUCK_DISCONNECT_MS * 6);
});

test('reconnecting, going to the background or signing out in time keeps it quiet', () => {
  for (const recovered of [
    { ...down, connected: true },
    { ...down, foreground: false },
    { ...down, expected: false },
  ]) {
    const { watchdog, stuck, advance } = setup();
    watchdog.update(down);
    advance(CHAT_STUCK_DISCONNECT_MS / 2);
    watchdog.update(recovered);
    advance(CHAT_STUCK_DISCONNECT_MS);
    assert.deepEqual(stuck, [], JSON.stringify(recovered));
  }
});

test('after a real reconnect a later stuck episode is reported again', () => {
  const { watchdog, stuck, advance } = setup();
  watchdog.update(down);
  advance(CHAT_STUCK_DISCONNECT_MS);
  watchdog.update({ ...down, connected: true });
  watchdog.update(down);
  advance(CHAT_STUCK_DISCONNECT_MS);
  assert.equal(stuck.length, 2);
});
