# 临时聊天 — 后端（circle_be）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `circle_be` 落地「临时聊天」后端：App 用户建房 → 生成可过期分享链接 → 访客免注册经后端静默建号进群 → 到期/手动销毁并清理。

**Architecture:** 新增 NestJS `temp-chat` 模块（controller + service + cleanup cron + link-token service + DTO），复用现有 `OpenimService`（再补 `dismissGroup` / `forceLogout` 两个方法）和 `PrismaService`。两张新表 `TempChat` / `TempChatGuest`。访客身份由后端用 admin 凭证静默建号，链接用 `@nestjs/jwt` 签发。

**Tech Stack:** NestJS 11、Prisma 7（`src/generated/prisma`）、`@nestjs/jwt`（已装）、`@nestjs/throttler`（已装，限流）、`@nestjs/schedule`（本计划新增，cron）、jest 30。ID 用 `crypto.randomUUID()` 去连字符（不引入 nanoid）。

**范围说明：** 本计划只覆盖**后端**（设计文档 §17 阶段 1–3）。访客 Web 页（`temp-chat-web`）与 App 端发起/分享 UI 各自另出计划，依赖本后端先落地。

**对应 spec：** [`docs/superpowers/specs/2026-06-04-temp-chat-design.md`](../specs/2026-06-04-temp-chat-design.md)

---

## 文件结构（后端）

**新增**
- `circle_be/src/temp-chat/temp-chat.module.ts` — 模块装配
- `circle_be/src/temp-chat/temp-chat.controller.ts` — 路由 + 鉴权 + 限流
- `circle_be/src/temp-chat/temp-chat.service.ts` — 业务编排（create/join/end/getByToken/teardown）
- `circle_be/src/temp-chat/temp-chat.service.spec.ts` — 服务单测
- `circle_be/src/temp-chat/temp-chat.cleanup.ts` — `@Cron` 销毁到期房
- `circle_be/src/temp-chat/temp-chat.cleanup.spec.ts` — 清理单测
- `circle_be/src/temp-chat/link-token.service.ts` — 分享链接 JWT 签发/校验
- `circle_be/src/temp-chat/link-token.service.spec.ts` — 令牌单测
- `circle_be/src/temp-chat/temp-chat.ids.ts` — ID 生成小工具
- `circle_be/src/temp-chat/temp-chat.ids.spec.ts` — 工具单测
- `circle_be/src/temp-chat/dto/create-temp-chat.dto.ts`
- `circle_be/src/temp-chat/dto/join-temp-chat.dto.ts`
- `circle_be/src/temp-chat/dto/temp-chat.dto.spec.ts` — DTO 校验单测

**改动**
- `circle_be/prisma/schema.prisma` — +enum +2 model
- `circle_be/src/openim/openim.service.ts` — +`dismissGroup` +`forceLogout`
- `circle_be/src/openim/openim.service.spec.ts` — 新建，覆盖两个新方法
- `circle_be/src/app.module.ts` — 注册 `TempChatModule` + `ScheduleModule.forRoot()`
- `circle_be/package.json` — +`@nestjs/schedule`

> 所有命令默认在 `circle_be` 目录执行：`cd /Users/yiboding/projects/circle_be`。

---

## Task 1: 依赖、Prisma schema 与迁移

**Files:**
- Modify: `circle_be/package.json`（加 `@nestjs/schedule`）
- Modify: `circle_be/prisma/schema.prisma`

- [ ] **Step 1: 安装定时任务依赖**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npm i @nestjs/schedule
```
Expected: 安装成功，`package.json` 出现 `@nestjs/schedule`。

- [ ] **Step 2: 在 schema.prisma 末尾追加 enum + 两张表**

追加到 `circle_be/prisma/schema.prisma`：

```prisma
enum TempChatStatus {
  ACTIVE
  ENDED
  EXPIRED
}

model TempChat {
  id         String         @id @default(uuid())
  groupId    String         @unique
  hostUserId String
  title      String         @default("临时聊天")
  status     TempChatStatus @default(ACTIVE)
  maxMembers Int            @default(50)
  expiresAt  DateTime
  endedAt    DateTime?
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt

  guests TempChatGuest[]

  @@index([status, expiresAt])
  @@index([hostUserId])
}

model TempChatGuest {
  id          String   @id @default(uuid())
  tempChatId  String
  imUserId    String   @unique
  displayName String
  createdAt   DateTime @default(now())
  lastSeenAt  DateTime @default(now())
  cleanedUp   Boolean  @default(false)

  tempChat TempChat @relation(fields: [tempChatId], references: [id], onDelete: Cascade)

  @@index([tempChatId])
}
```

- [ ] **Step 3: 生成迁移并更新 client**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx prisma migrate dev --name add_temp_chat
```
Expected: 新迁移目录 `prisma/migrations/*_add_temp_chat/`，`src/generated/prisma` 重新生成，`TempChat` / `TempChatGuest` / `TempChatStatus` 可被 import。

- [ ] **Step 4: 校验 schema**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx prisma validate
```
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/circle_be
git add prisma/schema.prisma prisma/migrations package.json package-lock.json
git commit -m "feat(temp-chat): add TempChat/TempChatGuest schema and schedule dep"
```

---

## Task 2: ID 工具（temp-chat.ids.ts）

OpenIM v3.8 校验器拒绝连字符（见 `OpenimService.toImUserId`），所以临时房的 groupId / 访客 id 都用去连字符的随机串。

**Files:**
- Create: `circle_be/src/temp-chat/temp-chat.ids.ts`
- Test: `circle_be/src/temp-chat/temp-chat.ids.spec.ts`

- [ ] **Step 1: 写失败测试**

`circle_be/src/temp-chat/temp-chat.ids.spec.ts`:
```ts
import { newGroupId, newGuestId } from './temp-chat.ids';

describe('temp-chat ids', () => {
  it('groupId 以 tmp 开头且不含连字符', () => {
    const id = newGroupId();
    expect(id.startsWith('tmp')).toBe(true);
    expect(id).not.toContain('-');
    expect(id.length).toBeGreaterThan(10);
  });

  it('guestId 以 g 开头且不含连字符', () => {
    const id = newGuestId();
    expect(id.startsWith('g')).toBe(true);
    expect(id).not.toContain('-');
  });

  it('连续生成不重复', () => {
    expect(newGroupId()).not.toBe(newGroupId());
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/temp-chat/temp-chat.ids.spec.ts
```
Expected: FAIL（`Cannot find module './temp-chat.ids'`）。

- [ ] **Step 3: 实现**

`circle_be/src/temp-chat/temp-chat.ids.ts`:
```ts
import { randomUUID } from 'crypto';

/** OpenIM 不接受连字符，统一去掉。 */
const raw = (): string => randomUUID().replace(/-/g, '');

export const newGroupId = (): string => `tmp${raw()}`;
export const newGuestId = (): string => `g${raw()}`;
```

- [ ] **Step 4: 运行，确认通过**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/temp-chat/temp-chat.ids.spec.ts
```
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/circle_be
git add src/temp-chat/temp-chat.ids.ts src/temp-chat/temp-chat.ids.spec.ts
git commit -m "feat(temp-chat): add id generator util"
```

---

## Task 3: 扩展 OpenimService（dismissGroup / forceLogout）

**Files:**
- Modify: `circle_be/src/openim/openim.service.ts`
- Create: `circle_be/src/openim/openim.service.spec.ts`

- [ ] **Step 1: 写失败测试**

`circle_be/src/openim/openim.service.spec.ts`:
```ts
import { ConfigService } from '@nestjs/config';
import { OpenimService } from './openim.service';

describe('OpenimService group/auth admin calls', () => {
  let service: OpenimService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    const config = {
      get: (k: string) =>
        k === 'OPENIM_API_URL'
          ? 'http://im.local'
          : k === 'OPENIM_ADMIN_SECRET'
            ? 'secret'
            : undefined,
    } as unknown as ConfigService;
    service = new OpenimService(config);

    fetchMock = jest.fn(async (url: string) => ({
      json: async () =>
        url.endsWith('/auth/get_admin_token')
          ? { errCode: 0, data: { token: 'admin-token' } }
          : { errCode: 0, data: {} },
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('dismissGroup posts /group/dismiss_group with deleteMember=true', async () => {
    await service.dismissGroup('tmpABC');
    const call = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith('/group/dismiss_group'),
    );
    expect(call).toBeDefined();
    expect(JSON.parse(call![1].body)).toEqual({
      groupID: 'tmpABC',
      deleteMember: true,
    });
  });

  it('forceLogout strips hyphens and posts /auth/force_logout', async () => {
    await service.forceLogout('gX-Y-Z', 5);
    const call = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith('/auth/force_logout'),
    );
    expect(call).toBeDefined();
    expect(JSON.parse(call![1].body)).toEqual({
      userID: 'gXYZ',
      platformID: 5,
    });
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/openim/openim.service.spec.ts
```
Expected: FAIL（`service.dismissGroup is not a function`）。

- [ ] **Step 3: 实现 —— 在 openim.service.ts 的 Group 区块后追加两个方法**

在 `removeGroupMember` 方法之后、`// ─── HTTP helper ───` 之前插入：
```ts
  /**
   * 解散群。解散后群消息对客户端不再可见，等价于「销毁即清」。
   * 路径已核实：/group/dismiss_group（admin token）。
   */
  async dismissGroup(groupID: string): Promise<void> {
    if (!this.enabled) return;

    const adminToken = await this.getAdminToken();
    await this.post(
      '/group/dismiss_group',
      { groupID, deleteMember: true },
      adminToken,
    );
  }

  /**
   * 强制某用户在指定端下线（清理访客会话）。
   * ⚠️ 路径按部署的 OpenIM 版本确认；调用方需容忍其失败（best-effort）。
   * platformID: 5 = Web
   */
  async forceLogout(userID: string, platformID = 5): Promise<void> {
    if (!this.enabled) return;

    const adminToken = await this.getAdminToken();
    await this.post(
      '/auth/force_logout',
      { userID: OpenimService.toImUserId(userID), platformID },
      adminToken,
    );
  }
```

- [ ] **Step 4: 运行，确认通过**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/openim/openim.service.spec.ts
```
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/circle_be
git add src/openim/openim.service.ts src/openim/openim.service.spec.ts
git commit -m "feat(openim): add dismissGroup and forceLogout"
```

---

## Task 4: 分享链接令牌（link-token.service.ts）

用已装的 `@nestjs/jwt`。载荷 `{ tcId }`，过期时间由调用方按房间 `expiresAt` 传入秒数。

**Files:**
- Create: `circle_be/src/temp-chat/link-token.service.ts`
- Test: `circle_be/src/temp-chat/link-token.service.spec.ts`

- [ ] **Step 1: 写失败测试**

`circle_be/src/temp-chat/link-token.service.spec.ts`:
```ts
import { JwtService } from '@nestjs/jwt';
import { LinkTokenService } from './link-token.service';

describe('LinkTokenService', () => {
  const jwt = new JwtService({ secret: 'test-link-secret' });
  const service = new LinkTokenService(jwt);

  it('signs and verifies a tcId round-trip', () => {
    const token = service.sign('tc-1', 3600);
    expect(service.verify(token)).toEqual({ tcId: 'tc-1' });
  });

  it('throws on tampered token', () => {
    const token = service.sign('tc-1', 3600);
    expect(() => service.verify(token + 'x')).toThrow();
  });

  it('throws on expired token', () => {
    const token = service.sign('tc-1', -1); // already expired
    expect(() => service.verify(token)).toThrow();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/temp-chat/link-token.service.spec.ts
```
Expected: FAIL（`Cannot find module './link-token.service'`）。

- [ ] **Step 3: 实现**

`circle_be/src/temp-chat/link-token.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface LinkTokenPayload {
  tcId: string;
}

@Injectable()
export class LinkTokenService {
  constructor(private readonly jwt: JwtService) {}

  /** expiresInSeconds: 与房间 expiresAt 对齐的剩余秒数。 */
  sign(tcId: string, expiresInSeconds: number): string {
    return this.jwt.sign({ tcId }, { expiresIn: expiresInSeconds });
  }

  /** 校验签名 + 过期；非法/过期抛错（由调用方转 404/410）。 */
  verify(token: string): LinkTokenPayload {
    const payload = this.jwt.verify<LinkTokenPayload>(token);
    return { tcId: payload.tcId };
  }
}
```

> `JwtService` 的密钥在 Task 8 的模块里用 `JwtModule.register({ secret: TEMP_CHAT_LINK_SECRET })` 注入，独立于业务 JWT。

- [ ] **Step 4: 运行，确认通过**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/temp-chat/link-token.service.spec.ts
```
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/circle_be
git add src/temp-chat/link-token.service.ts src/temp-chat/link-token.service.spec.ts
git commit -m "feat(temp-chat): add link token service"
```

---

## Task 5: DTO 与校验

**Files:**
- Create: `circle_be/src/temp-chat/dto/create-temp-chat.dto.ts`
- Create: `circle_be/src/temp-chat/dto/join-temp-chat.dto.ts`
- Test: `circle_be/src/temp-chat/dto/temp-chat.dto.spec.ts`

- [ ] **Step 1: 写失败测试**

`circle_be/src/temp-chat/dto/temp-chat.dto.spec.ts`:
```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateTempChatDto } from './create-temp-chat.dto';
import { JoinTempChatDto } from './join-temp-chat.dto';

const errKeys = (obj: unknown, cls: any) =>
  validateSync(plainToInstance(cls, obj)).map((e) => e.property);

describe('CreateTempChatDto', () => {
  it('accepts empty body (all optional, defaults applied later)', () => {
    expect(errKeys({}, CreateTempChatDto)).toEqual([]);
  });
  it('rejects ttl below 30', () => {
    expect(errKeys({ ttlMinutes: 10 }, CreateTempChatDto)).toContain('ttlMinutes');
  });
  it('rejects ttl above 10080', () => {
    expect(errKeys({ ttlMinutes: 99999 }, CreateTempChatDto)).toContain('ttlMinutes');
  });
  it('rejects maxMembers above 50', () => {
    expect(errKeys({ maxMembers: 51 }, CreateTempChatDto)).toContain('maxMembers');
  });
  it('rejects maxMembers below 2', () => {
    expect(errKeys({ maxMembers: 1 }, CreateTempChatDto)).toContain('maxMembers');
  });
  it('rejects title longer than 30', () => {
    expect(errKeys({ title: 'x'.repeat(31) }, CreateTempChatDto)).toContain('title');
  });
});

describe('JoinTempChatDto', () => {
  it('accepts empty body', () => {
    expect(errKeys({}, JoinTempChatDto)).toEqual([]);
  });
  it('rejects displayName longer than 20', () => {
    expect(errKeys({ displayName: 'x'.repeat(21) }, JoinTempChatDto)).toContain('displayName');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/temp-chat/dto/temp-chat.dto.spec.ts
```
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 实现两个 DTO**

`circle_be/src/temp-chat/dto/create-temp-chat.dto.ts`:
```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateTempChatDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 30, default: '临时聊天' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  title?: string;

  @ApiPropertyOptional({ minimum: 30, maximum: 10080, default: 4320, description: '有效期（分钟），默认 3 天，最长 7 天' })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(10080)
  ttlMinutes?: number;

  @ApiPropertyOptional({ minimum: 2, maximum: 50, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(50)
  maxMembers?: number;
}
```

`circle_be/src/temp-chat/dto/join-temp-chat.dto.ts`:
```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class JoinTempChatDto {
  @ApiPropertyOptional({ maxLength: 20, description: '访客昵称，缺省随机生成' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  displayName?: string;
}
```

- [ ] **Step 4: 运行，确认通过**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/temp-chat/dto/temp-chat.dto.spec.ts
```
Expected: PASS（8 passed）。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/circle_be
git add src/temp-chat/dto
git commit -m "feat(temp-chat): add create/join DTOs with validation"
```

---

## Task 6: TempChatService —— create / getByToken

**Files:**
- Create: `circle_be/src/temp-chat/temp-chat.service.ts`
- Test: `circle_be/src/temp-chat/temp-chat.service.spec.ts`

本 Task 先实现 `create` 与 `getByToken`，`join`/`end`/`teardown` 在 Task 7。先准备好测试骨架（mock）。

- [ ] **Step 1: 写失败测试（create + getByToken）**

`circle_be/src/temp-chat/temp-chat.service.spec.ts`:
```ts
import { GoneException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { OpenimService } from 'src/openim/openim.service';
import { LinkTokenService } from './link-token.service';
import { TempChatService } from './temp-chat.service';

const buildRow = (o: Partial<any> = {}) => ({
  id: 'tc-1',
  groupId: 'tmpABC',
  hostUserId: 'host-1',
  title: '临时聊天',
  status: 'ACTIVE',
  maxMembers: 50,
  expiresAt: new Date(Date.now() + 3 * 24 * 3600 * 1000),
  endedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

describe('TempChatService', () => {
  let service: TempChatService;

  const prisma = {
    tempChat: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    tempChatGuest: { create: jest.fn(), count: jest.fn(), delete: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(prisma)),
  };
  const openim = {
    createGroup: jest.fn(),
    dismissGroup: jest.fn(),
    registerUser: jest.fn(),
    addGroupMembers: jest.fn(),
    getUserToken: jest.fn(),
    forceLogout: jest.fn(),
  };
  const linkToken = { sign: jest.fn(() => 'signed-token'), verify: jest.fn() };
  const config = {
    get: (k: string, d?: any) =>
      ({
        TEMP_CHAT_WEB_BASE: 'https://chat.example.com',
        TEMP_CHAT_DEFAULT_TTL_MINUTES: 4320,
        TEMP_CHAT_MAX_MEMBERS: 50,
        OPENIM_IM_WS_URL: 'wss://im.example.com/ws',
        OPENIM_IM_API_URL: 'https://im.example.com',
      })[k] ?? d,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        TempChatService,
        { provide: PrismaService, useValue: prisma },
        { provide: OpenimService, useValue: openim },
        { provide: LinkTokenService, useValue: linkToken },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = mod.get(TempChatService);
  });

  describe('create', () => {
    it('creates OpenIM group then persists and returns shareUrl', async () => {
      prisma.tempChat.create.mockResolvedValue(buildRow());
      const res = await service.create('host-1', { title: '周末爬山' });

      expect(openim.createGroup).toHaveBeenCalledWith(
        expect.stringMatching(/^tmp/), '周末爬山', 'host-1', ['host-1'],
      );
      expect(res.shareUrl).toBe('https://chat.example.com/t/signed-token');
      expect(res.groupId).toMatch(/^tmp/);
    });

    it('rolls back the OpenIM group if persistence fails', async () => {
      prisma.tempChat.create.mockRejectedValue(new Error('db down'));
      await expect(service.create('host-1', {})).rejects.toThrow('db down');
      expect(openim.dismissGroup).toHaveBeenCalledWith(expect.stringMatching(/^tmp/));
    });

    it('applies default ttl (3 days) and maxMembers (50)', async () => {
      prisma.tempChat.create.mockResolvedValue(buildRow());
      await service.create('host-1', {});
      const data = prisma.tempChat.create.mock.calls[0][0].data;
      expect(data.maxMembers).toBe(50);
      const ms = new Date(data.expiresAt).getTime() - Date.now();
      expect(ms).toBeGreaterThan(4319 * 60 * 1000);
      expect(ms).toBeLessThan(4321 * 60 * 1000);
    });
  });

  describe('getByToken', () => {
    it('returns room meta for an active room', async () => {
      linkToken.verify.mockReturnValue({ tcId: 'tc-1' });
      prisma.tempChat.findUnique.mockResolvedValue(buildRow());
      prisma.tempChatGuest.count.mockResolvedValue(7);
      const meta = await service.getByToken('signed-token');
      expect(meta).toMatchObject({ title: '临时聊天', memberCount: 7, maxMembers: 50, full: false });
    });

    it('throws Gone when room already ended', async () => {
      linkToken.verify.mockReturnValue({ tcId: 'tc-1' });
      prisma.tempChat.findUnique.mockResolvedValue(buildRow({ status: 'ENDED' }));
      prisma.tempChatGuest.count.mockResolvedValue(0);
      await expect(service.getByToken('signed-token')).rejects.toBeInstanceOf(GoneException);
    });
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/temp-chat/temp-chat.service.spec.ts
```
Expected: FAIL（找不到 `./temp-chat.service`）。

- [ ] **Step 3: 实现 service（含 create / getByToken，预留 join/end/teardown 在 Task 7）**

`circle_be/src/temp-chat/temp-chat.service.ts`:
```ts
import { GoneException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { OpenimService } from 'src/openim/openim.service';
import { LinkTokenService } from './link-token.service';
import { CreateTempChatDto } from './dto/create-temp-chat.dto';
import { newGroupId } from './temp-chat.ids';

export interface CreateTempChatResult {
  id: string;
  groupId: string;
  title: string;
  maxMembers: number;
  expiresAt: string;
  shareUrl: string;
}

export interface TempChatMeta {
  title: string;
  memberCount: number;
  maxMembers: number;
  status: string;
  expiresAt: string;
  full: boolean;
}

@Injectable()
export class TempChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openim: OpenimService,
    private readonly linkToken: LinkTokenService,
    private readonly config: ConfigService,
  ) {}

  async create(hostUserId: string, dto: CreateTempChatDto): Promise<CreateTempChatResult> {
    const title = (dto.title?.trim() || '临时聊天').slice(0, 30);
    const ttlMinutes =
      dto.ttlMinutes ?? this.config.get<number>('TEMP_CHAT_DEFAULT_TTL_MINUTES', 4320);
    const maxMembers = dto.maxMembers ?? this.config.get<number>('TEMP_CHAT_MAX_MEMBERS', 50);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    const groupId = newGroupId();
    // 先建群；落库失败要回滚群，避免 OpenIM 留孤儿群。
    await this.openim.createGroup(groupId, title, hostUserId, [hostUserId]);
    try {
      const row = await this.prisma.tempChat.create({
        data: { groupId, hostUserId, title, maxMembers, expiresAt },
      });
      const seconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      const token = this.linkToken.sign(row.id, seconds);
      const base = this.config.get<string>('TEMP_CHAT_WEB_BASE', '');
      return {
        id: row.id,
        groupId: row.groupId,
        title: row.title,
        maxMembers: row.maxMembers,
        expiresAt: row.expiresAt.toISOString(),
        shareUrl: `${base}/t/${token}`,
      };
    } catch (err) {
      await this.openim.dismissGroup(groupId).catch(() => undefined);
      throw err;
    }
  }

  async getByToken(token: string): Promise<TempChatMeta> {
    const { tcId } = this.linkToken.verify(token); // 抛错 → 调用方转 404
    const room = await this.prisma.tempChat.findUnique({ where: { id: tcId } });
    if (!room || room.status !== 'ACTIVE' || room.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('临时聊天已结束');
    }
    const memberCount = await this.prisma.tempChatGuest.count({ where: { tempChatId: tcId } });
    return {
      title: room.title,
      memberCount,
      maxMembers: room.maxMembers,
      status: room.status,
      expiresAt: room.expiresAt.toISOString(),
      full: memberCount >= room.maxMembers,
    };
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/temp-chat/temp-chat.service.spec.ts
```
Expected: PASS（create 3 + getByToken 2 = 5 passed）。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/circle_be
git add src/temp-chat/temp-chat.service.ts src/temp-chat/temp-chat.service.spec.ts
git commit -m "feat(temp-chat): service create + getByToken"
```

---

## Task 7: TempChatService —— join / end / teardown

**Files:**
- Modify: `circle_be/src/temp-chat/temp-chat.service.ts`
- Modify: `circle_be/src/temp-chat/temp-chat.service.spec.ts`

- [ ] **Step 1: 追加失败测试**

在 `temp-chat.service.spec.ts` 的最外层 `describe` 内追加：
```ts
  describe('join', () => {
    beforeEach(() => {
      linkToken.verify.mockReturnValue({ tcId: 'tc-1' });
      prisma.tempChat.findUnique.mockResolvedValue(buildRow());
      prisma.tempChatGuest.count.mockResolvedValue(3);
      prisma.tempChatGuest.create.mockResolvedValue({});
      openim.getUserToken.mockResolvedValue('guest-im-token');
    });

    it('mints a guest, adds to group, returns web im credentials', async () => {
      const res = await service.join('signed-token', { displayName: '小明' });
      expect(openim.registerUser).toHaveBeenCalledWith(expect.stringMatching(/^g/), '小明');
      expect(openim.addGroupMembers).toHaveBeenCalledWith('tmpABC', [expect.stringMatching(/^g/)]);
      expect(openim.getUserToken).toHaveBeenCalledWith(expect.stringMatching(/^g/), 5);
      expect(res).toMatchObject({
        imToken: 'guest-im-token',
        groupId: 'tmpABC',
        wsUrl: 'wss://im.example.com/ws',
        apiUrl: 'https://im.example.com',
      });
    });

    it('rejects when room is full', async () => {
      prisma.tempChatGuest.count.mockResolvedValue(50);
      await expect(service.join('signed-token', {})).rejects.toMatchObject({ status: 409 });
    });

    it('rejects when room expired', async () => {
      prisma.tempChat.findUnique.mockResolvedValue(
        buildRow({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.join('signed-token', {})).rejects.toMatchObject({ status: 410 });
    });

    it('compensates (deletes guest row) if OpenIM add fails', async () => {
      prisma.tempChatGuest.create.mockResolvedValue({ id: 'guest-1' });
      openim.addGroupMembers.mockRejectedValue(new Error('im down'));
      await expect(service.join('signed-token', {})).rejects.toBeDefined();
      expect(prisma.tempChatGuest.delete).toHaveBeenCalledWith({ where: { id: 'guest-1' } });
    });
  });

  describe('end', () => {
    it('only the host can end the room', async () => {
      prisma.tempChat.findUniqueOrThrow.mockResolvedValue(buildRow());
      await expect(service.end('someone-else', 'tc-1')).rejects.toMatchObject({ status: 403 });
    });

    it('host ends → dismiss group + status ENDED', async () => {
      prisma.tempChat.findUniqueOrThrow.mockResolvedValue(buildRow());
      prisma.tempChatGuest.findMany.mockResolvedValue([{ imUserId: 'gA' }]);
      prisma.tempChat.update.mockResolvedValue(buildRow({ status: 'ENDED' }));
      const res = await service.end('host-1', 'tc-1');
      expect(openim.dismissGroup).toHaveBeenCalledWith('tmpABC');
      expect(openim.forceLogout).toHaveBeenCalledWith('gA');
      expect(res.status).toBe('ENDED');
    });

    it('ending an already-ended room is idempotent (no dismiss)', async () => {
      prisma.tempChat.findUniqueOrThrow.mockResolvedValue(buildRow({ status: 'ENDED' }));
      const res = await service.end('host-1', 'tc-1');
      expect(openim.dismissGroup).not.toHaveBeenCalled();
      expect(res.status).toBe('ENDED');
    });
  });
```

- [ ] **Step 2: 运行，确认失败**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/temp-chat/temp-chat.service.spec.ts
```
Expected: FAIL（`service.join is not a function`）。

- [ ] **Step 3: 实现 join / end / teardown**

在 `TempChatService` 类内（`getByToken` 之后）追加，并在文件顶部 import 增加 `ConflictException`, `ForbiddenException`, `ServiceUnavailableException` 与 `newGuestId`、`JoinTempChatDto`、`TempChatStatus`：

顶部 import 调整：
```ts
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TempChatStatus } from 'src/generated/prisma';
import { JoinTempChatDto } from './dto/join-temp-chat.dto';
import { newGroupId, newGuestId } from './temp-chat.ids';
```

类内新增方法与类型：
```ts
  // 放在 interface 区
  // （文件顶部已有 CreateTempChatResult / TempChatMeta，这里再加一个）

  async join(
    token: string,
    dto: JoinTempChatDto,
  ): Promise<{
    imUserId: string;
    imToken: string;
    groupId: string;
    wsUrl: string;
    apiUrl: string;
    displayName: string;
  }> {
    const { tcId } = this.linkToken.verify(token);
    const displayName = (dto.displayName?.trim() || `访客${Math.floor(1000 + Math.random() * 9000)}`).slice(0, 20);
    const guestImId = newGuestId();

    // 原子占座：Serializable 事务内复查房间状态 + 人数后建 guest 行。
    const room = await this.prisma.tempChat.findUnique({ where: { id: tcId } });
    if (!room || room.status !== 'ACTIVE' || room.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('临时聊天已结束');
    }

    const guest = await this.prisma.$transaction(
      async (tx) => {
        const count = await tx.tempChatGuest.count({ where: { tempChatId: tcId } });
        if (count >= room.maxMembers) {
          throw new ConflictException('人数已满');
        }
        return tx.tempChatGuest.create({
          data: { tempChatId: tcId, imUserId: guestImId, displayName },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    try {
      await this.openim.registerUser(guestImId, displayName);
      await this.openim.addGroupMembers(room.groupId, [guestImId]);
      const imToken = await this.openim.getUserToken(guestImId, 5);
      return {
        imUserId: guestImId,
        imToken,
        groupId: room.groupId,
        wsUrl: this.config.get<string>('OPENIM_IM_WS_URL', ''),
        apiUrl: this.config.get<string>('OPENIM_IM_API_URL', ''),
        displayName,
      };
    } catch (err) {
      // 补偿：OpenIM 任一步失败，释放座位，让访客可重试。
      await this.prisma.tempChatGuest.delete({ where: { id: guest.id } }).catch(() => undefined);
      throw new ServiceUnavailableException('加入失败，请重试');
    }
  }

  async end(hostUserId: string, id: string): Promise<{ status: string }> {
    const room = await this.prisma.tempChat.findUniqueOrThrow({ where: { id } });
    if (room.hostUserId !== hostUserId) {
      throw new ForbiddenException('只有创建者可以结束');
    }
    if (room.status !== 'ACTIVE') {
      return { status: room.status };
    }
    await this.teardown(room, TempChatStatus.ENDED);
    return { status: TempChatStatus.ENDED };
  }

  /** 解散群 + 强制访客下线 + 落库状态。幂等：仅 ACTIVE 房调用。 */
  async teardown(
    room: { id: string; groupId: string },
    status: TempChatStatus,
  ): Promise<void> {
    await this.openim.dismissGroup(room.groupId).catch(() => undefined);
    const guests = await this.prisma.tempChatGuest.findMany({
      where: { tempChatId: room.id, cleanedUp: false },
      select: { imUserId: true },
    });
    for (const g of guests) {
      await this.openim.forceLogout(g.imUserId).catch(() => undefined);
    }
    await this.prisma.tempChatGuest.updateMany({
      where: { tempChatId: room.id },
      data: { cleanedUp: true },
    });
    await this.prisma.tempChat.update({
      where: { id: room.id },
      data: { status, endedAt: new Date() },
    });
  }
```

> 注：上面 teardown 用到 `prisma.tempChatGuest.updateMany`。在测试 mock 里给 `tempChatGuest` 补 `updateMany: jest.fn()`，并给 `tempChat.update` 已有 mock。若运行报缺方法，补齐 mock 即可。

- [ ] **Step 4: 给测试 mock 补 `updateMany`**

在 spec 顶部 prisma mock 的 `tempChatGuest` 里加一行：
```ts
    tempChatGuest: { create: jest.fn(), count: jest.fn(), delete: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
```

- [ ] **Step 5: 运行，确认通过**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/temp-chat/temp-chat.service.spec.ts
```
Expected: PASS（全部，含 join 4 + end 3）。

- [ ] **Step 6: Commit**

```bash
cd /Users/yiboding/projects/circle_be
git add src/temp-chat/temp-chat.service.ts src/temp-chat/temp-chat.service.spec.ts
git commit -m "feat(temp-chat): service join/end/teardown"
```

---

## Task 8: 清理定时任务（teardown 到期房）

**Files:**
- Create: `circle_be/src/temp-chat/temp-chat.cleanup.ts`
- Test: `circle_be/src/temp-chat/temp-chat.cleanup.spec.ts`

- [ ] **Step 1: 写失败测试**

`circle_be/src/temp-chat/temp-chat.cleanup.spec.ts`:
```ts
import { TempChatStatus } from 'src/generated/prisma';
import { TempChatCleanup } from './temp-chat.cleanup';

describe('TempChatCleanup', () => {
  const prisma = { tempChat: { findMany: jest.fn() } };
  const service = { teardown: jest.fn() };
  const job = new TempChatCleanup(prisma as any, service as any);

  beforeEach(() => jest.clearAllMocks());

  it('tears down every ACTIVE expired room', async () => {
    prisma.tempChat.findMany.mockResolvedValue([
      { id: 'a', groupId: 'tmpA' },
      { id: 'b', groupId: 'tmpB' },
    ]);
    await job.sweep();
    expect(service.teardown).toHaveBeenCalledTimes(2);
    expect(service.teardown).toHaveBeenCalledWith({ id: 'a', groupId: 'tmpA' }, TempChatStatus.EXPIRED);
  });

  it('one failing room does not block the others', async () => {
    prisma.tempChat.findMany.mockResolvedValue([
      { id: 'a', groupId: 'tmpA' },
      { id: 'b', groupId: 'tmpB' },
    ]);
    service.teardown.mockRejectedValueOnce(new Error('boom'));
    await job.sweep();
    expect(service.teardown).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/temp-chat/temp-chat.cleanup.spec.ts
```
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 实现**

`circle_be/src/temp-chat/temp-chat.cleanup.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TempChatStatus } from 'src/generated/prisma';
import { PrismaService } from 'src/prisma/prisma.service';
import { TempChatService } from './temp-chat.service';

@Injectable()
export class TempChatCleanup {
  private readonly logger = new Logger(TempChatCleanup.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: TempChatService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    const due = await this.prisma.tempChat.findMany({
      where: { status: TempChatStatus.ACTIVE, expiresAt: { lte: new Date() } },
      select: { id: true, groupId: true },
    });
    for (const room of due) {
      try {
        await this.service.teardown(room, TempChatStatus.EXPIRED);
      } catch (err) {
        this.logger.error(`teardown failed for ${room.id}: ${String(err)}`);
      }
    }
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/temp-chat/temp-chat.cleanup.spec.ts
```
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/circle_be
git add src/temp-chat/temp-chat.cleanup.ts src/temp-chat/temp-chat.cleanup.spec.ts
git commit -m "feat(temp-chat): cleanup cron job"
```

---

## Task 9: Controller + Module + 全局装配

**Files:**
- Create: `circle_be/src/temp-chat/temp-chat.controller.ts`
- Create: `circle_be/src/temp-chat/temp-chat.module.ts`
- Modify: `circle_be/src/app.module.ts`

- [ ] **Step 1: 写 controller**

`circle_be/src/temp-chat/temp-chat.controller.ts`:
```ts
import {
  Body, Controller, HttpCode, HttpStatus, NotFoundException, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtGuard } from 'src/guards/jwt.guard';
import { CreateTempChatDto } from './dto/create-temp-chat.dto';
import { JoinTempChatDto } from './dto/join-temp-chat.dto';
import { TempChatService } from './temp-chat.service';

@ApiTags('Temp Chat')
@Controller('temp-chat')
export class TempChatController {
  constructor(private readonly service: TempChatService) {}

  @Post()
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建临时聊天（发起人）' })
  create(@Req() req: any, @Body() dto: CreateTempChatDto) {
    return this.service.create(req.user.userId, dto);
  }

  // 公开端点：靠 link JWT + 限流保护。token 非法 → 404。
  @Post('by-token/:token/meta')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: '落地页：获取房间元信息' })
  async meta(@Param('token') token: string) {
    try {
      return await this.service.getByToken(token);
    } catch (err: any) {
      if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
        throw new NotFoundException('链接无效');
      }
      throw err;
    }
  }

  @Post('by-token/:token/join')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '访客免注册加入' })
  async join(@Param('token') token: string, @Body() dto: JoinTempChatDto) {
    try {
      return await this.service.join(token, dto);
    } catch (err: any) {
      if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
        throw new NotFoundException('链接无效');
      }
      throw err;
    }
  }

  @Post(':id/end')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发起人手动结束' })
  end(@Req() req: any, @Param('id') id: string) {
    return this.service.end(req.user.userId, id);
  }
}
```

> 用 `POST .../meta` 而非 GET，是为了让 `@Throttle` 与含 token 的 body-less 公开端点统一走 POST，避免把 token 暴露在 GET query 日志里（token 放路径，仍建议落地页改用 header/body 传递可在 web 计划里优化）。
>
> ⚠️ **限流前置依赖：** `@Throttle` 只有在全局注册了 `ThrottlerGuard` 时才生效。实现前先 `grep -rn "ThrottlerModule\|ThrottlerGuard\|APP_GUARD" src/app.module.ts`：若已有 `ThrottlerModule.forRoot()` + `{ provide: APP_GUARD, useClass: ThrottlerGuard }` 则直接用；若没有，在本 Task 顺带在 `app.module.ts` 注册（`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` + `APP_GUARD`），否则限流静默失效。

- [ ] **Step 2: 写 module**

`circle_be/src/temp-chat/temp-chat.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { OpenimModule } from 'src/openim/openim.module';
import { LinkTokenService } from './link-token.service';
import { TempChatCleanup } from './temp-chat.cleanup';
import { TempChatController } from './temp-chat.controller';
import { TempChatService } from './temp-chat.service';

@Module({
  imports: [
    OpenimModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('TEMP_CHAT_LINK_SECRET'),
      }),
    }),
  ],
  controllers: [TempChatController],
  providers: [TempChatService, LinkTokenService, TempChatCleanup],
  exports: [TempChatService],
})
export class TempChatModule {}
```

> 这里的 `JwtModule` 是模块作用域的，注入给 `LinkTokenService` 的 `JwtService` 用 `TEMP_CHAT_LINK_SECRET`，与全局业务 JWT 隔离。`PrismaService` 假设为全局模块（沿用现有 `ConversationGroupModule` 不显式 import 的写法）；若不是全局，则在 imports 里加 `PrismaModule`。

- [ ] **Step 3: 在 app.module.ts 注册 ScheduleModule + TempChatModule**

在 `circle_be/src/app.module.ts` 的 `imports` 数组加入（并在文件顶部 import）：
```ts
import { ScheduleModule } from '@nestjs/schedule';
import { TempChatModule } from './temp-chat/temp-chat.module';
// ...
@Module({
  imports: [
    // ...existing...
    ScheduleModule.forRoot(),
    TempChatModule,
  ],
})
```

- [ ] **Step 4: 构建校验**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npm run build
```
Expected: 构建通过，无类型错误。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/circle_be
git add src/temp-chat/temp-chat.controller.ts src/temp-chat/temp-chat.module.ts src/app.module.ts
git commit -m "feat(temp-chat): controller, module, app wiring"
```

---

## Task 10: 配置项与全量验证

**Files:**
- Modify: `circle_be/.env`（及 `.env.example` 如有）

- [ ] **Step 1: 增加配置项**

在 `circle_be/.env`（和示例文件）加入：
```
TEMP_CHAT_WEB_BASE=https://chat.example.com
TEMP_CHAT_LINK_SECRET=<32+ 随机字符串>
TEMP_CHAT_DEFAULT_TTL_MINUTES=4320
TEMP_CHAT_MAX_TTL_MINUTES=10080
TEMP_CHAT_MAX_MEMBERS=50
OPENIM_IM_WS_URL=wss://im.example.com/ws
OPENIM_IM_API_URL=https://im.example.com
```

> `TEMP_CHAT_LINK_SECRET` 走密钥管理，勿提交真实值。

- [ ] **Step 2: 跑临时聊天相关测试**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npx jest src/temp-chat src/openim
```
Expected: 全绿。

- [ ] **Step 3: 跑全量测试 + 构建**

Run:
```bash
cd /Users/yiboding/projects/circle_be && npm test && npm run build
```
Expected: 既有测试不被破坏，构建通过。

- [ ] **Step 4: Commit**

```bash
cd /Users/yiboding/projects/circle_be
git add .env.example
git commit -m "chore(temp-chat): add env config keys"
```

---

## 后续计划（本计划之外，单独成文）

1. **`temp-chat-web`**：Vite + React + `@openim/client-sdk` 访客聊天页（落地页 / 进房 / 收发 / 倒计时 / onGroupDismissed 提示）。
2. **App 端（circle-im）**：发起人「创建临时聊天」表单（标题/有效期/人数）+ 分享 + 「我的临时聊天」列表。

两者都依赖本后端 API 落地后再开工。

---

## 自查（spec 覆盖）

- 创建可编辑标题/有效期/人数 + 默认 3 天/50 人 + 上下限：Task 5（DTO）+ Task 6（默认值）✓
- 多人临时群 + admin 直接拉访客进群：Task 6/7（createGroup / addGroupMembers）✓
- 免注册访客静默建号 + Web token：Task 7（registerUser + getUserToken platformID=5）✓
- 分享链接可过期签名：Task 4 + Task 6 ✓
- 有效期自动销毁 + 手动结束 + 销毁即清：Task 7（end/teardown）+ Task 8（cron）+ dismissGroup ✓
- 人数封顶并发安全：Task 7（Serializable 事务占座）✓
- 限流防滥用：Task 9（@Throttle）✓
- OpenIM 服务扩展：Task 3 ✓
- 配置项：Task 10 ✓
- 未覆盖（有意，另立计划）：Web 页、App UI、force_logout 路径与访客硬删的运维确认（spec §16 已标注）
