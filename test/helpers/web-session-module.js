const { loadTsModule } = require('./load-ts-module');

/**
 * 装真实的 src/services/auth/web-session.ts。默认按原生（Platform.OS = 'ios'，不用 Cookie）；
 * web: true 时让它看到 'web'，走 HttpOnly Cookie 那条路。
 */
function loadWebSession({ web = false } = {}) {
  return loadTsModule('src/services/auth/web-session.ts', {
    requireShim: (request) => {
      if (request === 'react-native') return { Platform: { OS: web ? 'web' : 'ios' } };
      return require(request);
    },
  });
}

module.exports = { loadWebSession };
