const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 密保问题的 key 是三方共用的一份约定:
//   - 后端 SECURITY_QUESTION_KEYS(@IsIn 校验设置请求)
//   - 前端 SECURITY_QUESTION_KEYS(设置页的候选、验证页按 key 显示题目)
//   - securityQuestions.questions.<key> × 5 种语言
// 任何一方漏了一个 key:设置页选不到 / 服务端拒收 / 验证页显示原始 key。
const root = process.cwd();

function keysFrom(file) {
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/SECURITY_QUESTION_KEYS = \[([\s\S]*?)\] as const/);
  assert.ok(match, `${file} declares SECURITY_QUESTION_KEYS`);
  return [...match[1].matchAll(/'([A-Za-z]+)'/g)].map(([, key]) => key);
}

const FRONTEND_KEYS = keysFrom(path.join(root, 'src/features/auth/security-questions.ts'));

test('every locale names every security question', () => {
  assert.ok(FRONTEND_KEYS.length >= 2);
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const messages = JSON.parse(
      fs.readFileSync(path.join(root, `src/i18n/locales/${locale}.json`), 'utf8'),
    );
    const questions = messages.securityQuestions?.questions ?? {};
    assert.deepEqual(Object.keys(questions).sort(), [...FRONTEND_KEYS].sort(), locale);
    for (const key of FRONTEND_KEYS) {
      assert.notEqual(questions[key].trim(), '', `${locale}.json has an empty question ${key}`);
    }
  }
});

// —— 跨仓:后端并排检出时逐值比对,只跑前端 CI 时跳过。 ——
const backendFile = path.join(
  process.env.CIRCLE_BE_PATH ?? path.join(root, '..', 'circle_be'),
  'src/auth/security-questions.service.ts',
);

test('backend accepts exactly the same questions', { skip: !fs.existsSync(backendFile) }, () => {
  assert.deepEqual(keysFrom(backendFile), FRONTEND_KEYS);
});
