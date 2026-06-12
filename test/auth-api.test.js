const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadAuthApi(apiClientMock) {
  const filePath = path.join(process.cwd(), "src/services/api/auth.ts");
  const source = fs.readFileSync(filePath, "utf8");
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
    require: (request) => {
      if (request === "expo-device") {
        return {
          deviceName: "iPhone 15 Pro",
          osName: "iOS",
        };
      }

      if (request === "@/services/api/client") {
        return { apiClient: apiClientMock };
      }

      if (request === "@/services/api/utils") {
        return {
          normalizeUser: (value) => value,
        };
      }

      // react-native 只是为了拿 Platform.OS；测试里给个固定 iOS 即可。
      if (request === "react-native") {
        return { Platform: { OS: "ios" } };
      }

      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test("changePassword posts old and new password to the auth endpoint", async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return {};
  };
  const { changePassword } = loadAuthApi(apiClientMock);

  await changePassword({
    oldPassword: "old-password",
    newPassword: "new-password",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: "/auth/change-password",
      options: {
        method: "POST",
        body: {
          oldPassword: "old-password",
          newPassword: "new-password",
        },
      },
    },
  ]);
});

test("fetchLoginSecurityCodeStatus gets the account-level security code status", async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return { enabled: true };
  };
  const { fetchLoginSecurityCodeStatus } = loadAuthApi(apiClientMock);

  const status = await fetchLoginSecurityCodeStatus();

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: "/auth/security-code",
      options: {
        method: "GET",
      },
    },
  ]);
  assert.deepEqual(status, { enabled: true });
});

test("setLoginSecurityCode puts the new account-level security code", async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return {};
  };
  const { setLoginSecurityCode } = loadAuthApi(apiClientMock);

  await setLoginSecurityCode({
    oldSecurityCode: "123456",
    securityCode: "654321",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: "/auth/security-code",
      options: {
        method: "PUT",
        body: {
          oldSecurityCode: "123456",
          securityCode: "654321",
        },
      },
    },
  ]);
});

test("disableLoginSecurityCode deletes the account-level security code", async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return {};
  };
  const { disableLoginSecurityCode } = loadAuthApi(apiClientMock);

  await disableLoginSecurityCode("123456");

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: "/auth/security-code",
      options: {
        method: "DELETE",
        body: {
          securityCode: "123456",
        },
      },
    },
  ]);
});

test("verifyLoginSecurityCode posts the unlock code to the verify endpoint", async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return { ok: true };
  };
  const { verifyLoginSecurityCode } = loadAuthApi(apiClientMock);

  const result = await verifyLoginSecurityCode("123456");

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: "/auth/security-code/verify",
      options: {
        method: "POST",
        body: {
          securityCode: "123456",
        },
      },
    },
  ]);
  assert.deepEqual(result, { ok: true });
});

test("logoutAll posts to the auth logout-all endpoint", async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return {};
  };
  const { logoutAll } = loadAuthApi(apiClientMock);

  await logoutAll();

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: "/auth/logout-all",
      options: {
        method: "POST",
      },
    },
  ]);
});

test("device management auth APIs call the real session endpoints", async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    if (endpoint === "/auth/sessions") {
      return [
        {
          id: "session-1",
          isCurrent: true,
          deviceName: "iPhone 15 Pro",
          ip: "127.0.0.1",
          userAgent: "CircleIM/1.0",
          createdAt: "2026-06-11T00:00:00.000Z",
          lastUsedAt: "2026-06-11T00:10:00.000Z",
          expiredAt: "2026-06-18T00:00:00.000Z",
        },
      ];
    }
    return {};
  };
  const { fetchAuthSessions, revokeAuthSession, logoutOtherSessions } =
    loadAuthApi(apiClientMock);

  const sessions = await fetchAuthSessions();
  await revokeAuthSession("session-2");
  await logoutOtherSessions();

  assert.equal(sessions[0].isCurrent, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: "/auth/sessions",
      options: {
        method: "GET",
      },
    },
    {
      endpoint: "/auth/sessions/session-2",
      options: {
        method: "DELETE",
      },
    },
    {
      endpoint: "/auth/logout-others",
      options: {
        method: "POST",
      },
    },
  ]);
});

test("single-device login APIs read and update the account-level setting", async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return { enabled: true };
  };
  const { fetchSingleDeviceLoginStatus, setSingleDeviceLogin } =
    loadAuthApi(apiClientMock);

  const status = await fetchSingleDeviceLoginStatus();
  await setSingleDeviceLogin(false);

  assert.deepEqual(status, { enabled: true });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: "/auth/single-device-login",
      options: {
        method: "GET",
      },
    },
    {
      endpoint: "/auth/single-device-login",
      options: {
        method: "PUT",
        body: { enabled: false },
      },
    },
  ]);
});

test("login posts normalized email and password", async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return {
      accessToken: "a-token",
      refreshToken: "r-token",
      imToken: "i-token",
    };
  };
  const { login } = loadAuthApi(apiClientMock);

  await login({ email: "  USER@Example.com ", password: "pw" });

  assert.equal(calls[0].endpoint, "/auth/login");
  assert.equal(calls[0].options.body.email, "user@example.com");
  assert.equal(calls[0].options.body.password, "pw");
});

test("login normalizes missing/empty imToken to null", async () => {
  const apiClientMock = async () => ({
    accessToken: "a-token",
    refreshToken: "r-token",
    // backend can legitimately omit imToken for some account types
  });
  const { login } = loadAuthApi(apiClientMock);

  const tokens = await login({ email: "a@b.com", password: "p" });
  assert.equal(tokens.imToken, null, "missing imToken should become null");

  const apiClientMock2 = async () => ({
    accessToken: "a-token",
    refreshToken: "r-token",
    imToken: "",
  });
  const { login: login2 } = loadAuthApi(apiClientMock2);
  const tokens2 = await login2({ email: "a@b.com", password: "p" });
  assert.equal(tokens2.imToken, null, "empty imToken should become null");
});

test("login throws when accessToken or refreshToken missing (response shape drift guard)", async () => {
  // missing accessToken
  const { login: loginA } = loadAuthApi(async () => ({
    refreshToken: "r-token",
    imToken: "i-token",
  }));
  await assert.rejects(
    () => loginA({ email: "a@b.com", password: "p" }),
    /认证返回数据格式异常/,
  );

  // backend sends snake_case (silent breakage in the old impl)
  const { login: loginB } = loadAuthApi(async () => ({
    access_token: "a",
    refresh_token: "r",
    im_token: "i",
  }));
  await assert.rejects(
    () => loginB({ email: "a@b.com", password: "p" }),
    /认证返回数据格式异常/,
  );

  // accessToken present but empty string
  const { login: loginC } = loadAuthApi(async () => ({
    accessToken: "",
    refreshToken: "r-token",
  }));
  await assert.rejects(
    () => loginC({ email: "a@b.com", password: "p" }),
    /认证返回数据格式异常/,
  );
});

test("register posts email/code/password/nickname", async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push(options.body);
    return { accessToken: "a", refreshToken: "r", imToken: null };
  };
  const { register } = loadAuthApi(apiClientMock);

  const tokens = await register({
    email: "  NEW@Example.com ",
    code: "123456",
    password: "pw",
    nickname: "  Hi  ",
  });

  assert.equal(calls[0].email, "new@example.com");
  assert.equal(calls[0].code, "123456");
  assert.equal(calls[0].nickname, "Hi");
  assert.equal(tokens.imToken, null);
});

test("requestEmailCode posts email and purpose", async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return undefined;
  };
  const { requestEmailCode } = loadAuthApi(apiClientMock);

  await requestEmailCode({ email: "  A@B.com ", purpose: "login" });

  assert.equal(calls[0].endpoint, "/auth/email/request-code");
  assert.equal(calls[0].options.body.email, "a@b.com");
  assert.equal(calls[0].options.body.purpose, "login");
  assert.equal(calls[0].options.auth, false);
});

test("loginWithCode posts normalized email and code", async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return { accessToken: "a", refreshToken: "r", imToken: "i" };
  };
  const { loginWithCode } = loadAuthApi(apiClientMock);

  await loginWithCode({ email: "  A@B.com ", code: " 123456 " });

  assert.equal(calls[0].endpoint, "/auth/login/code");
  assert.equal(calls[0].options.body.email, "a@b.com");
  assert.equal(calls[0].options.body.code, "123456");
});
