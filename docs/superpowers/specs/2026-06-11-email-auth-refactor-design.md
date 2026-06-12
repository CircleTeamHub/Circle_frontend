# 登录重构：邮箱 + 密码 / 邮箱 + 验证码

**日期**：2026-06-11
**状态**：设计已确认，待写实现计划
**涉及仓库**：`circle-im`（前端 Expo/RN）、`circle_be`（后端 NestJS + Prisma）

---

## 1. 背景与目标

当前认证以用户**自填的 `accountId`** 作为唯一登录凭证（`accountId` + 密码），`email` 只是可选资料字段，且后端**完全没有**邮箱验证码（OTP）/ 发信能力。

本次重构目标：

1. 登录改为 **邮箱 + 密码** 或 **邮箱 + 验证码** 两种方式。
2. **不再允许用户自定义 `accountId`**——改由后端自动生成。
3. 注册流程改为 **邮箱 + 验证码 + 密码 + 昵称**。

## 2. 已确认决策

| 主题 | 决策 |
| --- | --- |
| `accountId` 去向 | 后端**自动生成**唯一号，保留为公开号（好友搜索 / 名片展示）；登录不再使用它 |
| 登录方式 | 邮箱 + 密码 **或** 邮箱 + 验证码 |
| 发信方案 | **可插拔 Mailer 接口**；开发期把验证码打到日志/控制台，生产替换实现 |
| 注册流程 | 邮箱 + 验证码 + 密码 + 昵称 |
| 验证码存储 | **数据库表**（后端无 Redis） |
| 限流 | 复用 `@nestjs/throttler` + 业务层冷却检查 |
| 老用户迁移 | **开发阶段直接清库/重置**，不做兼容逻辑 |

## 3. 范围

### 包含
- 后端：Prisma schema 迁移、Mailer 抽象、OTP 服务、注册/登录接口改造、`accountId` 生成器、移除自助改号。
- 前端：LoginScreen / RegisterScreen 改造、auth API 层、`use-auth` hook、i18n 文案。
- 前后端测试（TDD）。

### 不包含（Out of Scope）
- 忘记密码 / 找回密码独立流程（验证码登录已部分覆盖此场景，正式找回另立项）。
- 手机号验证码登录。
- 第三方 OAuth（微信 / Apple 等）。
- 真实邮件供应商对接（仅留可插拔接口，生产实现单独配置）。
- 老用户数据兼容（开发阶段重置）。

## 4. 后端设计（circle_be）

### 4.1 数据库迁移（Prisma）

**`User` 模型调整**
- `email`：由 `String?` 改为 `String? @unique`。Postgres 下唯一约束允许多个 `NULL`，兼容管理员 / 未绑定邮箱的系统账号。
- `accountId`：保持 `String @unique`，但写入值改由后端 `generateUniqueAccountId()` 产生，注册接口不再接收用户输入。
- `passwordHash`：保持必填（注册阶段一定会设置密码）。

**新增 `EmailVerificationCode` 模型**
```prisma
enum EmailCodePurpose {
  REGISTER
  LOGIN
}

model EmailVerificationCode {
  id         String           @id @default(cuid())
  email      String
  codeHash   String           // argon2 哈希，绝不存明文
  purpose    EmailCodePurpose
  expiresAt  DateTime
  attempts   Int              @default(0)
  consumedAt DateTime?
  createdAt  DateTime         @default(now())

  @@index([email, purpose])
}
```

### 4.2 `accountId` 生成器

- 新增工具 `generateUniqueAccountId(prisma)`：生成 8–10 位数字串（首位非 0），查重碰撞则重试（上限若干次后抛错）。
- 仅在 `register` 内部调用。

### 4.3 Mailer 抽象

- 定义接口 `Mailer`：`sendVerificationCode(email: string, code: string, purpose: EmailCodePurpose): Promise<void>`。
- 提供 `ConsoleMailer` 实现：用 NestJS `Logger` 输出 `email / code / purpose`（开发期）。
- 通过注入 token（如 `MAILER`）在 `AuthModule` 注册，生产环境替换为真实实现即可，业务代码零改动。

### 4.4 EmailVerificationService

- `requestCode(email, purpose)`：
  - 限流：同 `email + purpose` **60s 冷却**（查最近一条 `createdAt`），冷却内拒绝。
  - `REGISTER`：若邮箱已注册 → 抛冲突错误（`ConflictException`）。
  - `LOGIN`：若邮箱不存在 → **静默返回成功**（不创建记录、不发信），防账号枚举。
  - 生成 6 位数字码 → argon2 哈希入库，`expiresAt = now + 10min`，`attempts = 0`。
  - 调 Mailer 发送。
- `verifyCode(email, purpose, code)`：
  - 取该 `email + purpose` **最新一条** 未消费 (`consumedAt = null`) 且未过期记录；无则失败。
  - `attempts >= 5` → 失败（锁定该码）。
  - argon2 比对：失败则 `attempts += 1` 并失败；成功则 `consumedAt = now()` 标记消费，返回成功。
  - 返回布尔 / 校验失败抛 `UnauthorizedException`（由调用方决定）。

### 4.5 Auth 接口

| 方法 & 路径 | Body | 行为 |
| --- | --- | --- |
| `POST /auth/email/request-code` | `{ email, purpose: 'register' \| 'login' }` | 调 `requestCode`，发码 |
| `POST /auth/register` | `{ email, code, password, nickname }` | `verifyCode(email,'register',code)` → 生成 `accountId` → 建号 → `issueTokens` |
| `POST /auth/login` | `{ email, password }` | 按 email 查用户 → argon2 校验密码 → `issueTokens` |
| `POST /auth/login/code` | `{ email, code }` | `verifyCode(email,'login',code)` → 取用户 → `issueTokens` |

- **移除** `PATCH /auth/account-id`（自助改号）控制器方法、service 方法及前端调用。
- 登录类接口沿用现有 `issueTokens`（OpenIM imToken、refresh session、`x-device-name`、单设备登录等逻辑全部不变）。
- 错误语义沿用现状：密码登录失败统一返回 `Invalid credentials`（防枚举）；验证码登录失败返回通用校验失败。

### 4.6 DTO 调整
- `RegisterDto`：改为 `{ email, code, password, nickname, platform? }`，去掉 `accountId`。
- `LoginDto`：改为 `{ email, password, platform? }`（原 `accountId` → `email`）。
- 新增 `LoginWithCodeDto`：`{ email, code, platform? }`。
- 新增 `RequestEmailCodeDto`：`{ email, purpose }`。
- 全部用 `class-validator` 校验（`@IsEmail`、`@Length` 等）。

## 5. 前端设计（circle-im）

### 5.1 LoginScreen
- 顶部分段控件切换 **「密码登录」/「验证码登录」**（复用现有 `option-picker` 或简单 segmented control）。
- 公共：邮箱输入框（`keyboardType="email-address"`、`autoComplete="email"`）。
- 密码模式：密码输入 + 登录按钮 → `login(email, password)`。
- 验证码模式：验证码输入 + 「发送验证码」按钮（**60s 倒计时**禁用）→ 发码后输入 → `loginWithCode(email, code)`。
- 「切换账号」过期跳登录的预填参数由 `accountId` 改为 `email`。

### 5.2 RegisterScreen
- 字段：邮箱 + 「发送验证码」(60s 倒计时) + 验证码 + 密码 + 昵称。
- **删除 `accountId` 输入**。
- 提交 → `register({ email, code, password, nickname })`。

### 5.3 API 层（services/api/auth.ts）
- 新增 `requestEmailCode({ email, purpose })`。
- 新增 `loginWithCode({ email, code })`。
- 改 `login({ email, password })`、`register({ email, code, password, nickname })` 入参。
- **移除** `changeAccountId`。

### 5.4 use-auth.ts
- `login(email, password)`：入参由 account 改 email，校验改为邮箱格式。
- 新增 `loginWithCode(email, code)`：与 `login` 共用 token 落库 / IM / known-accounts / 跳转逻辑（抽公共 `onAuthSuccess(tokens)` 辅助函数避免重复）。
- `register(...)`：改为邮箱/验证码/密码/昵称。
- known-accounts、switchAccount / switchToAccount 仍以 `user.id` 为键，逻辑不变；仅过期跳登录的预填参数改为 email。

### 5.5 i18n（en.json / zh.json）
新增文案：邮箱占位符、发送验证码、验证码占位符、倒计时（`{{seconds}}s`）、登录方式切换标签、验证码相关错误提示等。

## 6. 安全与错误处理
- 验证码只存 argon2 哈希，绝不存明文 / 不回传。
- 登录验证码对不存在邮箱静默成功，防枚举；密码登录沿用统一 `Invalid credentials`。
- 限流：发码 60s 冷却 + `@nestjs/throttler` 全局兜底。
- 验证码 10min 过期、最多 5 次尝试、一次性消费。
- 前端所有输入做基本校验（邮箱格式、验证码 6 位数字、密码长度 ≥ 6）。

## 7. 测试计划（TDD）
**后端**
- `EmailVerificationService`：发码冷却、注册邮箱占用、登录静默成功、过期、尝试次数上限、成功消费。
- `generateUniqueAccountId`：碰撞重试、格式。
- `register` / `login` / `login/code` 控制器 + service：成功与各失败分支。
- 调整现有 `auth.service.spec.ts` / `auth.controller.spec.ts` / `register.dto.spec.ts`。

**前端**
- LoginScreen 两种模式渲染与提交、倒计时禁用。
- RegisterScreen 字段与提交。
- `services/api/auth.ts` 新增/改动函数。
- `use-auth` 的 login / loginWithCode / register。

## 8. 迁移
- 开发阶段：重置数据库（或手动给测试账号补 `email`），跑新迁移。不写老数据兼容逻辑。

## 9. 待办 / 风险
- 真实邮件供应商生产对接（接口已留，单独配置）。
- 忘记密码独立流程后续另立项。
