// Canonical Expo Babel config. Required by jest-expo to transform RN/TS/JSX in
// behavioral (*.spec.tsx) tests; matches the preset Expo's bundler uses by
// default, so adding it is a no-op for app builds.
//
// transform-remove-console 仅在 production 构建启用（strip console.log/warn/info/debug，
// 保留 console.error 作为最后的崩溃线索；错误另有 reportError → Sentry 覆盖）。
// dev（expo start，NODE_ENV=development）与 jest（NODE_ENV=test）不剥离，本地日志照常。
// 注意：调用 api.env() 已让 babel 按 envName 分桶缓存，故不再需要 api.cache(true)。
module.exports = function (api) {
  const isProduction = api.env('production');
  return {
    presets: ['babel-preset-expo'],
    plugins: isProduction
      ? [['transform-remove-console', { exclude: ['error'] }]]
      : [],
  };
};
