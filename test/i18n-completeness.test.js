const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Global i18n completeness guard.
//
// The app sets fallbackLng: 'zh', so any key referenced via t(key, { defaultValue })
// that is absent from en.json silently renders Chinese for English users — a bug
// with no error. This test walks src/ and asserts every such key exists in BOTH
// locales, permanently preventing that whole class of regression.
const SRC_DIR = path.join(process.cwd(), 'src');

const flatten = (obj, prefix = '') => {
  const out = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const p = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value, p));
    } else {
      out[p] = value;
    }
  }
  return out;
};

const walk = (dir) => {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
};

// Collect every t('key', { ...defaultValue... }) reference. defaultValue may sit
// several lines below the key inside the options object, so we scan a window
// after each t('key' occurrence rather than requiring a single line.
const collectKeys = () => {
  const keys = new Map(); // key -> first file it appears in
  for (const file of walk(SRC_DIR)) {
    const src = fs.readFileSync(file, 'utf8');
    // Negative lookbehind: only match a real `t(` / `i18n.t(` call, not the `t(`
    // that lives at the end of another identifier — e.g. `trackSectionLayout('text')`
    // or `format('x')` would otherwise be misread as `t('text')`/`t('x')`.
    const re = /(?<![A-Za-z0-9_])t\(\s*'([a-zA-Z0-9_.]+)'/g;
    let m;
    while ((m = re.exec(src))) {
      const key = m[1];
      const window = src.slice(m.index, m.index + 400);
      if (/defaultValue\s*:/.test(window) && !keys.has(key)) {
        keys.set(key, path.relative(process.cwd(), file));
      }
    }
  }
  return keys;
};

const referenced = collectKeys();

// i18next plural keys carry a category suffix (en has _one/_other, zh only _other).
// A source `t('k', { count })` references the bare key `k`; the locale stores `k_one`
// / `k_other`. So treat a key as present if the bare key OR any plural form exists,
// and compare locale parity on the suffix-stripped base key.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKey = (k) => k.replace(PLURAL_SUFFIX, '');

const hasKey = (flat, key) => {
  if (flat[key] !== undefined && flat[key] !== '') return true;
  return ['zero', 'one', 'two', 'few', 'many', 'other'].some(
    (s) => flat[`${key}_${s}`] !== undefined && flat[`${key}_${s}`] !== '',
  );
};

for (const lng of ['en', 'zh']) {
  test(`${lng}.json defines every t(...defaultValue) key referenced in src/`, () => {
    const flat = flatten(
      JSON.parse(
        fs.readFileSync(path.join(process.cwd(), `src/i18n/locales/${lng}.json`), 'utf8'),
      ),
    );
    const missing = [];
    for (const [key, file] of referenced) {
      if (!hasKey(flat, key)) missing.push(`${key} (${file})`);
    }
    assert.deepEqual(
      missing,
      [],
      `${lng}.json missing ${missing.length} key(s) that would fall back to defaultValue:\n  ${missing.join('\n  ')}`,
    );
  });
}

test('en.json and zh.json have identical key sets (ignoring plural categories)', () => {
  const en = flatten(
    JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/i18n/locales/en.json'), 'utf8')),
  );
  const zh = flatten(
    JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/i18n/locales/zh.json'), 'utf8')),
  );
  const enBase = new Set(Object.keys(en).map(baseKey));
  const zhBase = new Set(Object.keys(zh).map(baseKey));
  const onlyEn = [...enBase].filter((k) => !zhBase.has(k));
  const onlyZh = [...zhBase].filter((k) => !enBase.has(k));
  assert.deepEqual(
    { onlyEn, onlyZh },
    { onlyEn: [], onlyZh: [] },
    `locale base-key sets diverged — en-only: ${onlyEn.join(', ')}; zh-only: ${onlyZh.join(', ')}`,
  );
});
