const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(rel) {
  const filePath = path.join(process.cwd(), rel);
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (s) => {
      // Persist middleware needs a storage; an in-memory stub is enough here.
      if (s === "@/storage") {
        const mem = {};
        return {
          mmkvJsonStorage: {
            getItem: (k) => (k in mem ? mem[k] : null),
            setItem: (k, v) => {
              mem[k] = v;
            },
            removeItem: (k) => {
              delete mem[k];
            },
          },
        };
      }
      if (s.startsWith("@/")) return {};
      return require(s);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

const { useNotificationFeedbackStore } = load(
  "src/features/notifications/store/use-notification-feedback-store.ts",
);

test("notification feedback preferences default to on", () => {
  const state = useNotificationFeedbackStore.getState();
  assert.equal(state.soundEnabled, true);
  assert.equal(state.hapticsEnabled, true);
});

test("notification feedback toggles are independent", () => {
  const store = useNotificationFeedbackStore.getState();
  store.setSoundEnabled(false);
  assert.equal(useNotificationFeedbackStore.getState().soundEnabled, false);
  assert.equal(useNotificationFeedbackStore.getState().hapticsEnabled, true);

  store.setHapticsEnabled(false);
  assert.equal(useNotificationFeedbackStore.getState().hapticsEnabled, false);

  store.setSoundEnabled(true);
  assert.equal(useNotificationFeedbackStore.getState().soundEnabled, true);
  assert.equal(useNotificationFeedbackStore.getState().hapticsEnabled, false);
});
