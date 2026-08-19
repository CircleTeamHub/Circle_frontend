// The React Native Sentry entry point starts a cleanup interval as a module
// side effect. Behavior tests exercise our own observability adapter, not the
// native SDK runtime, so keep the boundary inert and deterministic in Jest.
module.exports = {
  init() {},
  wrap(component) {
    return component;
  },
  setUser() {},
  captureException() {},
};
