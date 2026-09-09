const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 阅后即焚的时长阶梯是三方共用的一份约定:
//   - 会话级焚毁(聊天信息页)           → BE POST /chat/conversations/:id/burn
//   - 全局阅后即焚(隐私设置页)         → BE PATCH /privacy/settings
//   - 两处的档位标签                    → im.burn.* × 5 种语言
// 在这之前它们各有一张表:「10 分钟」只有单会话有,「30 天」只有全局有,同一个
// 功能在两个入口看起来像两回事。这个文件钉住「只有一张表」。
const root = process.cwd();

function loadBurnDurations() {
  const filePath = path.join(root, 'src/chat-core/burn-durations.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const ctx = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      // 标签解析交给下面的 locale 用例,这里只要 key。
      if (request === '@/i18n') {
        return { __esModule: true, default: { t: (key) => key } };
      }
      throw new Error(`unexpected require: ${request}`);
    },
  };
  ctx.exports = ctx.module.exports;
  vm.runInNewContext(transpiled, ctx);
  return ctx.module.exports;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// PM 定的阶梯,逐档写死 —— 从被测模块反推就等于什么都没测。
const EXPECTED = [
  0,
  MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  6 * HOUR,
  DAY,
  2 * DAY,
  3 * DAY,
  4 * DAY,
  5 * DAY,
  6 * DAY,
  WEEK,
  2 * WEEK,
  3 * WEEK,
  30 * DAY,
];

test('the ladder is 1/5/10/30 min, 1/2/6 h, 1-6 d, 1-3 w, 1 month (plus off)', () => {
  const { BURN_DURATION_CHOICES, BURN_DURATION_OFF } = loadBurnDurations();

  assert.equal(BURN_DURATION_OFF, 0);
  assert.deepEqual([...BURN_DURATION_CHOICES], EXPECTED);
  // 升序且无重复:选择面板直接按数组顺序渲染,乱序=用户看到「6 小时」排在
  // 「10 分钟」前面。
  const sorted = [...BURN_DURATION_CHOICES].sort((a, b) => a - b);
  assert.deepEqual([...BURN_DURATION_CHOICES], sorted);
  assert.equal(new Set(BURN_DURATION_CHOICES).size, BURN_DURATION_CHOICES.length);
});

test('isBurnDurationChoice gates exactly the ladder', () => {
  const { BURN_DURATION_CHOICES, isBurnDurationChoice } = loadBurnDurations();

  for (const seconds of BURN_DURATION_CHOICES) {
    assert.equal(isBurnDurationChoice(seconds), true, `${seconds} should pass`);
  }
  // 30 秒是旧会话级档位表里唯一没进新表的值(迁移已把存量改成 60);
  // 45 / 999 是任意值。全都必须被挡在写入路径外。
  for (const rejected of [30, 45, 999, -60, 1.5, null, undefined, '60']) {
    assert.equal(
      isBurnDurationChoice(rejected),
      false,
      `${String(rejected)} should be rejected`,
    );
  }
});

test('every ladder step has a label in all five locales', () => {
  const { BURN_DURATION_CHOICES, BURN_DURATION_OFF, formatBurnDuration } =
    loadBurnDurations();

  // formatBurnDuration 用的是变量 key,i18n-completeness 那条全仓扫描看不见它 ——
  // 缺一个 key 的后果是 UI 上露出裸秒数("604800s"),没有任何报错。
  for (const seconds of BURN_DURATION_CHOICES) {
    if (seconds === BURN_DURATION_OFF) continue;
    const key = formatBurnDuration(seconds);
    assert.match(key, /^im\.burn\./, `${seconds} has no label key`);

    for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
      const messages = JSON.parse(
        fs.readFileSync(path.join(root, `src/i18n/locales/${locale}.json`), 'utf8'),
      );
      const label = key
        .split('.')
        .reduce((node, part) => (node == null ? node : node[part]), messages);
      assert.equal(
        typeof label,
        'string',
        `${locale}.json is missing ${key}`,
      );
      assert.notEqual(label.trim(), '', `${locale}.json has an empty ${key}`);
    }
  }
});

// —— 跨仓:后端并排检出时逐值比对,只跑前端 CI 时跳过。 ——
const bePath =
  process.env.CIRCLE_BE_PATH ?? path.join(root, '..', 'circle_be');
const beChoices = path.join(bePath, 'src/common/burn-durations.ts');

test('backend mirrors the same ladder', { skip: !fs.existsSync(beChoices) }, () => {
  const source = fs.readFileSync(beChoices, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: beChoices,
  }).outputText;
  const ctx = { module: { exports: {} }, exports: {} };
  ctx.exports = ctx.module.exports;
  vm.runInNewContext(transpiled, ctx);

  assert.deepEqual([...ctx.module.exports.BURN_DURATION_CHOICES], EXPECTED);
});

test(
  'backend validates both burn entry points against that one table',
  { skip: !fs.existsSync(beChoices) },
  () => {
    const read = (rel) => fs.readFileSync(path.join(bePath, rel), 'utf8');

    // 会话级:POST /chat/conversations/:id/burn
    const burnDto = read('src/chat/dto/set-burn-duration.dto.ts');
    assert.match(burnDto, /from '\.\.\/\.\.\/common\/burn-durations'/);
    assert.match(burnDto, /@IsIn\(BURN_DURATION_CHOICES/);

    // 全局:PATCH /privacy/settings —— 字段是秒,不再是天。
    const privacyDto = read('src/privacy/privacy-settings.dto.ts');
    assert.match(privacyDto, /messageSelfDestructSec\?:\s*BurnDurationSec;/);
    assert.match(privacyDto, /@IsIn\(BURN_DURATION_CHOICES/);
    assert.doesNotMatch(privacyDto, /SELF_DESTRUCT_DAY_OPTIONS/);

    // service 层的二次校验也走同一张表(DTO 被绕过时仍然是这条闸)。
    const privacyService = read('src/privacy/privacy-settings.service.ts');
    assert.match(privacyService, /isBurnDurationChoice\(input\.messageSelfDestructSec\)/);
  },
);

test('the option sheet reveals the current selection in a long list', () => {
  // 18 档撑破了 maxHeight: 360 的可视区(~7 行)。选中项落在折叠线以下时,打开
  // 面板只看得到最上面的「关闭」,像是一项都没选 —— 而这个面板还被圈子表单、
  // 隐私设置共用,长列表不止焚毁这一处。
  const sheet = fs.readFileSync(
    path.join(root, 'src/components/ui/option-picker-sheet.tsx'),
    'utf8',
  );

  assert.match(sheet, /scrollRef/);
  assert.match(sheet, /scrollTo\(\{ y, animated: false \}\)/);
  // 逐行 onLayout 量真实位置,而不是 index * 固定行高:标签会折行(optionRow 只
  // 定了 minHeight,Text 允许 numberOfLines={2}),按常数算会滚错位置。
  assert.match(sheet, /onLayout=\{revealIfSelected\(isSelected\)\}/);
  // 每次重新打开都要再滚一次,否则第二次打开停在上次的滚动位置。
  assert.match(sheet, /if \(!visible\) hasRevealedSelection\.current = false;/);
});
