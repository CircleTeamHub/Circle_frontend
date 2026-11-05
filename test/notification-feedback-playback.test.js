const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

test('selected message/circle tones play and replaced players are released', async () => {
  const players = [];
  let cleanup, now = 10000;
  const preference = { soundEnabled: true, hapticsEnabled: false, messageRingtone: 'soft', circleRingtone: 'bell' };
  const { useNotificationFeedback } = loadTsModule('src/features/notifications/hooks/use-notification-feedback.ts', {
    context: { Date: { now: () => now } },
    requireShim: request => {
      if (request === 'react') return { useCallback: fn => fn, useRef: current => ({ current }), useEffect: fn => { cleanup = fn(); } };
      if (request === '@/features/notifications/store/use-notification-feedback-store') return { useNotificationFeedbackStore: { getState: () => preference } };
      if (request.endsWith('.wav')) return request;
      if (request === 'expo-audio') return { setAudioModeAsync: async () => {}, createAudioPlayer: source => {
        const player = { source, removed: 0, played: 0, seekTo() {}, play() { this.played++; }, remove() { this.removed++; } };
        players.push(player); return player;
      } };
      throw new Error(`Unexpected import ${request}`);
    },
  });
  const notify = useNotificationFeedback();
  notify();
  await new Promise(setImmediate);
  assert.match(players[0].source, /notification-soft\.wav$/);
  assert.equal(players[0].played, 1);
  now += 2000;
  notify({ kind: 'circle' });
  await new Promise(setImmediate);
  assert.match(players[1].source, /notification-bell\.wav$/);
  assert.equal(players[0].removed, 1);
  cleanup();
  assert.equal(players[1].removed, 1);
});
