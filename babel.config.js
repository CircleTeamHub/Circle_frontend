// Canonical Expo Babel config. Required by jest-expo to transform RN/TS/JSX in
// behavioral (*.spec.tsx) tests; matches the preset Expo's bundler uses by
// default, so adding it is a no-op for app builds.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
