const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadImagePickerModuleWithRequire(mockRequire) {
  const filePath = path.join(
    process.cwd(),
    'src/features/profile/image-picker.ts',
  );
  const source = fs.readFileSync(filePath, 'utf8');
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
    require: mockRequire,
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('loadImagePickerModule returns module when native module is available', () => {
  const pickerModule = {
    requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  };
  const { loadImagePickerModule } = loadImagePickerModuleWithRequire((request) => {
    if (request === 'expo-image-picker') {
      return pickerModule;
    }
    return require(request);
  });

  assert.equal(loadImagePickerModule(), pickerModule);
});

test('loadImagePickerModule swallows missing native module errors', () => {
  const { loadImagePickerModule } = loadImagePickerModuleWithRequire((request) => {
    if (request === 'expo-image-picker') {
      throw new Error("Cannot find native module 'ExponentImagePicker'");
    }
    return require(request);
  });

  assert.equal(loadImagePickerModule(), null);
});
