const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Multi-locale parity guard.
//
// The app ships zh/en/ja/ko/es. en.json is the structural source of truth. Every
// other locale must define the SAME set of keys, else that locale silently falls
// back (ja/ko/es → en → zh) and users see the wrong language with no error.
//
// Plural note: i18next plural categories differ by language. en/es carry _one +
// _other; zh/ja/ko have no grammatical plural and carry only _other. So parity is
// compared on the suffix-stripped BASE key, which is language-independent.
const LOCALES_DIR = path.join(process.cwd(), 'src/i18n/locales');
const OTHER_LOCALES = ['zh', 'ja', 'ko', 'es'];

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
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKey = (k) => k.replace(PLURAL_SUFFIX, '');
const loadBase = (lng) => {
  const flat = flatten(
    JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${lng}.json`), 'utf8')),
  );
  return new Set(Object.keys(flat).map(baseKey));
};

const enBase = loadBase('en');

for (const lng of OTHER_LOCALES) {
  test(`${lng}.json has full base-key parity with en.json`, () => {
    const lngBase = loadBase(lng);
    const missing = [...enBase].filter((k) => !lngBase.has(k));
    const extra = [...lngBase].filter((k) => !enBase.has(k));
    assert.deepEqual(
      { missing, extra },
      { missing: [], extra: [] },
      `${lng}.json diverged from en.json — missing ${missing.length}: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}; extra ${extra.length}: ${extra.slice(0, 20).join(', ')}`,
    );
  });
}

// Every locale value must be a non-empty string or an array of strings — an empty
// value renders blank UI, which is worse than a visible fallback.
for (const lng of ['en', ...OTHER_LOCALES]) {
  test(`${lng}.json has no empty values`, () => {
    const flat = flatten(
      JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${lng}.json`), 'utf8')),
    );
    const empty = Object.keys(flat).filter(
      (k) => typeof flat[k] === 'string' && flat[k].trim() === '',
    );
    assert.deepEqual(empty, [], `${lng}.json has empty values: ${empty.join(', ')}`);
  });
}
