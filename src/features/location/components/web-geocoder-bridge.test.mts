import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleWebGeocoderBridgeRequest,
  type GeocoderMessageTarget,
} from './web-geocoder-bridge.ts';

function target() {
  const messages: string[] = [];
  return {
    messages,
    frame: {
      postMessage(message: string) {
        messages.push(message);
      },
    } satisfies GeocoderMessageTarget,
  };
}

function deferredResponse() {
  let resolve!: (value: Pick<Response, 'ok' | 'json'>) => void;
  const promise = new Promise<Pick<Response, 'ok' | 'json'>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('reload responses stay bound to the frame that issued the request', async () => {
  const a = target();
  const b = target();
  const fetchA = deferredResponse();
  const fetchB = deferredResponse();
  const data = JSON.stringify({
    type: 'geocoder-request',
    requestId: 1,
    path: '/search',
    params: { q: 'Shenzhen', limit: 1 },
  });

  assert.equal(
    handleWebGeocoderBridgeRequest({
      data,
      requestSource: a.frame,
      geocoderBaseUrl: 'https://geo.example.test',
      fetchImpl: () => fetchA.promise,
    }),
    true,
  );
  // A reload creates frame B, whose request ids also restart at 1.
  handleWebGeocoderBridgeRequest({
    data,
    requestSource: b.frame,
    geocoderBaseUrl: 'https://geo.example.test',
    fetchImpl: () => fetchB.promise,
  });

  fetchA.resolve({ ok: true, json: async () => [{ name: 'old' }] });
  await fetchA.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(a.messages.length, 1);
  assert.equal(b.messages.length, 0);

  fetchB.resolve({ ok: true, json: async () => [{ name: 'new' }] });
  await fetchB.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(b.messages.length, 1);
  assert.deepEqual(JSON.parse(b.messages[0]).data, [{ name: 'new' }]);
});

test('invalid paths and fetch failures fail closed without escaping the bridge', async () => {
  const invalid = target();
  let fetchCalls = 0;
  handleWebGeocoderBridgeRequest({
    data: JSON.stringify({
      type: 'geocoder-request',
      requestId: 7,
      path: '/admin',
      params: {},
    }),
    requestSource: invalid.frame,
    geocoderBaseUrl: 'https://geo.example.test',
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('must not run');
    },
  });
  assert.equal(fetchCalls, 0);
  assert.equal(JSON.parse(invalid.messages[0]).ok, false);

  const failed = target();
  handleWebGeocoderBridgeRequest({
    data: JSON.stringify({
      type: 'geocoder-request',
      requestId: 8,
      path: '/reverse',
      params: { lat: 1, lon: 2 },
    }),
    requestSource: failed.frame,
    geocoderBaseUrl: 'https://geo.example.test',
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.parse(failed.messages[0]).ok, false);
});
