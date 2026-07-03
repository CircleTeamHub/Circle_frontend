import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTransport,
  isPrivateOrLocalHost,
  evaluateTransportGuard,
} from './transport-security.ts';

test('classifyTransport: https / wss are secure', () => {
  assert.equal(classifyTransport('https://api.example.com/api/v1'), 'secure');
  assert.equal(classifyTransport('wss://rt.example.com/realtime'), 'secure');
});

test('classifyTransport: http / ws to a public host is insecure-remote', () => {
  assert.equal(
    classifyTransport('http://api.example.com/api/v1'),
    'insecure-remote',
  );
  assert.equal(classifyTransport('ws://rt.example.com:10001'), 'insecure-remote');
});

test('classifyTransport: private / localhost hosts are insecure-local', () => {
  assert.equal(classifyTransport('http://localhost:3000/api/v1'), 'insecure-local');
  assert.equal(classifyTransport('http://127.0.0.1:3000'), 'insecure-local');
  assert.equal(classifyTransport('http://192.168.1.10:3000'), 'insecure-local');
  assert.equal(classifyTransport('http://10.0.2.2:3000'), 'insecure-local');
  assert.equal(classifyTransport('ws://172.16.5.4:10001'), 'insecure-local');
});

test('classifyTransport: unparseable / non-http(s) inputs do not block', () => {
  assert.equal(classifyTransport('not a url'), 'unparseable');
  assert.equal(classifyTransport('ftp://example.com'), 'unparseable');
});

test('isPrivateOrLocalHost respects the 172.16.0.0/12 boundaries', () => {
  assert.equal(isPrivateOrLocalHost('172.15.0.1'), false);
  assert.equal(isPrivateOrLocalHost('172.16.0.1'), true);
  assert.equal(isPrivateOrLocalHost('172.31.255.255'), true);
  assert.equal(isPrivateOrLocalHost('172.32.0.1'), false);
  assert.equal(isPrivateOrLocalHost('8.8.8.8'), false);
});

test('evaluateTransportGuard: dev build never blocks (local dev unaffected)', () => {
  assert.equal(
    evaluateTransportGuard('http://api.example.com', 'API_URL', {
      isDev: true,
      allowInsecure: false,
    }),
    null,
  );
});

test('evaluateTransportGuard: explicit opt-in never blocks (plaintext test IP)', () => {
  assert.equal(
    evaluateTransportGuard('http://203.0.113.7:3000', 'API_URL', {
      isDev: false,
      allowInsecure: true,
    }),
    null,
  );
});

test('evaluateTransportGuard: release + public http is blocked with a helpful message', () => {
  const msg = evaluateTransportGuard('http://api.example.com', 'API_URL', {
    isDev: false,
    allowInsecure: false,
  });
  assert.ok(typeof msg === 'string');
  assert.ok(msg.includes('API_URL'));
  assert.ok(msg.includes('EXPO_PUBLIC_ALLOW_INSECURE_TRANSPORT'));
});

test('evaluateTransportGuard: release + https is allowed', () => {
  assert.equal(
    evaluateTransportGuard('https://api.example.com/api/v1', 'API_URL', {
      isDev: false,
      allowInsecure: false,
    }),
    null,
  );
});

test('evaluateTransportGuard: release + private-IP http is allowed (LAN self-host)', () => {
  assert.equal(
    evaluateTransportGuard('http://192.168.1.10:3000', 'API_URL', {
      isDev: false,
      allowInsecure: false,
    }),
    null,
  );
});
