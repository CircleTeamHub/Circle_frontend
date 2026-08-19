const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const scenarios = ['chat-send', 'chat-fan-in', 'circle-join', 'inbox-seed'];

test('all load scenarios use shared guarded config and account data', () => {
  for (const name of scenarios) {
    const source = fs.readFileSync(
      path.join(root, 'load-tests', 'scenarios', `${name}.js`),
      'utf8',
    );
    assert.match(source, /parseRuntimeConfig\(__ENV\)/, name);
    assert.match(source, /loadAccounts\(/, name);
    assert.doesNotMatch(source, /api\.windnote\.ai|windnote\.ai\/api/i, name);
    assert.doesNotMatch(source, /accessToken\s*:\s*['"][^'"]+['"]/, name);
  }
});

test('chat scenarios measure ack failures and end-to-end delivery', () => {
  const sharedSession = fs.readFileSync(
    path.join(root, 'load-tests', 'lib', 'socket-session.js'),
    'utf8',
  );
  for (const name of ['chat-send', 'chat-fan-in', 'inbox-seed']) {
    const source = fs.readFileSync(
      path.join(root, 'load-tests', 'scenarios', `${name}.js`),
      'utf8',
    );
    assert.match(source, /chatAckMs/, name);
    assert.match(source, /chatSendFailed/, name);
    assert.match(source, /chatDeliveryMs/, name);
    assert.match(source + sharedSession, /WINDNOTE-LOAD-\$\{config\.runId\}/, name);
  }
});

test('circle join is REST-based, bounded, and cleans up test memberships', () => {
  const source = fs.readFileSync(
    path.join(root, 'load-tests', 'scenarios', 'circle-join.js'),
    'utf8',
  );
  assert.match(source, /\/circle\/\$\{circleId\}\/join/);
  assert.match(source, /\/circle\/\$\{circleId\}\/leave/);
  assert.match(source, /LOAD_CIRCLE_CLEANUP/);
  assert.match(source, /join_failed/);
});

test('fixture preparation emits metadata only and rejects secrets', () => {
  const source = fs.readFileSync(
    path.join(root, 'scripts', 'prepare-performance-fixture.mjs'),
    'utf8',
  );
  assert.match(source, /LOAD_PERFORMANCE_FIXTURE=true/);
  assert.match(source, /conversationIds/);
  assert.match(source, /accessToken/);
  assert.match(source, /must not be written/i);
});
