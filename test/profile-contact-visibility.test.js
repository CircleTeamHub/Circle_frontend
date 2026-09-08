const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const LOCALES = ['zh', 'en', 'ja', 'ko', 'es'];

// 资料可见性开关 → 资料页上对应的那一行。开关名与字段名不是机械的大小写关系
// （showQQ ↔ qq），所以这张表手工写死，作为「两边确实是同一件事」的声明。
const VISIBILITY_TOGGLES = {
  showPhone: 'phone',
  showEmail: 'email',
  showWechat: 'wechat',
  showQQ: 'qq',
};

// whatsup 的 profile 字段在 App 里是休眠的：profile-edit-config 不收录、没有任何
// 界面能填。后端 canViewProfileField 认它只是为了契约完整，前端刻意不放开关，
// 所以它是这条不变式唯一的豁免项。它一旦接进资料页，就该从这里删掉。
const DORMANT_TOGGLES = new Set(['showWhatsup']);

function declaredVisibilityToggles() {
  const source = read('src/services/api/privacy.ts');
  const body = source.slice(
    source.indexOf('export type PrivacySettings = {'),
    source.indexOf('export type UpdatePrivacySettingsPayload'),
  );
  return [...body.matchAll(/^\s{2}(show\w+):\s*boolean;/gm)].map((m) => m[1]);
}

test('every profile-visibility toggle is both switchable and actually rendered', () => {
  const screen = read('src/features/profile/screens/PrivacySettingsScreen.tsx');
  const contactFields = read('src/features/user/profile-contact.ts');

  const patched = new Set(
    [...screen.matchAll(/patchSettings\(\{\s*(show\w+):\s*value,?\s*\}\)/g)].map(
      (m) => m[1],
    ),
  );
  const bound = new Set(
    [...screen.matchAll(/value:\s*currentSettings\.(show\w+)/g)].map((m) => m[1]),
  );
  const rendered = new Set(
    [...contactFields.matchAll(/^\s+id:\s*'(\w+)',$/gm)].map((m) => m[1]),
  );

  const live = declaredVisibilityToggles().filter(
    (key) => !DORMANT_TOGGLES.has(key),
  );

  // 契约里声明的开关必须全部在这张表里有归属，否则新加一个就会静静漏过下面的检查。
  assert.deepEqual(live.sort(), Object.keys(VISIBILITY_TOGGLES).sort());

  for (const [toggle, field] of Object.entries(VISIBILITY_TOGGLES)) {
    // 有开关能拨（读当前值 + 写回服务端）……
    assert.ok(bound.has(toggle), `${toggle} has no switch bound to its value`);
    assert.ok(patched.has(toggle), `${toggle} never PATCHes the server`);
    // ……并且拨开之后资料页真的会多出一行。少了这半边，开关就是「能拨、不通电」，
    // 用户打开它、对方那边什么都不会变，而且没有任何报错提示这一点。
    assert.ok(
      rendered.has(field),
      `${toggle} is switchable but the profile page renders no "${field}" row`,
    );
  }

  // 反向：资料页不该渲染一个用户无法关闭的联系方式。
  assert.deepEqual(
    [...rendered].sort(),
    Object.values(VISIBILITY_TOGGLES).sort(),
  );
});

test('每个可见性开关和联系方式行在五种语言里都有文案', () => {
  const locales = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      JSON.parse(read(`src/i18n/locales/${locale}.json`)),
    ]),
  );

  for (const [locale, dict] of Object.entries(locales)) {
    for (const [toggle, field] of Object.entries(VISIBILITY_TOGGLES)) {
      assert.equal(
        typeof dict.settingsDetails.privacy[toggle],
        'string',
        `${locale} is missing settingsDetails.privacy.${toggle}`,
      );
      assert.equal(
        typeof dict.profileFields[field],
        'string',
        `${locale} is missing profileFields.${field}`,
      );
    }

    for (const key of ['contactCopied', 'contactCopyFailed', 'contactCopyHint']) {
      assert.equal(
        typeof dict.userProfile[key],
        'string',
        `${locale} is missing userProfile.${key}`,
      );
    }

    // 复制提示要说清复制的是哪一项，插值占位丢了就会变成「已复制」这种无主语文案。
    assert.match(dict.userProfile.contactCopied, /\{\{field\}\}/);
    assert.match(dict.userProfile.contactCopyHint, /\{\{field\}\}/);
    assert.match(dict.userProfile.contactCopyHint, /\{\{value\}\}/);
  }
});

test('the privacy screen default mirrors the backend default for every toggle', () => {
  const screen = read('src/features/profile/screens/PrivacySettingsScreen.tsx');
  const defaults = screen.slice(
    screen.indexOf('const DEFAULT_PRIVACY_SETTINGS'),
    screen.indexOf('export default function PrivacySettingsScreen'),
  );

  // 加载失败/加载中时界面画的是这份默认值。它比后端松，用户会看到一个「开着」的
  // 开关而对方其实是关的；比后端紧则相反。两处都得跟着 circle_be 的
  // DEFAULT_PRIVACY_SETTINGS 走 —— 邮箱与手机号同档（false），微信/QQ 默认 true。
  assert.match(defaults, /showPhone:\s*false/);
  assert.match(defaults, /showEmail:\s*false/);
  assert.match(defaults, /showWechat:\s*true/);
  assert.match(defaults, /showQQ:\s*true/);
});
