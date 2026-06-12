# 邮箱认证重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把登录从「自填 accountId + 密码」改为「邮箱 + 密码」或「邮箱 + 验证码」，accountId 改由后端自动生成；注册改为「邮箱 + 验证码 + 密码 + 昵称」。

**Architecture:** 后端（NestJS + Prisma）新增邮箱验证码（OTP）能力：DB 存哈希验证码、可插拔 Mailer（开发期控制台输出）、`EmailVerificationService` 负责发码/验码；`AuthService` 改为按 email 查用户、注册时自动生成唯一 accountId。前端（Expo/RN）改造 Login/Register 两屏与 `use-auth` hook、auth API 层，并退掉自助改号入口。

**Tech Stack:** NestJS、Prisma(Postgres)、argon2、class-validator、`@nestjs/throttler`、Expo Router、React Native、node:test（前端测试）、jest（后端测试）。

**关联 spec:** `docs/superpowers/specs/2026-06-11-email-auth-refactor-design.md`

---

## 执行约定

- 两个仓库：后端 `/Users/yiboding/projects/circle_be`，前端 `/Users/yiboding/projects/circle-im`（当前分支 `feat/email-auth`）。
- **Phase A（后端）必须先做完**，前端依赖其接口。
- 后端跑单测：`cd /Users/yiboding/projects/circle_be && npx jest <path> -t '<name>'`。
- 前端跑单测：`cd /Users/yiboding/projects/circle-im && node --test test/<file>.test.js`。
- 每个 Task 末尾提交一次。提交信息遵循 `<type>: <desc>`，**不加 Co-Authored-By**（用户全局关闭署名）。

---

## File Structure

### 后端（circle_be）— 新建
- `src/utils/email.ts` — `normalizeEmail()`：trim + 转小写，登录/注册/发码统一入口归一化邮箱。
- `src/auth/account-id.unique.ts` — `generateUniqueAccountId()`：复用现有 `generateAccountId()`，查重重试得到唯一号。
- `src/auth/mailer/mailer.interface.ts` — `MAILER` 注入 token + `Mailer` 接口。
- `src/auth/mailer/console.mailer.ts` — `ConsoleMailer`：开发期把验证码打到 Logger。
- `src/auth/email-verification.service.ts` — `EmailVerificationService`：`requestCode()` / `verifyCode()`。
- `src/auth/dto/request-email-code.dto.ts` — 发码 DTO。
- `src/auth/dto/login-with-code.dto.ts` — 验证码登录 DTO。
- 测试：`src/auth/account-id.unique.spec.ts`、`src/auth/__test__/email-verification.service.spec.ts`。

### 后端（circle_be）— 修改
- `prisma/schema.prisma` — `email` 加 `@unique`；新增 `EmailVerificationCode` 模型与 `EmailCodePurpose` 枚举。
- `src/auth/dto/register.dto.ts` — 改为 `{ email, code, password, nickname, platform? }`。
- `src/auth/dto/login.dto.ts` — 改为 `{ email, password, platform? }`。
- `src/auth/auth.service.ts` — 注入 `EmailVerificationService`；重写 `register`/`login`，新增 `loginWithCode`、`requestEmailCode`，抽 `finishLogin`。
- `src/auth/auth.controller.ts` — 新增 `POST email/request-code`、`POST login/code`。
- `src/auth/auth.module.ts` — 注册 `EmailVerificationService`、`MAILER`。
- 测试：`src/auth/__test__/auth.service.spec.ts`、`src/auth/__test__/auth.controller.spec.ts`、`src/auth/dto/register.dto.spec.ts`。

### 前端（circle-im）— 新建
- `src/hooks/use-countdown.ts` — 倒计时 hook（发送验证码按钮用）。
- 测试：`test/use-countdown.test.js`。

### 前端（circle-im）— 修改
- `src/services/api/auth.ts` — 改 `login`/`register`，新增 `requestEmailCode`/`loginWithCode`，删 `changeAccountId`。
- `src/hooks/use-auth.ts` — 抽 `onAuthSuccess`；`login(email,password)`、新增 `loginWithCode`、改 `register`；过期跳登录预填 email。
- `src/features/auth/screens/LoginScreen.tsx` — 邮箱 + 密码/验证码分段切换。
- `src/features/auth/screens/RegisterScreen.tsx` — 邮箱 + 发码 + 验证码 + 密码 + 昵称。
- `src/i18n/locales/en.json`、`src/i18n/locales/zh.json` — 新增 auth 文案。
- `src/features/profile/screens/AccountSecuritySettingsScreen.tsx` — 删除「修改账号」入口行。
- 测试：`test/auth-api.test.js` — 改 login/register 断言、删 changeAccountId 测试、加 requestEmailCode/loginWithCode。

### 前端（circle-im）— 删除
- `app/(tabs)/profile/change-account.tsx`
- `src/features/profile/screens/ChangeAccountScreen.tsx`

---

# Phase A — 后端（circle_be）

## Task A1: Prisma schema — email 唯一 + 验证码模型

**Files:**
- Modify: `prisma/schema.prisma`（User.email 约 270 行；枚举区与 Core Models 区）

- [ ] **Step 1: email 加唯一约束**

把 `prisma/schema.prisma` 中 `User` 模型的：
```prisma
  email                      String?
```
改为：
```prisma
  email                      String?    @unique
```

- [ ] **Step 2: 新增枚举与模型**

在 `prisma/schema.prisma` 顶部枚举区（紧接现有 `enum UserStatus { ... }` 之后）加入：
```prisma
enum EmailCodePurpose {
  REGISTER
  LOGIN
}
```

在文件末尾（其它 model 之后）加入：
```prisma
model EmailVerificationCode {
  id         String           @id @default(cuid())
  email      String
  codeHash   String
  purpose    EmailCodePurpose
  expiresAt  DateTime
  attempts   Int              @default(0)
  consumedAt DateTime?
  createdAt  DateTime         @default(now())

  @@index([email, purpose])
}
```

- [ ] **Step 3: 生成迁移与客户端**

开发库可直接重置（spec 已确认开发期清库）：
```bash
cd /Users/yiboding/projects/circle_be
npx prisma migrate dev --name email_auth_refactor
```
若因历史数据中 email 重复/为空导致唯一约束失败，开发期重置：
```bash
npx prisma migrate reset --force && npx prisma migrate dev --name email_auth_refactor
```
Expected: 生成 `prisma/migrations/*_email_auth_refactor/`，`src/generated/prisma` 含 `EmailVerificationCode`、`EmailCodePurpose`。

- [ ] **Step 4: Commit**
```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add email unique + EmailVerificationCode model"
```

---

## Task A2: 唯一 accountId 生成器

**Files:**
- Create: `src/auth/account-id.unique.ts`
- Test: `src/auth/account-id.unique.spec.ts`

- [ ] **Step 1: 写失败测试**

`src/auth/account-id.unique.spec.ts`:
```ts
import { generateUniqueAccountId } from './account-id.unique';

describe('generateUniqueAccountId', () => {
  it('returns the first candidate when it is free', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const id = await generateUniqueAccountId(prisma as any, () => 'ACC_AAAAAA');
    expect(id).toBe('ACC_AAAAAA');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('retries on collision until a free id is found', async () => {
    const taken = new Set(['ACC_DUP001']);
    const prisma = {
      user: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(taken.has(where.accountId) ? { id: 'x' } : null),
        ),
      },
    };
    const seq = ['ACC_DUP001', 'ACC_DUP001', 'ACC_FREE99'];
    let i = 0;
    const id = await generateUniqueAccountId(prisma as any, () => seq[i++]);
    expect(id).toBe('ACC_FREE99');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting attempts', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'x' }) },
    };
    await expect(
      generateUniqueAccountId(prisma as any, () => 'ACC_ALWAYS'),
    ).rejects.toThrow(/unique account ID/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/yiboding/projects/circle_be && npx jest src/auth/account-id.unique.spec.ts`
Expected: FAIL — Cannot find module './account-id.unique'.

- [ ] **Step 3: 实现**

`src/auth/account-id.unique.ts`:
```ts
import { generateAccountId } from 'src/utils/account-id';

type AccountIdGenerator = () => string;

interface AccountIdLookup {
  user: {
    findUnique(args: {
      where: { accountId: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
}

const MAX_ATTEMPTS = 10;

/**
 * 生成一个数据库内唯一的 accountId。复用纯随机生成器 generateAccountId()，
 * 碰撞则重试；MAX_ATTEMPTS 次仍冲突视为异常（概率极低，通常是 DB 故障）。
 */
export async function generateUniqueAccountId(
  prisma: AccountIdLookup,
  generate: AccountIdGenerator = generateAccountId,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = generate();
    const existing = await prisma.user.findUnique({
      where: { accountId: candidate },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
  }
  throw new Error('Failed to generate a unique account ID');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/auth/account-id.unique.spec.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**
```bash
git add src/auth/account-id.unique.ts src/auth/account-id.unique.spec.ts
git commit -m "feat: add unique accountId generator"
```

---

## Task A3: email 归一化工具

**Files:**
- Create: `src/utils/email.ts`
- Test: `src/utils/email.spec.ts`

- [ ] **Step 1: 写失败测试**

`src/utils/email.spec.ts`:
```ts
import { normalizeEmail } from './email';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/utils/email.spec.ts`
Expected: FAIL — Cannot find module './email'.

- [ ] **Step 3: 实现**

`src/utils/email.ts`:
```ts
/** 邮箱归一化：去空格 + 转小写。注册/登录/发码必须经此统一，避免大小写造成查不到用户。 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/utils/email.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**
```bash
git add src/utils/email.ts src/utils/email.spec.ts
git commit -m "feat: add normalizeEmail util"
```

---

## Task A4: Mailer 抽象 + ConsoleMailer

**Files:**
- Create: `src/auth/mailer/mailer.interface.ts`
- Create: `src/auth/mailer/console.mailer.ts`

- [ ] **Step 1: 定义接口与 token**

`src/auth/mailer/mailer.interface.ts`:
```ts
import { EmailCodePurpose } from 'src/generated/prisma';

/** DI token — 生产环境用真实实现覆盖此 provider 即可，业务代码零改动。 */
export const MAILER = Symbol('MAILER');

export interface Mailer {
  sendVerificationCode(
    email: string,
    code: string,
    purpose: EmailCodePurpose,
  ): Promise<void>;
}
```

- [ ] **Step 2: 实现 ConsoleMailer**

`src/auth/mailer/console.mailer.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { EmailCodePurpose } from 'src/generated/prisma';
import { Mailer } from './mailer.interface';

/** 开发期 Mailer：把验证码打到日志，不真正发信。生产环境请替换为真实实现。 */
@Injectable()
export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger('ConsoleMailer');

  sendVerificationCode(
    email: string,
    code: string,
    purpose: EmailCodePurpose,
  ): Promise<void> {
    this.logger.log(`[DEV] verification code for ${email} (${purpose}): ${code}`);
    return Promise.resolve();
  }
}
```

- [ ] **Step 3: 编译确认无类型错误**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无与上述两文件相关的报错（若 `src/generated/prisma` 未生成请先跑 Task A1 Step 3）。

- [ ] **Step 4: Commit**
```bash
git add src/auth/mailer
git commit -m "feat: add pluggable Mailer with ConsoleMailer"
```

---

## Task A5: EmailVerificationService

**Files:**
- Create: `src/auth/email-verification.service.ts`
- Test: `src/auth/__test__/email-verification.service.spec.ts`

- [ ] **Step 1: 写失败测试**

`src/auth/__test__/email-verification.service.spec.ts`:
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { EmailVerificationService } from '../email-verification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MAILER } from '../mailer/mailer.interface';

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;
  let codes: any[];
  let usersByEmail: Set<string>;
  const mailer = { sendVerificationCode: jest.fn(() => Promise.resolve()) };

  const mockPrisma = {
    emailVerificationCode: {
      findFirst: jest.fn(({ where }) => {
        const list = codes
          .filter(
            (c) =>
              c.email === where.email &&
              c.purpose === where.purpose &&
              (where.consumedAt === undefined || c.consumedAt === null) &&
              (!where.expiresAt || c.expiresAt > where.expiresAt.gt),
          )
          .sort((a, b) => b.createdAt - a.createdAt);
        return Promise.resolve(list[0] ?? null);
      }),
      deleteMany: jest.fn(({ where }) => {
        codes = codes.filter(
          (c) =>
            !(
              c.email === where.email &&
              c.purpose === where.purpose &&
              c.consumedAt === null
            ),
        );
        return Promise.resolve({ count: 0 });
      }),
      create: jest.fn(({ data }) => {
        // createdAt 必须是 Date（真实 Prisma 行为）——requestCode 冷却逻辑会调用 .getTime()。
        const row = { id: `c-${codes.length}`, attempts: 0, consumedAt: null, createdAt: new Date(), ...data };
        codes.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }) => {
        const row = codes.find((c) => c.id === where.id);
        if (data.attempts?.increment) row.attempts += data.attempts.increment;
        if (data.consumedAt) row.consumedAt = data.consumedAt;
        return Promise.resolve(row);
      }),
    },
    user: {
      findUnique: jest.fn(({ where }) =>
        Promise.resolve(usersByEmail.has(where.email) ? { id: 'u1' } : null),
      ),
    },
  };

  beforeEach(async () => {
    codes = [];
    usersByEmail = new Set();
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MAILER, useValue: mailer },
      ],
    }).compile();
    service = module.get(EmailVerificationService);
  });

  it('requestCode(register) sends a code and stores a hash', async () => {
    await service.requestCode('a@b.com', 'REGISTER');
    expect(mailer.sendVerificationCode).toHaveBeenCalledTimes(1);
    expect(codes).toHaveLength(1);
    expect(codes[0].codeHash).not.toMatch(/^\d{6}$/); // hashed, not plaintext
  });

  it('requestCode(register) throws if email already registered', async () => {
    usersByEmail.add('a@b.com');
    await expect(service.requestCode('a@b.com', 'REGISTER')).rejects.toThrow(
      ConflictException,
    );
  });

  it('requestCode(login) is silent (no send) for unknown email', async () => {
    await service.requestCode('ghost@b.com', 'LOGIN');
    expect(mailer.sendVerificationCode).not.toHaveBeenCalled();
    expect(codes).toHaveLength(0);
  });

  it('requestCode enforces a resend cooldown', async () => {
    usersByEmail.add('a@b.com');
    await service.requestCode('a@b.com', 'LOGIN');
    await expect(service.requestCode('a@b.com', 'LOGIN')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('verifyCode succeeds once then is consumed', async () => {
    // seed a known code
    const codeHash = await argon2.hash('123456');
    codes.push({
      id: 'c0', email: 'a@b.com', purpose: 'LOGIN', codeHash,
      attempts: 0, consumedAt: null,
      expiresAt: new Date(Date.now() + 60000), createdAt: Date.now(),
    });
    await expect(service.verifyCode('a@b.com', 'LOGIN', '123456')).resolves.toBe(true);
    await expect(service.verifyCode('a@b.com', 'LOGIN', '123456')).resolves.toBe(false);
  });

  it('verifyCode returns false for wrong code and counts attempts', async () => {
    const codeHash = await argon2.hash('123456');
    codes.push({
      id: 'c0', email: 'a@b.com', purpose: 'LOGIN', codeHash,
      attempts: 0, consumedAt: null,
      expiresAt: new Date(Date.now() + 60000), createdAt: Date.now(),
    });
    await expect(service.verifyCode('a@b.com', 'LOGIN', '000000')).resolves.toBe(false);
    expect(codes[0].attempts).toBe(1);
  });

  it('verifyCode returns false when expired', async () => {
    const codeHash = await argon2.hash('123456');
    codes.push({
      id: 'c0', email: 'a@b.com', purpose: 'LOGIN', codeHash,
      attempts: 0, consumedAt: null,
      expiresAt: new Date(Date.now() - 1000), createdAt: Date.now(),
    });
    await expect(service.verifyCode('a@b.com', 'LOGIN', '123456')).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/auth/__test__/email-verification.service.spec.ts`
Expected: FAIL — Cannot find module '../email-verification.service'.

- [ ] **Step 3: 实现**

`src/auth/email-verification.service.ts`:
```ts
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import * as argon2 from 'argon2';
import { EmailCodePurpose } from 'src/generated/prisma';
import { PrismaService } from 'src/prisma/prisma.service';
import { normalizeEmail } from 'src/utils/email';
import { MAILER, Mailer } from './mailer/mailer.interface';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 分钟
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 秒
const MAX_ATTEMPTS = 5;

@Injectable()
export class EmailVerificationService {
  constructor(
    private prisma: PrismaService,
    @Inject(MAILER) private mailer: Mailer,
  ) {}

  private generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  async requestCode(rawEmail: string, purpose: EmailCodePurpose): Promise<void> {
    const email = normalizeEmail(rawEmail);

    const last = await this.prisma.emailVerificationCode.findFirst({
      where: { email, purpose },
      orderBy: { createdAt: 'desc' },
    });
    if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new BadRequestException('验证码发送过于频繁，请稍后再试');
    }

    const userExists = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (purpose === 'REGISTER' && userExists) {
      throw new ConflictException('该邮箱已注册');
    }
    if (purpose === 'LOGIN' && !userExists) {
      // 防账号枚举：未注册邮箱静默成功，不创建记录、不发信。
      return;
    }

    const code = this.generateCode();
    const codeHash = await argon2.hash(code);

    // 同 email+purpose 仅保留最新一条未消费记录。
    await this.prisma.emailVerificationCode.deleteMany({
      where: { email, purpose, consumedAt: null },
    });
    await this.prisma.emailVerificationCode.create({
      data: {
        email,
        codeHash,
        purpose,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });

    await this.mailer.sendVerificationCode(email, code, purpose);
  }

  async verifyCode(
    rawEmail: string,
    purpose: EmailCodePurpose,
    code: string,
  ): Promise<boolean> {
    const email = normalizeEmail(rawEmail);

    const record = await this.prisma.emailVerificationCode.findFirst({
      where: {
        email,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record || record.attempts >= MAX_ATTEMPTS) {
      return false;
    }

    const valid = await argon2.verify(record.codeHash, code);
    if (!valid) {
      await this.prisma.emailVerificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      return false;
    }

    await this.prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return true;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/auth/__test__/email-verification.service.spec.ts`
Expected: PASS（7 个用例）。

- [ ] **Step 5: Commit**
```bash
git add src/auth/email-verification.service.ts src/auth/__test__/email-verification.service.spec.ts
git commit -m "feat: add EmailVerificationService (request/verify codes)"
```

---

## Task A6: DTO 改造

**Files:**
- Modify: `src/auth/dto/login.dto.ts`
- Modify: `src/auth/dto/register.dto.ts`
- Create: `src/auth/dto/login-with-code.dto.ts`
- Create: `src/auth/dto/request-email-code.dto.ts`
- Modify: `src/auth/dto/register.dto.spec.ts`

- [ ] **Step 1: 改写 register.dto.spec.ts（失败测试）**

替换 `src/auth/dto/register.dto.spec.ts` 全文：
```ts
import 'reflect-metadata';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

describe('RegisterDto', () => {
  function base(): RegisterDto {
    const dto = new RegisterDto();
    dto.email = 'user@example.com';
    dto.code = '123456';
    dto.password = 'password123';
    dto.nickname = 'Jimmy';
    return dto;
  }

  it('accepts a valid payload', async () => {
    expect(await validate(base())).toHaveLength(0);
  });

  it('rejects an invalid email', async () => {
    const dto = base();
    dto.email = 'not-an-email';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects a non-6-digit code', async () => {
    const dto = base();
    dto.code = '12ab';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'code')).toBe(true);
  });

  it('rejects a missing nickname', async () => {
    const dto = base();
    dto.nickname = '';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'nickname')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/auth/dto/register.dto.spec.ts`
Expected: FAIL（旧 RegisterDto 没有 email/code 校验）。

- [ ] **Step 3: 改写 login.dto.ts**

替换 `src/auth/dto/login.dto.ts` 全文：
```ts
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 64)
  password: string;

  /** OpenIM platform ID — 1=iOS, 2=Android, 5=Web. */
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsIn([1, 2, 5])
  platform?: 1 | 2 | 5;
}
```

- [ ] **Step 4: 改写 register.dto.ts**

替换 `src/auth/dto/register.dto.ts` 全文：
```ts
import { IsEmail, IsIn, IsNumberString, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsNumberString()
  @Length(6, 6)
  code: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @Length(6, 64)
  password: string;

  @ApiProperty({ example: 'Jimmy' })
  @IsString()
  @Length(1, 50)
  nickname: string;

  /** OpenIM platform ID — see LoginDto.platform. */
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsIn([1, 2, 5])
  platform?: 1 | 2 | 5;
}
```

- [ ] **Step 5: 新增 login-with-code.dto.ts**

`src/auth/dto/login-with-code.dto.ts`:
```ts
import { IsEmail, IsIn, IsNumberString, IsOptional, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginWithCodeDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsNumberString()
  @Length(6, 6)
  code: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsIn([1, 2, 5])
  platform?: 1 | 2 | 5;
}
```

- [ ] **Step 6: 新增 request-email-code.dto.ts**

`src/auth/dto/request-email-code.dto.ts`:
```ts
import { IsEmail, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestEmailCodeDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'register', enum: ['register', 'login'] })
  @IsIn(['register', 'login'])
  purpose: 'register' | 'login';
}
```

- [ ] **Step 7: 跑 register.dto 测试确认通过**

Run: `npx jest src/auth/dto/register.dto.spec.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 8: Commit**
```bash
git add src/auth/dto
git commit -m "feat: rework auth DTOs for email login + verification code"
```

---

## Task A7: AuthService 改造

**Files:**
- Modify: `src/auth/auth.service.ts`
- Modify: `src/auth/__test__/auth.service.spec.ts`

- [ ] **Step 1: 改写 auth.service.spec.ts（失败测试）**

在 `src/auth/__test__/auth.service.spec.ts` 中做如下改动：

(a) `mockPrisma.user.findUnique` 改为同时支持按 email 查（替换现有实现）：
```ts
      findUnique: jest.fn(({ where }) =>
        Promise.resolve(
          users.find(
            (u) =>
              u.accountId === where.accountId ||
              u.id === where.id ||
              u.email === where.email,
          ) ?? null,
        ),
      ),
```
并在 `beforeEach` 内的 `mockPrisma.user.findUnique.mockImplementation(...)` 同步改为上面三选一的查找逻辑。

(b) 新增一个 EmailVerificationService mock（放在其它 mock 旁）：
```ts
  const mockEmailVerification = {
    requestCode: jest.fn(() => Promise.resolve()),
    verifyCode: jest.fn(() => Promise.resolve(true)),
  };
```

(c) 顶部 import 增补，并在 `Test.createTestingModule({ providers: [...] })` 中追加 provider：
```ts
// 顶部 import 区
import { EmailVerificationService } from '../email-verification.service';
```
```ts
// providers 数组内
        { provide: EmailVerificationService, useValue: mockEmailVerification },
```

(d) 把现有 register/login 用例替换为下列（accountId 自动生成、email 登录、验证码登录）：
```ts
  it('register creates user with auto accountId and returns tokens', async () => {
    const result = await service.register({
      email: 'new@example.com',
      code: '123456',
      password: 'password1',
      nickname: 'Test User',
    } as any);
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(users[0].accountId).toMatch(/^ACC_/);
    expect(users[0].email).toBe('new@example.com');
  });

  it('register throws BadRequest when code invalid', async () => {
    mockEmailVerification.verifyCode.mockResolvedValueOnce(false);
    await expect(
      service.register({
        email: 'x@example.com',
        code: '000000',
        password: 'password1',
        nickname: 'X',
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('register throws Conflict when email already used', async () => {
    users.push({ id: 'u0', accountId: 'ACC_OLD000', email: 'dupe@example.com', status: 'ACTIVE' });
    await expect(
      service.register({
        email: 'dupe@example.com',
        code: '123456',
        password: 'password1',
        nickname: 'Dupe',
      } as any),
    ).rejects.toThrow(ConflictException);
  });

  it('login by email returns tokens with correct password', async () => {
    const passwordHash = await argon2.hash('password1');
    users.push({ id: 'uuid-1', accountId: 'ACC_AAA111', email: 'a@example.com', passwordHash, status: 'ACTIVE', role: 'USER' });
    const result = await service.login({ email: 'a@example.com', password: 'password1' } as any);
    expect(result.accessToken).toBe('access-token');
  });

  it('login throws ForbiddenException for unknown email', async () => {
    await expect(
      service.login({ email: 'noone@example.com', password: 'password1' } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('login throws ForbiddenException for wrong password', async () => {
    const passwordHash = await argon2.hash('password1');
    users.push({ id: 'uuid-1', accountId: 'ACC_AAA111', email: 'a@example.com', passwordHash, status: 'ACTIVE', role: 'USER' });
    await expect(
      service.login({ email: 'a@example.com', password: 'wrongpass' } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('loginWithCode returns tokens when code valid', async () => {
    users.push({ id: 'uuid-1', accountId: 'ACC_AAA111', email: 'a@example.com', passwordHash: 'x', status: 'ACTIVE', role: 'USER' });
    mockEmailVerification.verifyCode.mockResolvedValueOnce(true);
    const result = await service.loginWithCode({ email: 'a@example.com', code: '123456' } as any);
    expect(result.accessToken).toBe('access-token');
  });

  it('loginWithCode throws ForbiddenException when code invalid', async () => {
    users.push({ id: 'uuid-1', accountId: 'ACC_AAA111', email: 'a@example.com', passwordHash: 'x', status: 'ACTIVE', role: 'USER' });
    mockEmailVerification.verifyCode.mockResolvedValueOnce(false);
    await expect(
      service.loginWithCode({ email: 'a@example.com', code: '000000' } as any),
    ).rejects.toThrow(ForbiddenException);
  });
```
> 删除旧的 `register throws ConflictException if username taken`、`login returns tokens with correct credentials`、`login throws ... unknown user`、`login throws ... wrong password` 四个用例（已被上面替换）。`login forwards session metadata ...` 用例把 `accountId: 'testuser'` 的 user 加上 `email: 'a@example.com'`，并把调用改为 `service.login({ email: 'a@example.com', password: 'password1' })`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/auth/__test__/auth.service.spec.ts`
Expected: FAIL（service 尚无 loginWithCode、register 签名未改）。

- [ ] **Step 3: 实现 — 改造 auth.service.ts**

(a) 顶部 imports 增加：
```ts
import { EmailVerificationService } from './email-verification.service';
import { generateUniqueAccountId } from './account-id.unique';
import { normalizeEmail } from 'src/utils/email';
```

(b) 构造函数注入（在现有参数列表追加）：
```ts
    private emailVerification: EmailVerificationService,
```

(c) 用下列实现替换现有 `register` 方法：
```ts
  async register(dto: RegisterDto, sessionContext?: SessionContext) {
    const email = normalizeEmail(dto.email);

    const codeOk = await this.emailVerification.verifyCode(
      email,
      'REGISTER',
      dto.code,
    );
    if (!codeOk) {
      throw new BadRequestException('验证码错误或已过期');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('该邮箱已注册');
    }

    const passwordHash = await argon2.hash(dto.password);
    const accountId = await generateUniqueAccountId(this.prisma);

    const user = await this.prisma.user.create({
      data: {
        accountId,
        passwordHash,
        nickname: dto.nickname,
        email,
      },
    });

    // Sync to OpenIM non-blocking. Mark openimSynced=true on success so
    // login() can detect and retry if this first attempt failed.
    this.openim
      .registerUser(user.id, user.nickname, user.avatarUrl)
      .then(() =>
        this.prisma.user.update({
          where: { id: user.id },
          data: { openimSynced: true },
        }),
      )
      .catch((err) =>
        this.logger.warn(
          `OpenIM registerUser failed for ${user.id}: ${err?.message}. Will retry on next login.`,
        ),
      );

    logBusinessEvent(this.logger, {
      enabled: this.loggingConfig.businessLogOn,
      businessEvent: 'auth_register_success',
      actorId: user.id,
      result: 'success',
      entityType: 'user',
      entityId: user.id,
    });

    return this.issueTokens(
      user.id,
      user.accountId,
      user.role,
      sessionContext,
      dto.platform,
    );
  }
```

(d) 用下列实现替换现有 `login` 方法（按 email 查 + 抽出的 finishLogin）：
```ts
  async login(dto: LoginDto, sessionContext?: SessionContext) {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    // 同一错误覆盖「无此用户」与「非激活」，避免账号枚举；真实原因仅记日志。
    if (!user || user.status !== 'ACTIVE') {
      if (user && user.status !== 'ACTIVE') {
        this.logger.warn(
          `Login attempt for non-active account ${user.id} (status=${user.status})`,
        );
      }
      logBusinessEvent(this.logger, {
        enabled: this.loggingConfig.businessLogOn,
        businessEvent: 'auth_login_failed',
        actorId: user?.id,
        result: 'failure',
        metadata: { reason: user ? 'inactive_account' : 'invalid_credentials' },
      });
      throw new ForbiddenException('Invalid credentials');
    }

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      logBusinessEvent(this.logger, {
        enabled: this.loggingConfig.businessLogOn,
        businessEvent: 'auth_login_failed',
        actorId: user.id,
        result: 'failure',
        metadata: { reason: 'invalid_credentials' },
      });
      throw new ForbiddenException('Invalid credentials');
    }

    return this.finishLogin(user, sessionContext, dto.platform);
  }

  async loginWithCode(dto: LoginWithCodeDto, sessionContext?: SessionContext) {
    const email = normalizeEmail(dto.email);

    const codeOk = await this.emailVerification.verifyCode(
      email,
      'LOGIN',
      dto.code,
    );
    if (!codeOk) {
      throw new ForbiddenException('Invalid credentials');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('Invalid credentials');
    }

    return this.finishLogin(user, sessionContext, dto.platform);
  }

  async requestEmailCode(
    email: string,
    purpose: 'register' | 'login',
  ): Promise<void> {
    await this.emailVerification.requestCode(
      email,
      purpose === 'register' ? 'REGISTER' : 'LOGIN',
    );
  }

  /** 密码登录与验证码登录共用的收尾：OpenIM 重同步、lastOnline、发 token、记日志。 */
  private async finishLogin(
    user: { id: string; accountId: string; role: string; nickname: string; avatarUrl: string | null; openimSynced: boolean; singleDeviceLoginEnabled: boolean },
    sessionContext?: SessionContext,
    platform?: 1 | 2 | 5,
  ) {
    if (!user.openimSynced) {
      this.openim
        .registerUser(user.id, user.nickname, user.avatarUrl)
        .then(() =>
          this.prisma.user.update({
            where: { id: user.id },
            data: { openimSynced: true },
          }),
        )
        .catch((err) =>
          this.logger.warn(`OpenIM re-sync failed for ${user.id}: ${err?.message}`),
        );
    }

    this.prisma.user
      .update({ where: { id: user.id }, data: { lastOnline: new Date() } })
      .catch((err) =>
        this.logger.warn(`lastOnline update failed for ${user.id}: ${err?.message}`),
      );

    const tokens = await this.issueTokens(
      user.id,
      user.accountId,
      user.role,
      sessionContext,
      platform,
      { revokeExistingSessions: user.singleDeviceLoginEnabled },
    );

    logBusinessEvent(this.logger, {
      enabled: this.loggingConfig.businessLogOn,
      businessEvent: 'auth_login_success',
      actorId: user.id,
      result: 'success',
      entityType: 'user',
      entityId: user.id,
    });

    return tokens;
  }
```

(e) 顶部 import 增加 DTO 类型：
```ts
import { LoginWithCodeDto } from './dto/login-with-code.dto';
```
（`BadRequestException` 已在现有 imports 中。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/auth/__test__/auth.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**
```bash
git add src/auth/auth.service.ts src/auth/__test__/auth.service.spec.ts
git commit -m "feat: email login, code login and auto accountId in AuthService"
```

---

## Task A8: AuthController + Module 接线

**Files:**
- Modify: `src/auth/auth.controller.ts`
- Modify: `src/auth/auth.module.ts`
- Modify: `src/auth/__test__/auth.controller.spec.ts`

- [ ] **Step 1: 改 controller 测试（失败测试）**

在 `src/auth/__test__/auth.controller.spec.ts`:

(a) `mockAuthService` 增加方法：
```ts
    loginWithCode: (_dto: any) => Promise.resolve(mockTokenPayload as any),
    requestEmailCode: jest.fn((_email: string, _purpose: string) => Promise.resolve()),
```

(b) 把 `register returns tokens` / `login returns tokens` 用例改为新 DTO 形状，并新增两条：
```ts
  it('register returns tokens', async () => {
    const result = await controller.register({
      email: 'user@example.com',
      code: '123456',
      password: 'password1',
      nickname: 'Test User',
    } as any);
    expect(result).toEqual(mockTokenPayload);
  });

  it('login returns tokens', async () => {
    const result = await controller.login({
      email: 'user@example.com',
      password: 'password1',
    } as any);
    expect(result).toEqual(mockTokenPayload);
  });

  it('loginWithCode returns tokens', async () => {
    const result = await controller.loginWithCode({
      email: 'user@example.com',
      code: '123456',
    } as any);
    expect(result).toEqual(mockTokenPayload);
  });

  it('requestEmailCode maps purpose and delegates to service', async () => {
    await controller.requestEmailCode({ email: 'user@example.com', purpose: 'register' });
    expect(mockAuthService.requestEmailCode).toHaveBeenCalledWith(
      'user@example.com',
      'register',
    );
  });
```
> 顶部 import 增补：`import { LoginWithCodeDto } from '../dto/login-with-code.dto';` 与 `import { RequestEmailCodeDto } from '../dto/request-email-code.dto';`（用 `as any` 传参时非必须，但保持一致）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/auth/__test__/auth.controller.spec.ts`
Expected: FAIL（controller 无 loginWithCode/requestEmailCode）。

- [ ] **Step 3: 改 controller**

在 `src/auth/auth.controller.ts`:

(a) imports 增补：
```ts
import { LoginWithCodeDto } from './dto/login-with-code.dto';
import { RequestEmailCodeDto } from './dto/request-email-code.dto';
```

(b) 在 `login` 方法之后插入两个新端点：
```ts
  @Post('email/request-code')
  @ApiOperation({ summary: 'Request an email verification code' })
  @ApiBody({ type: RequestEmailCodeDto })
  @ApiCreatedResponse({ description: 'Verification code sent (or silently ignored)' })
  requestEmailCode(@Body() dto: RequestEmailCodeDto) {
    return this.authService.requestEmailCode(dto.email, dto.purpose);
  }

  @Post('login/code')
  @ApiOperation({ summary: 'Login with email and verification code' })
  @ApiBody({ type: LoginWithCodeDto })
  @ApiHeader({
    name: 'x-device-name',
    required: false,
    description: 'Optional device name to store with the refresh session',
  })
  @ApiCreatedResponse({ description: 'Login successful', type: AuthTokensDto })
  @ApiForbiddenResponse({ description: 'Invalid or expired code' })
  loginWithCode(@Body() dto: LoginWithCodeDto, @Req() req?: Request) {
    return this.authService.loginWithCode(dto, getSessionContext(req));
  }
```

- [ ] **Step 4: 接线 module**

在 `src/auth/auth.module.ts`:

(a) imports 增补：
```ts
import { EmailVerificationService } from './email-verification.service';
import { MAILER } from './mailer/mailer.interface';
import { ConsoleMailer } from './mailer/console.mailer';
```

(b) `providers` 数组追加：
```ts
    EmailVerificationService,
    { provide: MAILER, useClass: ConsoleMailer },
```

- [ ] **Step 5: 跑 controller 测试确认通过**

Run: `npx jest src/auth/__test__/auth.controller.spec.ts`
Expected: PASS。

- [ ] **Step 6: 跑整个 auth 测试套件**

Run: `npx jest src/auth`
Expected: 全绿。

- [ ] **Step 7: Commit**
```bash
git add src/auth/auth.controller.ts src/auth/auth.module.ts src/auth/__test__/auth.controller.spec.ts
git commit -m "feat: add request-code and code-login endpoints; wire mailer"
```

---

# Phase B — 前端（circle-im）

> 前端工作目录 `/Users/yiboding/projects/circle-im`，分支 `feat/email-auth`。

## Task B1: auth API 层改造

**Files:**
- Modify: `src/services/api/auth.ts`
- Modify: `test/auth-api.test.js`

- [ ] **Step 1: 改写 auth-api 测试（失败测试）**

在 `test/auth-api.test.js`:

(a) **删除** `changeAccountId patches the account id endpoint` 整个 test 块（约 81–102 行）。

(b) **替换** `login trims accountId before sending to backend` 为：
```js
test("login posts normalized email and password", async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return { accessToken: "a-token", refreshToken: "r-token", imToken: "i-token" };
  };
  const { login } = loadAuthApi(apiClientMock);

  await login({ email: "  USER@Example.com ", password: "pw" });

  assert.equal(calls[0].endpoint, "/auth/login");
  assert.equal(calls[0].options.body.email, "user@example.com");
  assert.equal(calls[0].options.body.password, "pw");
});
```

(c) **替换** `register trims accountId and validates response shape` 为：
```js
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
```

(d) 把 `login normalizes missing/empty imToken to null` 和 `login throws when accessToken or refreshToken missing` 两个用例里所有 `login({ accountId: "a", password: "p" })` 改为 `login({ email: "a@b.com", password: "p" })`。

(e) **新增**两个 test：
```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/yiboding/projects/circle-im && node --test test/auth-api.test.js`
Expected: FAIL（requestEmailCode/loginWithCode 未定义；login/register 形状不符）。

- [ ] **Step 3: 改 auth.ts**

在 `src/services/api/auth.ts`:

(a) 删除 `RegisterPayload` 类型（约 93–99 行）。

(b) 用下列替换现有 `login` 与 `register` 函数，并新增 `requestEmailCode`、`loginWithCode`：
```ts
export async function requestEmailCode(payload: {
  email: string;
  purpose: 'register' | 'login';
}) {
  return apiClient<void>('/auth/email/request-code', {
    method: 'POST',
    auth: false,
    body: {
      email: payload.email.trim().toLowerCase(),
      purpose: payload.purpose,
    },
  });
}

export async function login(payload: { email: string; password: string }) {
  const email = payload.email.trim().toLowerCase();
  const raw = await apiClient<AuthTokens>('/auth/login', {
    method: 'POST',
    auth: false,
    headers: { 'x-device-name': getDeviceName() },
    body: { email, password: payload.password, platform: getOpenIMPlatformID() },
  });
  return ensureAuthTokens(raw);
}

export async function loginWithCode(payload: { email: string; code: string }) {
  const email = payload.email.trim().toLowerCase();
  const raw = await apiClient<AuthTokens>('/auth/login/code', {
    method: 'POST',
    auth: false,
    headers: { 'x-device-name': getDeviceName() },
    body: { email, code: payload.code.trim(), platform: getOpenIMPlatformID() },
  });
  return ensureAuthTokens(raw);
}

export async function register(payload: {
  email: string;
  code: string;
  password: string;
  nickname: string;
}) {
  const email = payload.email.trim().toLowerCase();
  const raw = await apiClient<AuthTokens>('/auth/register', {
    method: 'POST',
    auth: false,
    headers: { 'x-device-name': getDeviceName() },
    body: {
      email,
      code: payload.code.trim(),
      password: payload.password,
      nickname: payload.nickname.trim(),
      platform: getOpenIMPlatformID(),
    },
  });
  return ensureAuthTokens(raw);
}
```

(c) 删除 `changeAccountId` 函数（约 201–206 行）。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/auth-api.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**
```bash
git add src/services/api/auth.ts test/auth-api.test.js
git commit -m "feat: email/code auth API; drop changeAccountId"
```

---

## Task B2: 倒计时 hook

**Files:**
- Create: `src/hooks/use-countdown.ts`
- Test: `test/use-countdown.test.js`

- [ ] **Step 1: 写失败测试**

`test/use-countdown.test.js`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// 加载并提取 hook 内部的纯逻辑 reducer（tick / start）以便无 React 环境下测试。
function loadModule() {
  const filePath = path.join(process.cwd(), "src/hooks/use-countdown.ts");
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === "react") {
        return { useState: () => [0, () => {}], useEffect: () => {}, useCallback: (fn) => fn, useRef: () => ({ current: null }) };
      }
      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test("nextTick decrements to zero and stops", () => {
  const { nextTick } = loadModule();
  assert.equal(nextTick(3), 2);
  assert.equal(nextTick(1), 0);
  assert.equal(nextTick(0), 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/use-countdown.test.js`
Expected: FAIL — Cannot find module '.../use-countdown.ts'。

- [ ] **Step 3: 实现**

`src/hooks/use-countdown.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from 'react';

/** 纯函数：倒计时每秒递减，地板为 0。抽出来便于无 React 环境单测。 */
export function nextTick(seconds: number): number {
  return seconds > 0 ? seconds - 1 : 0;
}

export interface Countdown {
  seconds: number;
  running: boolean;
  start: (from: number) => void;
}

/** 倒计时 hook：start(n) 后每秒 -1 到 0；running 期间用于禁用「发送验证码」按钮。 */
export function useCountdown(): Countdown {
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(
    (from: number) => {
      clear();
      setSeconds(from);
      timerRef.current = setInterval(() => {
        setSeconds((prev) => {
          const next = nextTick(prev);
          if (next === 0 && timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return next;
        });
      }, 1000);
    },
    [clear],
  );

  useEffect(() => clear, [clear]);

  return { seconds, running: seconds > 0, start };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/use-countdown.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**
```bash
git add src/hooks/use-countdown.ts test/use-countdown.test.js
git commit -m "feat: add useCountdown hook for resend cooldown"
```

---

## Task B3: use-auth hook 改造

**Files:**
- Modify: `src/hooks/use-auth.ts`

> 此 hook 无现成渲染测试（仓库未配置 RN 渲染测试），改动靠 Task B1 的 API 测试 + 后续手动验证覆盖。改完跑 `npx tsc` 确认类型。

- [ ] **Step 1: 调整 imports**

把 auth API import 改为：
```ts
import {
  fetchCurrentUser,
  fetchCurrentUserWithToken,
  login as loginRequest,
  loginWithCode as loginWithCodeRequest,
  logout as logoutRequest,
  register as registerRequest,
  type AuthTokens,
} from '@/services/api/auth';
```

- [ ] **Step 2: 加邮箱校验 helper + onAuthSuccess**

在 `useAuth()` 内、`login` 定义之前加入：
```ts
  const isValidEmail = useCallback(
    (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    [],
  );

  // 密码登录与验证码登录的共同收尾：拉用户、落 session、记账号、登 IM、跳转。
  const onAuthSuccess = useCallback(
    async (tokens: AuthTokens) => {
      const user = await retry(() =>
        fetchCurrentUserWithToken(tokens.accessToken),
      );
      setSession(tokens, user);
      useKnownAccountsStore.getState().upsertAccount({
        user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        imToken: tokens.imToken,
        updatedAt: Date.now(),
      });
      if (tokens.imToken) {
        try {
          await loginToOpenIM(user.id, tokens.imToken);
        } catch (imError) {
          console.warn(
            '[openim] login failed',
            imError instanceof Error ? imError.message : imError,
          );
        }
      } else {
        await logoutFromOpenIM();
      }
      void useMessageGroupsStore.getState().load();
      router.replace('/(tabs)/messages');
    },
    [router, setSession],
  );
```

- [ ] **Step 3: 用 email 重写 login，并新增 loginWithCode**

用下列替换现有 `login` 实现：
```ts
  const login = useCallback(
    async (email: string, password: string) => {
      if (inFlightRef.current) return;
      safeSetError(null);
      const normalizedEmail = email.trim();
      if (!normalizedEmail) {
        safeSetError('请输入邮箱');
        return;
      }
      if (!isValidEmail(normalizedEmail)) {
        safeSetError('邮箱格式不正确');
        return;
      }
      if (!password.trim()) {
        safeSetError('请输入密码');
        return;
      }
      inFlightRef.current = true;
      safeSetSubmitting(true);
      try {
        const tokens = await loginRequest({ email: normalizedEmail, password });
        await onAuthSuccess(tokens);
      } catch (requestError) {
        await clearLocalSession();
        safeSetError(getApiErrorMessage(requestError, '登录失败，请重试'));
      } finally {
        inFlightRef.current = false;
        safeSetSubmitting(false);
      }
    },
    [onAuthSuccess, isValidEmail, safeSetError, safeSetSubmitting],
  );

  const loginWithCode = useCallback(
    async (email: string, code: string) => {
      if (inFlightRef.current) return;
      safeSetError(null);
      const normalizedEmail = email.trim();
      if (!isValidEmail(normalizedEmail)) {
        safeSetError('邮箱格式不正确');
        return;
      }
      if (!/^\d{6}$/.test(code.trim())) {
        safeSetError('请输入6位验证码');
        return;
      }
      inFlightRef.current = true;
      safeSetSubmitting(true);
      try {
        const tokens = await loginWithCodeRequest({
          email: normalizedEmail,
          code: code.trim(),
        });
        await onAuthSuccess(tokens);
      } catch (requestError) {
        await clearLocalSession();
        safeSetError(getApiErrorMessage(requestError, '登录失败，请重试'));
      } finally {
        inFlightRef.current = false;
        safeSetSubmitting(false);
      }
    },
    [onAuthSuccess, isValidEmail, safeSetError, safeSetSubmitting],
  );
```

- [ ] **Step 4: 重写 register（email/code/password/nickname）**

用下列替换现有 `register` 实现：
```ts
  const register = useCallback(
    async (
      email: string,
      code: string,
      password: string,
      nickname: string,
    ) => {
      if (inFlightRef.current) return;
      safeSetError(null);
      const normalizedEmail = email.trim();
      if (!isValidEmail(normalizedEmail)) {
        safeSetError('邮箱格式不正确');
        return;
      }
      if (!/^\d{6}$/.test(code.trim())) {
        safeSetError('请输入6位验证码');
        return;
      }
      if (password.length < 6) {
        safeSetError('密码至少6位');
        return;
      }
      if (!nickname.trim()) {
        safeSetError('请输入昵称');
        return;
      }

      inFlightRef.current = true;
      safeSetSubmitting(true);
      try {
        await registerRequest({
          email: normalizedEmail,
          code: code.trim(),
          password,
          nickname: nickname.trim(),
        });
        router.replace({
          pathname: '/(auth)/login',
          params: { email: normalizedEmail },
        });
      } catch (requestError) {
        safeSetError(getApiErrorMessage(requestError, '注册失败，请重试'));
      } finally {
        inFlightRef.current = false;
        safeSetSubmitting(false);
      }
    },
    [router, isValidEmail, safeSetError, safeSetSubmitting],
  );
```

- [ ] **Step 5: 过期分支预填 email + 导出 loginWithCode**

(a) 在 `switchToAccount` 的 catch 分支里，把：
```ts
        router.replace({
          pathname: '/(auth)/login',
          params: { accountId: account.user.accountId },
        });
```
改为：
```ts
        router.replace({
          pathname: '/(auth)/login',
          params: { email: account.user.email ?? '' },
        });
```

(b) 在 `return { ... }` 里加入 `loginWithCode`：
```ts
    login,
    loginWithCode,
    register,
```

- [ ] **Step 6: 类型检查**

Run: `cd /Users/yiboding/projects/circle-im && npx tsc --noEmit`
Expected: 无 use-auth.ts 相关报错。

- [ ] **Step 7: Commit**
```bash
git add src/hooks/use-auth.ts
git commit -m "feat: email/password and email/code flows in use-auth"
```

---

## Task B4: i18n 文案

**Files:**
- Modify: `src/i18n/locales/zh.json`
- Modify: `src/i18n/locales/en.json`

- [ ] **Step 1: zh.json — 在 auth 块追加键**

在 `src/i18n/locales/zh.json` 的 `"auth"` 对象内追加：
```json
    "emailPlaceholder": "请输入邮箱",
    "passwordLogin": "密码登录",
    "codeLogin": "验证码登录",
    "sendCode": "发送验证码",
    "resendCodeIn": "{{seconds}}s 后重发",
    "codePlaceholder": "请输入验证码",
    "codeSent": "验证码已发送",
    "email": "邮箱"
```
> 注意：`auth` 块已存在 `"account"` 等键，确保 JSON 逗号正确（在前一键尾补逗号）。

- [ ] **Step 2: en.json — 同步英文**

在 `src/i18n/locales/en.json` 的 `"auth"` 对象内追加：
```json
    "emailPlaceholder": "Email",
    "passwordLogin": "Password",
    "codeLogin": "Code",
    "sendCode": "Send code",
    "resendCodeIn": "Resend in {{seconds}}s",
    "codePlaceholder": "Verification code",
    "codeSent": "Code sent",
    "email": "Email"
```

- [ ] **Step 3: 校验 JSON 合法**

Run: `node -e "require('./src/i18n/locales/zh.json');require('./src/i18n/locales/en.json');console.log('ok')"`
Expected: 输出 `ok`。

- [ ] **Step 4: Commit**
```bash
git add src/i18n/locales/zh.json src/i18n/locales/en.json
git commit -m "feat: add i18n strings for email auth"
```

---

## Task B5: LoginScreen 改造

**Files:**
- Modify: `src/features/auth/screens/LoginScreen.tsx`

> UI 任务：无渲染测试，提供完整代码，靠 Task B9 手动验证。

- [ ] **Step 1: 用下列整文件替换 `src/features/auth/screens/LoginScreen.tsx`**

```tsx
import { AuthInput } from "@/components/ui/auth-input";
import { useAuth } from "@/hooks/use-auth";
import { useCountdown } from "@/hooks/use-countdown";
import { requestEmailCode } from "@/services/api/auth";
import { getApiErrorMessage } from "@/services/api/errors";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import { Link, useLocalSearchParams } from "expo-router";
import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Mode = "password" | "code";

const s = StyleSheet.create({
  scroll: { flex: 1 },
  container: { paddingHorizontal: Spacing.lg, alignItems: "center", gap: 28 },
  logo: {
    width: 72,
    height: 72,
    borderRadius: Radius.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  logoOuter: {
    position: "absolute",
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.19)",
  },
  logoMiddle: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.31)",
  },
  logoDot: { width: 12, height: 12, borderRadius: 6 },
  headingGroup: { alignItems: "center", gap: Spacing.sm, width: "100%" },
  heading: { fontSize: 28, fontWeight: "700" },
  subtitle: { ...Typography.body },
  segment: {
    flexDirection: "row",
    width: "100%",
    borderRadius: Radius.md,
    padding: 4,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    height: 40,
    borderRadius: Radius.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  segmentText: { fontSize: 14, fontWeight: "600" },
  form: { width: "100%", gap: Spacing.md },
  sendBtn: { paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  sendBtnText: { fontSize: 13, fontWeight: "600" },
  forgotRow: { alignItems: "flex-end" },
  forgotLink: { ...Typography.caption },
  error: { ...Typography.caption },
  loginBtn: {
    width: "100%",
    height: 52,
    borderRadius: Radius.md,
    justifyContent: "center",
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.6 },
  loginBtnText: { fontSize: 16, fontWeight: "600" },
  registerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  registerHint: { ...Typography.bodyRegular },
  registerLink: { fontSize: 14, fontWeight: "600" },
});

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { login, loginWithCode, submitting, error } = useAuth();
  const { t } = useTranslation();
  // 从「切换账号」过期分支或注册成功跳来时预填邮箱。
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState(emailParam ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const countdown = useCountdown();

  const d = useMemo(
    () => ({
      scroll: { backgroundColor: colors.background },
      logo: { backgroundColor: colors.primary },
      logoDot: { backgroundColor: colors.white },
      heading: { color: colors.text },
      subtitle: { color: colors.textSecondary },
      segment: { backgroundColor: colors.surface },
      segmentActive: { backgroundColor: colors.primary },
      segmentText: { color: colors.textSecondary },
      segmentTextActive: { color: colors.white },
      sendBtnText: { color: colors.primary },
      forgotLink: { color: colors.primary },
      error: { color: colors.error },
      loginBtn: { backgroundColor: colors.primary },
      loginBtnText: { color: colors.white },
      registerHint: { color: colors.textSecondary },
      registerLink: { color: colors.primary },
    }),
    [colors],
  );

  const onSendCode = useCallback(async () => {
    setSendError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setSendError(t("auth.invalidEmail", { defaultValue: "邮箱格式不正确" }));
      return;
    }
    try {
      await requestEmailCode({ email: normalizedEmail, purpose: "login" });
      countdown.start(60);
    } catch (e) {
      setSendError(getApiErrorMessage(e, "发送失败，请重试"));
    }
  }, [email, countdown, t]);

  const onForgotPassword = useCallback(() => {
    Alert.alert(
      t("auth.forgotPassword"),
      t("auth.forgotPasswordHint", {
        defaultValue: "可改用验证码登录；如需找回账号请联系客服。",
      }),
    );
  }, [t]);

  const onSubmit = useCallback(() => {
    if (mode === "password") {
      login(email, password);
    } else {
      loginWithCode(email, code);
    }
  }, [mode, login, loginWithCode, email, password, code]);

  return (
    <ScrollView
      style={[s.scroll, d.scroll]}
      contentContainerStyle={[
        s.container,
        { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[s.logo, d.logo]}>
        <View style={s.logoOuter} />
        <View style={s.logoMiddle} />
        <View style={[s.logoDot, d.logoDot]} />
      </View>

      <View style={s.headingGroup}>
        <Text style={[s.heading, d.heading]}>{t("auth.welcomeBack")}</Text>
        <Text style={[s.subtitle, d.subtitle]}>{t("auth.loginSubtitle")}</Text>
      </View>

      {/* 登录方式切换 */}
      <View style={[s.segment, d.segment]}>
        {(["password", "code"] as Mode[]).map((m) => (
          <Pressable
            key={m}
            style={[s.segmentItem, mode === m && d.segmentActive]}
            onPress={() => setMode(m)}
          >
            <Text
              style={[
                s.segmentText,
                mode === m ? d.segmentTextActive : d.segmentText,
              ]}
            >
              {t(m === "password" ? "auth.passwordLogin" : "auth.codeLogin")}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Form */}
      <View style={s.form}>
        <AuthInput
          placeholder={t("auth.emailPlaceholder")}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
        />

        {mode === "password" ? (
          <>
            <AuthInput
              placeholder={t("auth.passwordPlaceholder")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
            />
            <View style={s.forgotRow}>
              <Pressable onPress={onForgotPassword} hitSlop={8}>
                <Text style={[s.forgotLink, d.forgotLink]}>
                  {t("auth.forgotPassword")}
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <AuthInput
            placeholder={t("auth.codePlaceholder")}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            rightElement={
              <Pressable
                style={s.sendBtn}
                onPress={onSendCode}
                disabled={countdown.running}
                hitSlop={8}
              >
                <Text
                  style={[
                    s.sendBtnText,
                    { color: countdown.running ? colors.textSecondary : colors.primary },
                  ]}
                >
                  {countdown.running
                    ? t("auth.resendCodeIn", { seconds: countdown.seconds })
                    : t("auth.sendCode")}
                </Text>
              </Pressable>
            }
          />
        )}
      </View>

      {sendError ? <Text style={[s.error, d.error]}>{sendError}</Text> : null}
      {error ? <Text style={[s.error, d.error]}>{error}</Text> : null}

      <Pressable
        style={[s.loginBtn, d.loginBtn, submitting && s.btnDisabled]}
        onPress={onSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={[s.loginBtnText, d.loginBtnText]}>{t("auth.login")}</Text>
        )}
      </Pressable>

      <View style={s.registerRow}>
        <Text style={[s.registerHint, d.registerHint]}>
          {t("auth.noAccount")}
        </Text>
        <Link href="/(auth)/register" asChild>
          <Pressable>
            <Text style={[s.registerLink, d.registerLink]}>
              {t("auth.registerNow")}
            </Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无 LoginScreen 相关报错（若 `Radius.sm` 不存在，用 8 替代该处 borderRadius）。

- [ ] **Step 3: Commit**
```bash
git add src/features/auth/screens/LoginScreen.tsx
git commit -m "feat: email login screen with password/code modes"
```

---

## Task B6: RegisterScreen 改造

**Files:**
- Modify: `src/features/auth/screens/RegisterScreen.tsx`

- [ ] **Step 1: 改状态与字段**

把组件内的 state 由：
```tsx
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [agreed, setAgreed] = useState(false);
```
改为：
```tsx
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const countdown = useCountdown();
```

- [ ] **Step 2: 增加 imports 与发码逻辑**

顶部 import 增补：
```tsx
import { useCallback } from 'react';
import { useCountdown } from '@/hooks/use-countdown';
import { requestEmailCode } from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';
```
（若文件已从 'react' 解构 `useState, useMemo`，把 `useCallback` 并入同一解构。）

在 `return (` 之前加入：
```tsx
  const onSendCode = useCallback(async () => {
    setSendError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setSendError(t('auth.invalidEmail', { defaultValue: '邮箱格式不正确' }));
      return;
    }
    try {
      await requestEmailCode({ email: normalizedEmail, purpose: 'register' });
      countdown.start(60);
    } catch (e) {
      setSendError(getApiErrorMessage(e, '发送失败，请重试'));
    }
  }, [email, countdown, t]);
```

- [ ] **Step 3: 替换表单 JSX**

把四个 `AuthInput`（account/password/confirmPassword/nickname）整段替换为：
```tsx
      <AuthInput
        label={t('auth.email')}
        placeholder={t('auth.emailPlaceholder')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
      />

      <AuthInput
        label={t('auth.codePlaceholder')}
        placeholder={t('auth.codePlaceholder')}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        rightElement={
          <Pressable onPress={onSendCode} disabled={countdown.running} hitSlop={8}>
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: countdown.running ? colors.textSecondary : colors.primary,
              }}
            >
              {countdown.running
                ? t('auth.resendCodeIn', { seconds: countdown.seconds })
                : t('auth.sendCode')}
            </Text>
          </Pressable>
        }
      />

      <AuthInput
        label={t('auth.password')}
        placeholder={t('auth.passwordHint')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="newPassword"
        autoComplete="new-password"
      />

      <AuthInput
        label={t('auth.nickname')}
        placeholder={t('auth.nicknameHint')}
        value={nickname}
        onChangeText={setNickname}
        textContentType="nickname"
        autoComplete="name"
      />

      {sendError ? (
        <Text style={[s.error, d.error]}>{sendError}</Text>
      ) : null}
```

- [ ] **Step 4: 改注册按钮调用**

把注册按钮 onPress 内：
```tsx
          register(account, password, nickname, confirmPassword);
```
改为：
```tsx
          register(email, code, password, nickname);
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无 RegisterScreen 相关报错。

- [ ] **Step 6: Commit**
```bash
git add src/features/auth/screens/RegisterScreen.tsx
git commit -m "feat: email + code registration screen"
```

---

## Task B7: 退掉自助改号入口

**Files:**
- Delete: `app/(tabs)/profile/change-account.tsx`
- Delete: `src/features/profile/screens/ChangeAccountScreen.tsx`
- Modify: `src/features/profile/screens/AccountSecuritySettingsScreen.tsx`

- [ ] **Step 1: 删除「修改账号」设置行**

在 `src/features/profile/screens/AccountSecuritySettingsScreen.tsx`，删除这一整个 row 对象（约 127–133 行）：
```tsx
            {
              id: "change-account",
              labelKey: "settingsDetails.accountSecurity.changeAccount",
              valueKey: "settingsDetails.accountSecurity.changeAccountHint",
              onPress: () =>
                router.push("/(tabs)/profile/change-account" as never),
            },
```

- [ ] **Step 2: 删除路由与屏幕文件**
```bash
cd /Users/yiboding/projects/circle-im
git rm "app/(tabs)/profile/change-account.tsx" src/features/profile/screens/ChangeAccountScreen.tsx
```

- [ ] **Step 3: 确认无残留引用**

Run: `grep -rn "ChangeAccountScreen\|change-account\|changeAccountId" src/ app/`
Expected: 无输出（i18n 里的 `changeAccountId` 文案键可保留，不影响）。

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无相关报错。

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "refactor: remove self-service account ID change"
```

---

## Task B8: 全量回归

- [ ] **Step 1: 后端测试**

Run: `cd /Users/yiboding/projects/circle_be && npx jest src/auth`
Expected: 全绿。

- [ ] **Step 2: 前端测试**

Run: `cd /Users/yiboding/projects/circle-im && node --test test/auth-api.test.js test/use-countdown.test.js`
Expected: 全绿。

- [ ] **Step 3: 前端类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增报错。

- [ ] **Step 4: 后端类型检查 / lint**

Run: `cd /Users/yiboding/projects/circle_be && npx tsc --noEmit`
Expected: 无新增报错。

---

## Task B9: 手动验证（端到端）

> 需后端本地运行 + 前端 Expo dev client。验证码从后端日志（ConsoleMailer 输出 `[DEV] verification code ...`）获取。

- [ ] **Step 1:** 启动后端，观察启动无误（迁移已应用）。
- [ ] **Step 2:** 注册：填邮箱 → 点「发送验证码」→ 后端日志取码 → 填码/密码/昵称 → 注册成功跳登录页且邮箱已预填。
- [ ] **Step 3:** 密码登录：邮箱 + 密码 → 进入消息页。
- [ ] **Step 4:** 验证码登录：切到「验证码登录」→ 发码 → 取码 → 登录成功；确认 60s 倒计时禁用「发送」。
- [ ] **Step 5:** 设置页确认「修改账号」入口已消失，「修改密码」「登录安全码」仍正常。
- [ ] **Step 6:** 切换账号→过期分支：确认跳登录页时邮箱预填正确。

---

## 完成标准
- 两种登录方式（邮箱+密码 / 邮箱+验证码）可用；注册走邮箱+验证码+密码+昵称；accountId 自动生成 `ACC_xxxxxx`。
- 自助改号入口与 API 已移除。
- 后端 `src/auth` 测试、前端 `auth-api` / `use-countdown` 测试全绿；两端 `tsc` 通过。
- ConsoleMailer 在 dev 打印验证码；生产可替换 `MAILER` provider。
