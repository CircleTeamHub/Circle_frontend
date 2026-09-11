const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Duplicate-key guard for the locale files.
//
// JSON.parse keeps the LAST occurrence of a duplicated key and never complains,
// so a locale edit that adds new copy above a forgotten old entry silently ships
// the old copy — exactly what happened to discover.notifications.global in the
// circle-notification-tiers PR (five locales, no test caught it because every
// other i18n test parses the JSON first). The parity/completeness tests cannot
// see this class of bug; only a text-level scan can. This one walks the raw
// text and fails on any key repeated within the same object.
const LOCALES_DIR = path.join(process.cwd(), 'src/i18n/locales');
const LOCALES = ['zh', 'en', 'ja', 'ko', 'es'];

/**
 * Tokenizes JSON text just enough to attribute every key to its enclosing
 * object. Strings are consumed with escape handling so a `{`, `:` or `"` inside
 * copy never confuses the structure walk. Returns the dotted paths of keys that
 * appear more than once in the same object, in file order.
 */
function findDuplicateKeys(text) {
  const duplicates = [];
  // Each frame is one container: `keys` is only used for objects, `path` names it.
  const frames = [{ kind: 'root', path: '', keys: new Set() }];
  let pendingKey = null;
  let i = 0;

  const readString = () => {
    let out = '';
    i += 1; // opening quote
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') {
        i += 1;
        return out;
      }
      out += ch;
      i += 1;
    }
    throw new Error('unterminated string in locale file');
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const value = readString();
      // A string directly followed by ":" is a key of the current object.
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (text[j] === ':') {
        const frame = frames[frames.length - 1];
        const fullPath = frame.path ? `${frame.path}.${value}` : value;
        if (frame.keys.has(value)) duplicates.push(fullPath);
        frame.keys.add(value);
        pendingKey = fullPath;
        i = j + 1;
      }
      continue;
    }
    if (ch === '{' || ch === '[') {
      const parent = frames[frames.length - 1];
      // Unkeyed containers are the root object or array items; name items
      // after their array so a repeat inside one is still attributable.
      const unkeyedPath = parent.kind === 'root' ? '' : `${parent.path}[]`;
      frames.push({
        kind: ch === '{' ? 'object' : 'array',
        path: pendingKey ?? unkeyedPath,
        keys: new Set(),
      });
      pendingKey = null;
      i += 1;
      continue;
    }
    if (ch === '}' || ch === ']') {
      frames.pop();
      pendingKey = null;
      i += 1;
      continue;
    }
    i += 1;
  }
  return duplicates;
}

test('the duplicate-key scanner itself catches repeats and ignores lookalikes', () => {
  const fixture = `{
    "a": { "x": "1", "y": "{ \\"x\\": 2 }", "x": "3" },
    "b": { "x": "same name, different object" },
    "list": [ { "k": "v" }, { "k": "v" } ],
    "a": "top-level repeat"
  }`;
  assert.deepEqual(findDuplicateKeys(fixture), ['a.x', 'a']);
  assert.deepEqual(findDuplicateKeys('{ "a": { "b": "c" } }'), []);
});

for (const locale of LOCALES) {
  test(`${locale}.json has no duplicate keys within one object`, () => {
    const text = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf8');
    JSON.parse(text); // still valid JSON
    assert.deepEqual(
      findDuplicateKeys(text),
      [],
      `${locale}.json repeats keys — JSON.parse would silently keep the last one`,
    );
  });
}
