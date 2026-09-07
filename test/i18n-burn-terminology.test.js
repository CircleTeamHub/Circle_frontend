const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'));

// 这些 key 描述的是同一个功能。key 名沿用内部概念（selfDestruct / burn），但
// 面向用户的文案必须只有一种说法：以每种语言的 chat.burnAfterReading 为准。
// 之前五种语言各自并存两到四套叫法（自毁 / 自动删除、self-destruct / auto-delete、
// autodestrucción / autoeliminar / efímeros），隐私设置页里上下两行都能说不一样。
const BURN_KEYS = [
  'chat.burnMessage',
  'chat.selectBurnTime',
  'chat.burnAfterReading',
  'settingsDetails.privacy.selfDestruct',
  'settingsDetails.privacy.selfDestructTip',
  'settingsDetails.privacy.selfDestructTipHint',
  'im.notification.burnEnabled',
  'im.notification.burnDisabled',
  'serverErrors.PRIVACY_SELF_DESTRUCT_INVALID',
  'serverErrors.CHAT_FORWARD_FORBIDDEN',
];

// 每种语言的规范说法，以及被它取代、不允许再出现的旧说法。
const TERMS = {
  zh: { canonical: '阅后即焚', retired: ['自毁', '自动删除', '自动消除'] },
  en: {
    canonical: 'isappearing',
    retired: ['self-destruct', 'auto-delete', 'autodelete'],
  },
  ja: { canonical: '消えるメッセージ', retired: ['自動削除', '自動消去'] },
  ko: { canonical: '사라지는 메시지', retired: ['자동 삭제'] },
  es: {
    canonical: 'temporales',
    retired: ['autodestrucción', 'autoeliminar', 'autoeliminación', 'efímero'],
  },
};

function readKey(locale, key) {
  return key
    .split('.')
    .reduce((node, part) => (node == null ? node : node[part]), locale);
}

for (const [name, { canonical, retired }] of Object.entries(TERMS)) {
  test(`${name} states the disappearing-message feature one way only`, () => {
    const locale = read(`src/i18n/locales/${name}.json`);

    for (const key of BURN_KEYS) {
      const value = readKey(locale, key);
      assert.equal(typeof value, 'string', `${name}: ${key} should exist`);

      const lowered = value.toLocaleLowerCase();
      assert.ok(
        lowered.includes(canonical.toLocaleLowerCase()),
        `${name}: ${key} should use "${canonical}" — got ${JSON.stringify(value)}`,
      );

      for (const stale of retired) {
        assert.ok(
          !lowered.includes(stale.toLocaleLowerCase()),
          `${name}: ${key} still uses the retired wording "${stale}" — ${JSON.stringify(value)}`,
        );
      }
    }
  });
}
