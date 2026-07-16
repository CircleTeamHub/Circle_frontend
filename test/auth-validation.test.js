const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// 加载 src/features/auth/validation.ts。它依赖 @/utils/email，
// 这里直接把 email.ts 内联进同一个 vm context（两者都是纯函数、无第三方依赖）。
function loadValidation() {
  const emailSrc = fs.readFileSync(
    path.join(process.cwd(), "src/utils/email.ts"),
    "utf8",
  );
  const validationSrc = fs.readFileSync(
    path.join(process.cwd(), "src/features/auth/validation.ts"),
    "utf8",
  );

  const transpile = (src, fileName) =>
    ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName,
    }).outputText;

  const emailModule = { exports: {} };
  vm.runInNewContext(
    transpile(emailSrc, "email.ts"),
    { module: emailModule, exports: emailModule.exports },
    { filename: "email.ts" },
  );

  const context = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === "@/utils/email") return emailModule.exports;
      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile(validationSrc, "validation.ts"), context, {
    filename: "validation.ts",
  });
  return context.module.exports;
}

const V = loadValidation();

test("validateEmail returns i18n keys per branch", () => {
  assert.equal(V.validateEmail("  "), "auth.errors.emailRequired");
  assert.equal(V.validateEmail("not-an-email"), "auth.errors.invalidEmail");
  assert.equal(V.validateEmail("a@b.com"), null);
});

test("validatePassword enforces backend bounds (6..64)", () => {
  assert.equal(V.validatePassword(""), "auth.errors.passwordRequired");
  assert.equal(V.validatePassword("12345"), "auth.errors.passwordTooShort");
  assert.equal(V.validatePassword("123456"), null);
  assert.equal(V.validatePassword("a".repeat(64)), null);
  assert.equal(V.validatePassword("a".repeat(65)), "auth.errors.passwordTooLong");
});

test("validateCode requires exactly 6 digits", () => {
  assert.equal(V.validateCode("12345"), "auth.errors.invalidCode");
  assert.equal(V.validateCode("1234567"), "auth.errors.invalidCode");
  assert.equal(V.validateCode("12a456"), "auth.errors.invalidCode");
  assert.equal(V.validateCode(" 123456 "), null); // trim 后合法
  assert.equal(V.validateCode("123456"), null);
});

test("validateNickname enforces non-empty and <=50", () => {
  assert.equal(V.validateNickname("   "), "auth.errors.nicknameRequired");
  assert.equal(V.validateNickname("x".repeat(51)), "auth.errors.nicknameTooLong");
  assert.equal(V.validateNickname("Circle"), null);
});

test("validateInviteCode is optional and follows the account-id format", () => {
  assert.equal(V.validateInviteCode(""), null);
  assert.equal(V.validateInviteCode("   "), null);
  assert.equal(V.validateInviteCode("abc123"), null);
  assert.equal(V.validateInviteCode(" AbC-123 "), null);
  assert.equal(V.validateInviteCode("abc"), "auth.errors.invalidInviteCode");
  assert.equal(V.validateInviteCode("bad code!"), "auth.errors.invalidInviteCode");
});

test("composite validators short-circuit in display order", () => {
  // 邮箱先错，即使密码也错，也只报邮箱。
  assert.equal(
    V.validateLoginForm("bad", "123"),
    "auth.errors.invalidEmail",
  );
  // 邮箱过、密码太短。
  assert.equal(
    V.validateLoginForm("a@b.com", "123"),
    "auth.errors.passwordTooShort",
  );
  assert.equal(V.validateLoginForm("a@b.com", "123456"), null);

  assert.equal(
    V.validateLoginCodeForm("a@b.com", "12"),
    "auth.errors.invalidCode",
  );
  assert.equal(V.validateLoginCodeForm("a@b.com", "123456"), null);

  // register：邮箱→验证码→密码→昵称 顺序。
  assert.equal(
    V.validateRegisterForm("a@b.com", "123456", "12345", "nick"),
    "auth.errors.passwordTooShort",
  );
  assert.equal(
    V.validateRegisterForm("a@b.com", "123456", "123456", ""),
    "auth.errors.nicknameRequired",
  );
  assert.equal(
    V.validateRegisterForm("a@b.com", "123456", "123456", "nick", "bad code!"),
    "auth.errors.invalidInviteCode",
  );
  assert.equal(
    V.validateRegisterForm("a@b.com", "123456", "123456", "nick", "abc123"),
    null,
  );
});
