const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
function loadQueue() {
  const timers = new Map(); let id = 0;
  const { createNoteDraftSaveQueue } = loadTsModule('src/features/notes/utils/note-draft-save-queue.ts', { context: {
    setTimeout: (callback) => { timers.set(++id, callback); return id; }, clearTimeout: (key) => timers.delete(key),
  } });
  return { queue: createNoteDraftSaveQueue(), tick: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((callback) => callback()); }, timers };
}
test('a delayed active save has only one latest replacement, and flush persists final text', async () => {
  const { queue, tick, timers } = loadQueue(); const saved = []; let resolveActive;
  const gate = new Promise((resolve) => { resolveActive = resolve; });
  const first = queue.schedule(async () => { saved.push('first'); await gate; return true; }); tick();
  const outcomes = [];
  for (let index = 0; index < 100; index++) outcomes.push(queue.schedule(async () => { saved.push('text-' + index); return true; }));
  assert.equal(timers.size, 1); tick(); assert.deepEqual(saved, ['first']);
  const flushing = queue.flush(); resolveActive(); await flushing;
  assert.deepEqual(saved, ['first', 'text-99']); assert.equal(await first, true);
  assert.deepEqual(await Promise.all(outcomes), [...Array(99).fill(false), true]); assert.equal(timers.size, 0);
});
test('route/account cancellation releases queued work without starting it or affecting active work', async () => {
  const { queue, tick, timers } = loadQueue(); let calls = 0;
  const queued = queue.schedule(async () => { calls++; return true; }); queue.cancel(); tick();
  assert.equal(await queued, false); assert.equal(calls, 0); assert.equal(timers.size, 0);
  const next = queue.schedule(async () => { calls++; return true; }); await queue.flush();
  assert.equal(await next, true); assert.equal(calls, 1);
});
