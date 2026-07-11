const test = require('node:test');
const assert = require('node:assert/strict');

test('web Lottie peer runtime is installed and resolvable', () => {
  assert.doesNotThrow(() => require.resolve('@lottiefiles/dotlottie-react'));
});

test('web Lottie peer runtime exposes the React component used by the web adapter', async () => {
  const runtime = await import('@lottiefiles/dotlottie-react');
  assert.equal(typeof runtime.DotLottieReact, 'function');
});
