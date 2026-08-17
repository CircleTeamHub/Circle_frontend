import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildQrUrl, parseQrToken } from './qr-payload.ts';

const TOKEN = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6';

test('build 出的载荷能被 parse 回读(往返)', () => {
  assert.equal(parseQrToken(buildQrUrl(TOKEN)), TOKEN);
});

test('两个注册 scheme 都能解析,query 与 path 两种形态都认', () => {
  assert.equal(parseQrToken(`circleim://qr?t=${TOKEN}`), TOKEN);
  assert.equal(parseQrToken(`windnoteai://qr?t=${TOKEN}`), TOKEN);
  assert.equal(parseQrToken(`circleim://qr/${TOKEN}`), TOKEN);
});

test('universal link 域名解析,其他域名拒绝', () => {
  assert.equal(parseQrToken(`https://windnote.ai/qr?t=${TOKEN}`), TOKEN);
  assert.equal(parseQrToken(`https://www.circle.im/qr/${TOKEN}`), TOKEN);
  assert.equal(parseQrToken(`https://evil.example/qr?t=${TOKEN}`), null);
});

test('非 qr 路径 / 缺 token / 非法字符集一律返回 null', () => {
  assert.equal(parseQrToken('circleim://messages/add-friend'), null);
  assert.equal(parseQrToken('circleim://qr?t='), null);
  assert.equal(parseQrToken('circleim://qr'), null);
  assert.equal(parseQrToken('circleim://qr?t=short'), null);
  assert.equal(parseQrToken('circleim://qr?t=has%20space%20padpadpad'), null);
  assert.equal(parseQrToken('https://windnote.ai'), null);
  assert.equal(parseQrToken('random text'), null);
});

test('前后空白与尾随 fragment 不影响解析', () => {
  assert.equal(parseQrToken(`  circleim://qr?t=${TOKEN}  `), TOKEN);
  assert.equal(parseQrToken(`https://windnote.ai/qr?t=${TOKEN}#x`), TOKEN);
  assert.equal(parseQrToken(`circleim://qr/${TOKEN}?src=camera`), TOKEN);
});
