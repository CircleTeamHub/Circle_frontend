const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

for (const mode of ['web', 'ios', 'failure']) {
  test(`system settings handles ${mode} without an unhandled native call`, async () => {
    const alerts = [], failures = [];
    let nativeCalls = 0;
    const { openSystemSettings } = loadTsModule('src/utils/open-system-settings.ts', { requireShim: request => {
      if (request === 'react-native') return { Platform: { OS: mode === 'web' ? 'web' : 'ios' }, Alert: { alert: (...args) => alerts.push(args) }, Linking: mode === 'web' ? {} : { openSettings: async () => { nativeCalls++; if (mode === 'failure') throw new Error('unavailable'); } } };
      if (request === '@/i18n') return { __esModule: true, default: { t: key => key } };
      if (request === '@/observability/report-failure') return { reportHandledFailure: (...args) => failures.push(args) };
      throw new Error(request);
    } });
    await openSystemSettings();
    assert.equal(nativeCalls, mode === 'web' ? 0 : 1);
    assert.equal(alerts.length, mode === 'ios' ? 0 : 1);
    assert.equal(failures.length, mode === 'failure' ? 1 : 0);
  });
}
