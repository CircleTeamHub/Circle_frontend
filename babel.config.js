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
    presets: [
      // unstable_transformImportMeta：web 端 Metro 会按 package exports 的
      // "import" 条件选中 zustand v5 的 ESM 档，里面带裸 `import.meta.env`
      // （middleware/devtools 分支，仅被解析、不会执行）。dev bundle 是经典
      // script，裸 import.meta 属解析期 SyntaxError —— 整包拒绝执行、直接
      // 白屏。此选项让 babel 把 import.meta 编译成 expo winter 运行时的
      // shim；原生与 jest 同受其益（jest 遇裸 import.meta 一样抛）。
      ['babel-preset-expo', { unstable_transformImportMeta: true }],
    ],
    plugins: isProduction
      ? [['transform-remove-console', { exclude: ['error'] }]]
      : [],
  };
};
