const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Guard against the "key returned an object instead of string" runtime bug.
//
// When a string label key (e.g. `profile.wallet` = "我的钱包", used as a menu
// label via t('profile.wallet')) later gains child keys (profile.wallet.title,
// profile.wallet.balance…), it silently turns into an OBJECT. i18next's
// t('profile.wallet') then renders the error string "key 'profile.wallet (ja)'
// returned an object instead of string" — a visible, all-locale UI break that
// slips past key-parity checks (the key set stays identical).
//
// This walks every OBJECT-valued path in en.json and asserts no source file
// references it as a plain string label (bare t('path') or labelKey/titleKey/
// rightTextKey: 'path'). Data-field accessors like `valueKey: 'city'`
// (consumed as user[valueKey], not t()) are intentionally NOT checked.
const ROOT = process.cwd();

const objectPaths = () => {
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/locales/en.json'), 'utf8'));
  const out = new Set();
  const walk = (o, p = '') => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      const pp = p ? `${p}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out.add(pp);
        walk(v, pp);
      }
    }
  };
  walk(en);
  return out;
};

const sourceFiles = () => {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx|ts)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  return files.filter((f) => !f.includes(`${path.sep}i18n${path.sep}locales${path.sep}`));
};

test('no i18n object namespace is referenced as a plain string label', () => {
  const objs = objectPaths();
  // `t('a.b.c')` / `i18n.t('a.b.c')` — the leading char excludes identifiers like trackLayout(
  const bareT = /(?<![A-Za-z0-9_])t\(\s*['"]([a-zA-Z0-9_.]+)['"]\s*[),]/g;
  // label-style props that always hold an i18n string key (NOT valueKey — that is a data field)
  const labelProp = /\b(labelKey|titleKey|rightTextKey|labelKeys|nameKey|descriptionKey|perksKey|ruleKey)\s*:\s*['"]([a-zA-Z0-9_.]+)['"]/g;

  const offenders = [];
  for (const file of sourceFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    let m;
    while ((m = bareT.exec(src))) {
      if (objs.has(m[1])) offenders.push(`${rel}: t('${m[1]}') resolves to an OBJECT`);
    }
    while ((m = labelProp.exec(src))) {
      if (objs.has(m[2])) offenders.push(`${rel}: ${m[1]}='${m[2]}' resolves to an OBJECT`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `These keys are objects but used as string labels (i18next will render "returned an object"):\n  ${offenders.join('\n  ')}`,
  );
});
