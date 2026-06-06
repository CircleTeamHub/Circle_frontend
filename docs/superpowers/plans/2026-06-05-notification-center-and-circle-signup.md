# 通知中心 + 圈子帖子报名 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从消息页铃铛进入「消息通知」中心（两栏：互动消息=Notification 表、圈子动态=CircleActivity 表），并新增「圈子帖子报名」功能为圈子动态供数。

**Architecture:** 报名事件复用现有 `CircleActivity` 表（加两个枚举值 + 可空 `postID`），与现有圈子事件天然同一 feed 混排。互动消息为 `Notification` 表补 list/read/read-all/delete 接口。前端新增 `src/features/notifications/` feature + 路由，铃铛改向并以「互动未读 + 圈子未读」驱动角标。帖子卡片底部「浏览数」改为「报名数」按钮。

**Tech Stack:** circle_be = NestJS + Prisma + Jest（mocked prisma）；circle-im = Expo Router + React Native + Zustand + react-i18next；前端测试 = `node:test` + `typescript` transpile + `vm`（见 `test/temp-chat.api.test.js`）。

**两个仓库路径：**
- 前端 circle-im：`/Users/yiboding/projects/circle-im`
- 后端 circle_be：`/Users/yiboding/projects/circle_be`

**命名澄清（贯穿全程，勿混）：** 朋友圈=`Trace`(→互动消息)；圈子=`Circle`(→圈子动态)；圈子帖子=`CirclePost`(本期加报名)。

---

## File Structure

**circle_be**
- `prisma/schema.prisma` — 改：`CircleActivityType` 加枚举、`CircleActivity` 加 `postID`、`CirclePost` 加 `signupCount`/`signups`、`User` 加反向关系；新：`CirclePostSignup`。
- `src/circle-plaza/circle-plaza.module.ts` — 改：import `RealtimeModule`。
- `src/circle-plaza/circle-plaza.service.ts` — 改：注入 `RealtimeService`；加 `signupForPost`/`cancelSignup`/`getPostSignups`；DTO 加 `signupCount`/`signedByMe`。
- `src/circle-plaza/dto/circle-plaza.dto.ts` — 改：`PlazaPostDto` 加两字段。
- `src/circle-plaza/circle-plaza.controller.ts` — 改：加 3 个报名路由。
- `src/circle-plaza/circle-plaza.service.spec.ts` — 改：修构造函数 + 加报名测试。
- `src/circle/circle.service.ts` — 改：`getActivities` 带 post 摘要；加 `markAllActivitiesRead`。
- `src/circle/circle.controller.ts` — 改：加 `POST activities/read-all`。
- `src/circle/circle.service.spec.ts` — 改：加 read-all + post 摘要测试。
- `src/notification/notification.service.ts` — 改：加 list/read/read-all/delete。
- `src/notification/notification.controller.ts` — 改：加 4 个路由。
- `src/notification/notification.service.spec.ts` — 新：service 测试。

**circle-im**
- `src/types/index.ts` — 改：加 `NotificationItem`、`NotificationType`、`NotificationListResponse`；`CirclePlazaPost` 加 `signupCount`/`signedByMe`。
- `src/services/api/notifications.ts` — 改：加 list/read/read-all/delete。
- `src/services/api/circles.ts` — 改：加 `markAllCircleActivitiesRead`。
- `src/services/api/plaza.ts` — 改：加 `signupForPost`/`cancelSignup`。
- `src/features/notifications/utils/notification-summary.ts` — 新：Notification→{icon,summary}。
- `src/features/notifications/utils/circle-activity-summary.ts` — 新：CircleActivity→{icon,summary}。
- `src/features/notifications/components/NotificationTabBar.tsx` — 新。
- `src/features/notifications/components/ReadFilterBar.tsx` — 新。
- `src/features/notifications/components/NotificationRow.tsx` — 新（共用头像行视觉）。
- `src/features/notifications/components/NotificationEmptyState.tsx` — 新。
- `src/features/notifications/store/use-notification-center-store.ts` — 新：zustand。
- `src/features/notifications/screens/NotificationCenterScreen.tsx` — 新。
- `app/(tabs)/messages/notifications.tsx` — 新路由。
- `src/features/messages/screens/MessagesScreen.tsx` — 改：铃铛 onPress + 角标。
- `src/features/discover/components/plaza-post-card.tsx` — 改：浏览数→报名数按钮。
- `src/i18n/locales/zh.json` / `en.json` — 改：加 `notifications` namespace。
- `test/*.test.js` — 新：API client / 适配器 / store 逻辑测试。

---

# Phase 1 — 报名后端（circle_be）

> 工作目录：`/Users/yiboding/projects/circle_be`。命令前缀假设已在该目录。

## Task 1.1: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 给 `CircleActivityType` 枚举加两个值**

定位 `enum CircleActivityType {`（约 line 161），改为：

```prisma
enum CircleActivityType {
  VERIFICATION_REQUESTED
  VERIFICATION_APPROVED
  VERIFICATION_REJECTED
  INVITATION_ALL_APPROVED
  INVITATION_SLOT_REJECTED
  ADMIN_OVERRIDE_APPROVED
  POST_SIGNUP_RECEIVED
  POST_SIGNUP_CONFIRMED
}
```

- [ ] **Step 2: `CircleActivity` 加 `postID` + 关系**

定位 `model CircleActivity {`（约 line 1243）。在 `invitationID String?` 下加 `postID String?`，并在关系区加 `post` 关系：

```prisma
model CircleActivity {
  id           String             @id @default(uuid())
  circleID     String
  invitationID String?
  postID       String?
  viewerID     String
  actorID      String
  type         CircleActivityType
  readAt       DateTime?
  createdAt    DateTime           @default(now())

  circle     Circle            @relation(fields: [circleID], references: [id], onDelete: Cascade)
  invitation CircleInvitation? @relation(fields: [invitationID], references: [id], onDelete: SetNull)
  post       CirclePost?       @relation(fields: [postID], references: [id], onDelete: SetNull)
  viewer     User              @relation("circleActivityViewer", fields: [viewerID], references: [id], onDelete: Cascade)
  actor      User              @relation("circleActivityActor", fields: [actorID], references: [id], onDelete: Cascade)

  @@index([viewerID, readAt])
  @@index([invitationID])
}
```

- [ ] **Step 3: `CirclePost` 加 `signupCount` + 两个反向关系**

定位 `model CirclePost {`（约 line 1179）。在 `viewCount Int @default(0)` 下加 `signupCount Int @default(0)`，并在关系区加 `signups` 与 `activities`（CircleActivity.post 的反向）：

```prisma
  viewCount         Int              @default(0)
  signupCount       Int              @default(0)
  status            CirclePostStatus @default(ACTIVE)
  authorID          String
  circleID          String
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  author     User               @relation(fields: [authorID], references: [id], onDelete: Cascade)
  circle     Circle             @relation(fields: [circleID], references: [id], onDelete: Cascade)
  signups    CirclePostSignup[]
  activities CircleActivity[]
```

- [ ] **Step 4: 新增 `CirclePostSignup` 模型（放在 `CirclePost` 模型之后）**

```prisma
model CirclePostSignup {
  id        String   @id @default(uuid())
  postID    String
  userID    String
  createdAt DateTime @default(now())

  post CirclePost @relation(fields: [postID], references: [id], onDelete: Cascade)
  user User       @relation(fields: [userID], references: [id], onDelete: Cascade)

  @@unique([postID, userID])
  @@index([postID])
  @@index([userID])
}
```

- [ ] **Step 5: `User` 模型加反向关系**

定位 `model User {` 的关系区（约 line 270-303），在 `collections` 一行附近加：

```prisma
  circlePostSignups            CirclePostSignup[]
```

- [ ] **Step 6: 生成迁移 + client**

Run:
```bash
npx prisma migrate dev --name circle_post_signup
```
Expected: 新建 migration 文件，`prisma generate` 自动跑通，无报错。若无 DB 连接，退化为：
```bash
npx prisma migrate dev --create-only --name circle_post_signup && npx prisma generate
```

- [ ] **Step 7: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无与 schema 相关的新错误（已有错误忽略）。

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add CirclePostSignup model and signup CircleActivity types"
```

---

## Task 1.2: 给 CirclePlazaService 注入 RealtimeService

**Files:**
- Modify: `src/circle-plaza/circle-plaza.module.ts`
- Modify: `src/circle-plaza/circle-plaza.service.ts:15-24`
- Modify: `src/circle-plaza/circle-plaza.service.spec.ts`

- [ ] **Step 1: module 引入 RealtimeModule**

`src/circle-plaza/circle-plaza.module.ts` 改为：

```ts
import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { CirclePlazaController } from './circle-plaza.controller';
import { CirclePlazaService } from './circle-plaza.service';

@Module({
  imports: [RealtimeModule],
  controllers: [CirclePlazaController],
  providers: [CirclePlazaService],
})
export class CirclePlazaModule {}
```

- [ ] **Step 2: service 构造函数注入 RealtimeService**

`src/circle-plaza/circle-plaza.service.ts` 顶部 import 加：

```ts
import { RealtimeService } from 'src/realtime/realtime.service';
```

构造函数改为：

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
  ) {
    this.minioPublicUrl = this.config.get<string>('MINIO_PUBLIC_URL') ?? null;
  }
```

- [ ] **Step 3: 修已有 spec 的构造与 provider**

`src/circle-plaza/circle-plaza.service.spec.ts`：

(a) `prisma` mock 对象里补全新表（在现有 mock 内加）：
```ts
    circlePostSignup: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    circleActivity: {
      create: jest.fn(),
    },
```
并把 `circlePost` mock 补 `findUnique: jest.fn()`。

(b) 顶部加一个 realtime mock：
```ts
  const realtime = {
    broadcastCircleUnreadCount: jest.fn(),
  };
```

(c) `Test.createTestingModule` 的 providers 加：
```ts
        { provide: RealtimeService, useValue: realtime },
```
并 import：`import { RealtimeService } from 'src/realtime/realtime.service';`

(d) 找到直接 `new CirclePlazaService(prisma as any, { get: ... } as any)` 那个测试（约 line 66），补第三个参数：
```ts
    const guarded = new CirclePlazaService(
      prisma as any,
      { get: jest.fn(() => 'http://10.0.0.195:9000') } as any,
      realtime as any,
    );
```

- [ ] **Step 4: 跑现有 spec 确认没破**

Run: `npx jest src/circle-plaza/circle-plaza.service.spec.ts`
Expected: PASS（全部已有用例通过）。

- [ ] **Step 5: Commit**

```bash
git add src/circle-plaza/circle-plaza.module.ts src/circle-plaza/circle-plaza.service.ts src/circle-plaza/circle-plaza.service.spec.ts
git commit -m "refactor: inject RealtimeService into CirclePlazaService"
```

---

## Task 1.3: `signupForPost` service 方法

**Files:**
- Modify: `src/circle-plaza/circle-plaza.service.ts`
- Test: `src/circle-plaza/circle-plaza.service.spec.ts`

- [ ] **Step 1: 写失败测试**

在 spec 末尾（最后一个 `});` 之前的 describe 内）加：

```ts
  describe('signupForPost', () => {
    const activePost = {
      id: 'post-1',
      authorID: 'author-1',
      circleID: 'circle-1',
      content: 'hi',
    };

    it('creates signup, increments count, and emits two activities', async () => {
      prisma.circlePost.findFirst.mockResolvedValue(activePost);
      prisma.circlePostSignup.findUnique.mockResolvedValue(null);
      prisma.circlePostSignup.create.mockResolvedValue({ id: 's-1' });
      prisma.circlePost.update.mockResolvedValue({ signupCount: 3 });
      prisma.circleActivity.create.mockResolvedValue({});

      const result = await service.signupForPost('user-2', 'post-1');

      expect(result).toEqual({ signed: true, signupCount: 3 });
      expect(prisma.circleActivity.create).toHaveBeenCalledTimes(2);
      expect(realtime.broadcastCircleUnreadCount).toHaveBeenCalledWith('user-2');
      expect(realtime.broadcastCircleUnreadCount).toHaveBeenCalledWith('author-1');
    });

    it('is idempotent when already signed up', async () => {
      prisma.circlePost.findFirst.mockResolvedValue(activePost);
      prisma.circlePostSignup.findUnique.mockResolvedValue({ id: 's-1' });
      prisma.circlePost.findUnique.mockResolvedValue({ signupCount: 5 });

      const result = await service.signupForPost('user-2', 'post-1');

      expect(result).toEqual({ signed: true, signupCount: 5 });
      expect(prisma.circlePostSignup.create).not.toHaveBeenCalled();
      expect(prisma.circleActivity.create).not.toHaveBeenCalled();
    });

    it('emits only CONFIRMED when author signs up to own post', async () => {
      prisma.circlePost.findFirst.mockResolvedValue(activePost);
      prisma.circlePostSignup.findUnique.mockResolvedValue(null);
      prisma.circlePostSignup.create.mockResolvedValue({ id: 's-1' });
      prisma.circlePost.update.mockResolvedValue({ signupCount: 1 });
      prisma.circleActivity.create.mockResolvedValue({});

      await service.signupForPost('author-1', 'post-1');

      expect(prisma.circleActivity.create).toHaveBeenCalledTimes(1);
      expect(prisma.circleActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'POST_SIGNUP_CONFIRMED' }),
        }),
      );
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/circle-plaza/circle-plaza.service.spec.ts -t signupForPost`
Expected: FAIL（`service.signupForPost is not a function`）。

- [ ] **Step 3: 实现 `signupForPost`**

在 `deletePost` 方法之后加：

```ts
  async signupForPost(
    userId: string,
    postId: string,
  ): Promise<{ signed: boolean; signupCount: number }> {
    const post = await this.prisma.circlePost.findFirst({
      where: { id: postId, status: 'ACTIVE', circle: { deleted: false } },
      select: { id: true, authorID: true, circleID: true, content: true },
    });
    if (!post) throw new NotFoundException('Post not found');

    const existing = await this.prisma.circlePostSignup.findUnique({
      where: { postID_userID: { postID: postId, userID: userId } },
      select: { id: true },
    });
    if (existing) {
      const current = await this.prisma.circlePost.findUnique({
        where: { id: postId },
        select: { signupCount: true },
      });
      return { signed: true, signupCount: current?.signupCount ?? 0 };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.circlePostSignup.create({
        data: { postID: postId, userID: userId },
      });
      const p = await tx.circlePost.update({
        where: { id: postId },
        data: { signupCount: { increment: 1 } },
        select: { signupCount: true },
      });
      await tx.circleActivity.create({
        data: {
          circleID: post.circleID,
          postID: postId,
          viewerID: userId,
          actorID: userId,
          type: 'POST_SIGNUP_CONFIRMED',
        },
      });
      if (post.authorID !== userId) {
        await tx.circleActivity.create({
          data: {
            circleID: post.circleID,
            postID: postId,
            viewerID: post.authorID,
            actorID: userId,
            type: 'POST_SIGNUP_RECEIVED',
          },
        });
      }
      return p;
    });

    await this.realtime.broadcastCircleUnreadCount(userId);
    if (post.authorID !== userId) {
      await this.realtime.broadcastCircleUnreadCount(post.authorID);
    }
    return { signed: true, signupCount: updated.signupCount };
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/circle-plaza/circle-plaza.service.spec.ts -t signupForPost`
Expected: PASS（3 用例）。

- [ ] **Step 5: Commit**

```bash
git add src/circle-plaza/circle-plaza.service.ts src/circle-plaza/circle-plaza.service.spec.ts
git commit -m "feat: signupForPost with idempotency and circle activities"
```

---

## Task 1.4: `cancelSignup` + `getPostSignups`

**Files:**
- Modify: `src/circle-plaza/circle-plaza.service.ts`
- Test: `src/circle-plaza/circle-plaza.service.spec.ts`

- [ ] **Step 1: 写失败测试**

在 signupForPost 的 describe 之后加：

```ts
  describe('cancelSignup', () => {
    it('removes signup and decrements count', async () => {
      prisma.circlePostSignup.findUnique.mockResolvedValue({ id: 's-1' });
      prisma.circlePostSignup.delete.mockResolvedValue({});
      prisma.circlePost.update.mockResolvedValue({ signupCount: 2 });

      const result = await service.cancelSignup('user-2', 'post-1');

      expect(result).toEqual({ signed: false, signupCount: 2 });
    });

    it('is a no-op when not signed up', async () => {
      prisma.circlePostSignup.findUnique.mockResolvedValue(null);
      prisma.circlePost.findUnique.mockResolvedValue({ signupCount: 4 });

      const result = await service.cancelSignup('user-2', 'post-1');

      expect(result).toEqual({ signed: false, signupCount: 4 });
      expect(prisma.circlePostSignup.delete).not.toHaveBeenCalled();
    });
  });

  describe('getPostSignups', () => {
    it('maps signups to public user shape', async () => {
      prisma.circlePostSignup.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-06-05T00:00:00Z'),
          user: { id: 'u1', nickname: 'A', avatarUrl: null, accountId: '100' },
        },
      ]);

      const result = await service.getPostSignups('post-1');

      expect(result.items).toEqual([
        {
          id: 'u1',
          nickname: 'A',
          avatarUrl: null,
          accountId: '100',
          signedAt: '2026-06-05T00:00:00.000Z',
        },
      ]);
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/circle-plaza/circle-plaza.service.spec.ts -t 'cancelSignup|getPostSignups'`
Expected: FAIL。

- [ ] **Step 3: 实现两个方法**

在 `signupForPost` 之后加：

```ts
  async cancelSignup(
    userId: string,
    postId: string,
  ): Promise<{ signed: boolean; signupCount: number }> {
    const existing = await this.prisma.circlePostSignup.findUnique({
      where: { postID_userID: { postID: postId, userID: userId } },
      select: { id: true },
    });
    if (!existing) {
      const current = await this.prisma.circlePost.findUnique({
        where: { id: postId },
        select: { signupCount: true },
      });
      return { signed: false, signupCount: current?.signupCount ?? 0 };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.circlePostSignup.delete({
        where: { postID_userID: { postID: postId, userID: userId } },
      });
      return tx.circlePost.update({
        where: { id: postId },
        data: { signupCount: { decrement: 1 } },
        select: { signupCount: true },
      });
    });

    return { signed: false, signupCount: Math.max(0, updated.signupCount) };
  }

  async getPostSignups(postId: string): Promise<{
    items: {
      id: string;
      nickname: string;
      avatarUrl: string | null;
      accountId: string;
      signedAt: string;
    }[];
  }> {
    const signups = await this.prisma.circlePostSignup.findMany({
      where: { postID: postId },
      include: {
        user: {
          select: { id: true, nickname: true, avatarUrl: true, accountId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      items: signups.map((s) => ({
        id: s.user.id,
        nickname: s.user.nickname,
        avatarUrl: s.user.avatarUrl,
        accountId: s.user.accountId,
        signedAt: s.createdAt.toISOString(),
      })),
    };
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/circle-plaza/circle-plaza.service.spec.ts -t 'cancelSignup|getPostSignups'`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/circle-plaza/circle-plaza.service.ts src/circle-plaza/circle-plaza.service.spec.ts
git commit -m "feat: cancelSignup and getPostSignups"
```

---

## Task 1.5: DTO 加 `signupCount` / `signedByMe`

**Files:**
- Modify: `src/circle-plaza/dto/circle-plaza.dto.ts:129-147`
- Modify: `src/circle-plaza/circle-plaza.service.ts`（`toPlazaPostDto` / `getFeed` / `getPost` / `createPost`）
- Test: `src/circle-plaza/circle-plaza.service.spec.ts`

- [ ] **Step 1: DTO 加字段**

`PlazaPostDto` 在 `viewCount: number;` 下加：

```ts
  viewCount: number;
  signupCount: number;
  signedByMe: boolean;
```

- [ ] **Step 2: 写失败测试（getPost 带 signedByMe）**

在 spec 加：

```ts
  describe('signedByMe in DTO', () => {
    it('getPost returns signedByMe=true when viewer has signed up', async () => {
      prisma.circlePost.findFirst.mockResolvedValue({
        id: 'post-1',
        content: 'x',
        images: [],
        tags: [],
        city: null,
        isHorn: false,
        noteID: null,
        vipRestriction: null,
        creditRestriction: null,
        fancyRestriction: false,
        viewCount: 0,
        signupCount: 2,
        createdAt: new Date('2026-06-05T00:00:00Z'),
        author: { id: 'a', nickname: 'A', avatarUrl: null, avatarFrame: null, accountId: '1' },
        circle: { id: 'c', name: 'C' },
      });
      prisma.user.findUnique.mockResolvedValue({ vipLevel: 0, creditScore: 100, fancyNumber: false });
      prisma.circlePostSignup.findUnique.mockResolvedValue({ id: 's-1' });

      const dto = await service.getPost('viewer-1', 'post-1');

      expect(dto.signupCount).toBe(2);
      expect(dto.signedByMe).toBe(true);
    });
  });
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx jest src/circle-plaza/circle-plaza.service.spec.ts -t signedByMe`
Expected: FAIL（`signedByMe` 为 undefined）。

- [ ] **Step 4: 改 `toPlazaPostDto` 签名 + 三个调用点**

`toPlazaPostDto` 改签名并补两字段：

```ts
  private toPlazaPostDto(
    post: any,
    canInteract: boolean,
    signedByMe: boolean,
  ): PlazaPostDto {
    return {
      id: post.id,
      content: post.content,
      images: post.images,
      tags: post.tags,
      city: post.city,
      isHorn: post.isHorn,
      noteId: post.noteID,
      restrictions: {
        vipLevel: post.vipRestriction,
        creditScore: post.creditRestriction,
        fancyNumber: post.fancyRestriction,
      },
      viewCount: post.viewCount,
      signupCount: post.signupCount ?? 0,
      signedByMe,
      author: {
        id: post.author.id,
        nickname: post.author.nickname,
        avatarUrl: post.author.avatarUrl,
        avatarFrame: post.author.avatarFrame,
        accountId: post.author.accountId,
      },
      circle: { id: post.circle.id, name: post.circle.name },
      canInteract,
      createdAt: post.createdAt.toISOString(),
    };
  }
```

`createPost` 末尾：`return this.toPlazaPostDto(post, true, false);`（新帖默认未报名）。

`getPost` 末尾改为：

```ts
    if (!post) throw new NotFoundException('Post not found');

    const signed = await this.prisma.circlePostSignup.findUnique({
      where: { postID_userID: { postID: postId, userID: viewerId } },
      select: { id: true },
    });

    return this.toPlazaPostDto(
      post,
      this.checkCanInteract(post, viewer),
      Boolean(signed),
    );
```

`getFeed` 的 `items` 计算改为：先批量查 viewer 在本页帖子的报名：

```ts
    const postIds = posts.map((p) => p.id);
    const mySignups = postIds.length
      ? await this.prisma.circlePostSignup.findMany({
          where: { userID: viewerId, postID: { in: postIds } },
          select: { postID: true },
        })
      : [];
    const signedSet = new Set(mySignups.map((s) => s.postID));

    const items = posts.map((post) =>
      this.toPlazaPostDto(
        post,
        this.checkCanInteract(post, viewer),
        signedSet.has(post.id),
      ),
    );
```

- [ ] **Step 5: 跑测试确认通过 + 全 spec 回归**

Run: `npx jest src/circle-plaza/circle-plaza.service.spec.ts`
Expected: PASS（含 signedByMe 与原有用例；若原有 getFeed 用例 mock 未含 `circlePostSignup.findMany`，给它补 `prisma.circlePostSignup.findMany.mockResolvedValue([])`）。

- [ ] **Step 6: Commit**

```bash
git add src/circle-plaza/dto/circle-plaza.dto.ts src/circle-plaza/circle-plaza.service.ts src/circle-plaza/circle-plaza.service.spec.ts
git commit -m "feat: expose signupCount and signedByMe on plaza post DTO"
```

---

## Task 1.6: 报名 controller 路由

**Files:**
- Modify: `src/circle-plaza/circle-plaza.controller.ts`

- [ ] **Step 1: 加 3 个路由**

在 `deletePost` 方法之后、类结束 `}` 之前加：

```ts
  @Post('posts/:id/signup')
  @ApiOperation({ summary: 'Sign up for a post' })
  signup(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ): Promise<{ signed: boolean; signupCount: number }> {
    return this.plazaService.signupForPost(req.user.userId, id);
  }

  @Delete('posts/:id/signup')
  @ApiOperation({ summary: 'Cancel signup for a post' })
  cancelSignup(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ): Promise<{ signed: boolean; signupCount: number }> {
    return this.plazaService.cancelSignup(req.user.userId, id);
  }

  @Get('posts/:id/signups')
  @ApiOperation({ summary: 'List users who signed up for a post' })
  signups(@Param('id', ParseUUIDPipe) id: string) {
    return this.plazaService.getPostSignups(id);
  }
```

（`Post`/`Delete`/`Get`/`Param`/`ParseUUIDPipe`/`Req` 已 import；无需新增。）

- [ ] **Step 2: 类型检查 + 启动校验**

Run: `npx tsc --noEmit`
Expected: 无新错误。

- [ ] **Step 3: Commit**

```bash
git add src/circle-plaza/circle-plaza.controller.ts
git commit -m "feat: add circle post signup endpoints"
```

---

# Phase 2 — 通知中心后端（circle_be）

## Task 2.1: 圈子动态 DTO 带 post 摘要 + 全部已读

**Files:**
- Modify: `src/circle/circle.service.ts:511-560`
- Modify: `src/circle/circle.controller.ts`
- Test: `src/circle/circle.service.spec.ts`

- [ ] **Step 1: 写失败测试**

`src/circle/circle.service.spec.ts` 中（沿用该文件已有的 prisma/realtime mock 风格；若无 `circleActivity.updateMany` mock 则补上）加：

```ts
  describe('markAllActivitiesRead', () => {
    it('marks all unread as read and broadcasts when count > 0', async () => {
      prisma.circleActivity.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAllActivitiesRead('user-1');

      expect(result).toEqual({ count: 3 });
      expect(prisma.circleActivity.updateMany).toHaveBeenCalledWith({
        where: { viewerID: 'user-1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
      expect(realtime.broadcastCircleUnreadCount).toHaveBeenCalledWith('user-1');
    });

    it('does not broadcast when nothing changed', async () => {
      prisma.circleActivity.updateMany.mockResolvedValue({ count: 0 });
      await service.markAllActivitiesRead('user-1');
      expect(realtime.broadcastCircleUnreadCount).not.toHaveBeenCalled();
    });
  });

  describe('getActivities post excerpt', () => {
    it('includes post excerpt for signup activities', async () => {
      prisma.circleActivity.findMany.mockResolvedValue([
        {
          id: 'a1',
          type: 'POST_SIGNUP_RECEIVED',
          invitationID: null,
          readAt: null,
          createdAt: new Date('2026-06-05T00:00:00Z'),
          circle: { id: 'c1', name: 'C' },
          actor: { id: 'u2', nickname: 'B', avatarUrl: null, accountId: '2' },
          post: { id: 'p1', content: 'Hiking this weekend, who is in?' },
        },
      ]);

      const result = await service.getActivities('user-1');

      expect(result[0].post).toEqual({
        id: 'p1',
        excerpt: 'Hiking this weekend, who is in?',
      });
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/circle/circle.service.spec.ts -t 'markAllActivitiesRead|post excerpt'`
Expected: FAIL。

- [ ] **Step 3: getActivities 加 post include + 映射；新增 markAllActivitiesRead**

`getActivities` 的 `include` 加 `post`：

```ts
      include: {
        circle: { select: { id: true, name: true } },
        post: { select: { id: true, content: true } },
        actor: {
          select: { id: true, nickname: true, avatarUrl: true, accountId: true },
        },
      },
```

`map` 返回对象加 `post`：

```ts
      readAt: a.readAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      post: a.post
        ? { id: a.post.id, excerpt: a.post.content.slice(0, 60) }
        : null,
```

在 `markActivityRead` 之后加：

```ts
  async markAllActivitiesRead(userId: string): Promise<{ count: number }> {
    const result = await this.prisma.circleActivity.updateMany({
      where: { viewerID: userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count > 0) {
      await this.realtimeService.broadcastCircleUnreadCount(userId);
    }
    return { count: result.count };
  }
```

- [ ] **Step 4: controller 加路由**

`src/circle/circle.controller.ts`，在 `markRead` 之后加：

```ts
  @Post('activities/read-all')
  @ApiOperation({ summary: 'Mark all my circle activities as read' })
  markAllRead(@Req() req: RequestWithUser): Promise<{ count: number }> {
    return this.circleService.markAllActivitiesRead(req.user.userId);
  }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx jest src/circle/circle.service.spec.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/circle/circle.service.ts src/circle/circle.controller.ts src/circle/circle.service.spec.ts
git commit -m "feat: circle activity post excerpt and mark-all-read"
```

---

## Task 2.2: Notification 列表/已读/全部已读/删除 service

**Files:**
- Modify: `src/notification/notification.service.ts`
- Test: `src/notification/notification.service.spec.ts` (create)

- [ ] **Step 1: 新建 spec**

`src/notification/notification.service.spec.ts`：

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { RealtimeService } from 'src/realtime/realtime.service';
import { NotificationService } from './notification.service';

describe('NotificationService (center)', () => {
  let service: NotificationService;

  const prisma = {
    notification: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
  };
  const realtime = { broadcastSystemNotificationUnread: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: RealtimeService, useValue: realtime },
      ],
    }).compile();
    service = module.get(NotificationService);
  });

  it('getNotifications maps fromUser/fromTrace/fromReply and paginates', async () => {
    prisma.notification.findMany.mockResolvedValue([
      {
        id: 'n1',
        type: 'TRACE_COMMENT',
        content: 'nice',
        read: false,
        createdAt: new Date('2026-06-05T00:00:00Z'),
        fromUser: { id: 'u2', nickname: 'B', avatarUrl: null },
        fromTrace: { id: 't1', content: 'my trace body', images: ['img1'] },
        fromReply: { id: 'r1', content: 'reply body' },
      },
    ]);

    const result = await service.getNotifications('user-1', 1);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { toUserID: 'user-1', deleted: false },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(result[0]).toEqual({
      id: 'n1',
      type: 'TRACE_COMMENT',
      content: 'nice',
      read: false,
      createdAt: '2026-06-05T00:00:00.000Z',
      fromUser: { id: 'u2', nickname: 'B', avatarUrl: null },
      fromTrace: { id: 't1', excerpt: 'my trace body', firstImage: 'img1' },
      fromReply: { id: 'r1', content: 'reply body' },
    });
  });

  it('markNotificationRead broadcasts only when a row changed', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    await service.markNotificationRead('user-1', 'n1');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', toUserID: 'user-1', read: false, deleted: false },
      data: { read: true },
    });
    expect(realtime.broadcastSystemNotificationUnread).toHaveBeenCalledWith('user-1');

    jest.clearAllMocks();
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    await service.markNotificationRead('user-1', 'n1');
    expect(realtime.broadcastSystemNotificationUnread).not.toHaveBeenCalled();
  });

  it('markAllNotificationsRead returns count', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 4 });
    const result = await service.markAllNotificationsRead('user-1');
    expect(result).toEqual({ count: 4 });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { toUserID: 'user-1', deleted: false, read: false },
      data: { read: true },
    });
  });

  it('deleteNotification soft-deletes and broadcasts when changed', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    await service.deleteNotification('user-1', 'n1');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', toUserID: 'user-1', deleted: false },
      data: { deleted: true },
    });
    expect(realtime.broadcastSystemNotificationUnread).toHaveBeenCalledWith('user-1');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/notification/notification.service.spec.ts`
Expected: FAIL（方法未定义）。

- [ ] **Step 3: 实现四个方法**

`src/notification/notification.service.ts` 顶部确保 import `NotificationType`（已有）。在类内（`createSystemNotification` 之前或之后）加：

```ts
  async getNotifications(userId: string, page = 1) {
    const take = 20;
    const skip = (Math.max(1, page) - 1) * take;
    const rows = await this.prisma.notification.findMany({
      where: { toUserID: userId, deleted: false },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        fromUser: { select: { id: true, nickname: true, avatarUrl: true } },
        fromTrace: { select: { id: true, content: true, images: true } },
        fromReply: { select: { id: true, content: true } },
      },
    });
    return rows.map((n) => ({
      id: n.id,
      type: n.type,
      content: n.content,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
      fromUser: n.fromUser
        ? { id: n.fromUser.id, nickname: n.fromUser.nickname, avatarUrl: n.fromUser.avatarUrl }
        : null,
      fromTrace: n.fromTrace
        ? {
            id: n.fromTrace.id,
            excerpt: n.fromTrace.content.slice(0, 60),
            firstImage: n.fromTrace.images[0] ?? null,
          }
        : null,
      fromReply: n.fromReply
        ? { id: n.fromReply.id, content: n.fromReply.content }
        : null,
    }));
  }

  async markNotificationRead(userId: string, id: string): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: { id, toUserID: userId, read: false, deleted: false },
      data: { read: true },
    });
    if (result.count > 0) {
      await this.realtimeService.broadcastSystemNotificationUnread(userId);
    }
  }

  async markAllNotificationsRead(userId: string): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { toUserID: userId, deleted: false, read: false },
      data: { read: true },
    });
    if (result.count > 0) {
      await this.realtimeService.broadcastSystemNotificationUnread(userId);
    }
    return { count: result.count };
  }

  async deleteNotification(userId: string, id: string): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: { id, toUserID: userId, deleted: false },
      data: { deleted: true },
    });
    if (result.count > 0) {
      await this.realtimeService.broadcastSystemNotificationUnread(userId);
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/notification/notification.service.spec.ts`
Expected: PASS（4 用例）。

- [ ] **Step 5: Commit**

```bash
git add src/notification/notification.service.ts src/notification/notification.service.spec.ts
git commit -m "feat: notification list/read/read-all/delete service methods"
```

---

## Task 2.3: Notification controller 路由

**Files:**
- Modify: `src/notification/notification.controller.ts`

- [ ] **Step 1: 改 controller**

整文件改为：

```ts
import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from 'src/guards/jwt.guard';
import { NotificationService } from './notification.service';

@ApiTags('notification')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('unread-summary')
  @ApiOperation({ summary: 'Get unread notification summary for discover/profile domains' })
  getUnreadSummary(@Req() req: any) {
    return this.notificationService.getUnreadSummary(req.user.userId);
  }

  @Get('list')
  @ApiOperation({ summary: 'Paginated interactive notification list' })
  list(@Query('page') page: string | undefined, @Req() req: any) {
    return this.notificationService.getNotifications(
      req.user.userId,
      page ? parseInt(page, 10) : 1,
    );
  }

  @Put('read-all')
  @ApiOperation({ summary: 'Mark all interactive notifications as read' })
  readAll(@Req() req: any) {
    return this.notificationService.markAllNotificationsRead(req.user.userId);
  }

  @Put(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  read(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.notificationService.markNotificationRead(req.user.userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete one notification' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.notificationService.deleteNotification(req.user.userId, id);
  }

  @Post('profile/read-all')
  @ApiOperation({ summary: 'Mark profile-domain notifications as read' })
  markProfileRead(@Req() req: any) {
    return this.notificationService.markProfileNotificationsRead(req.user.userId);
  }
}
```

注意：`@Put('read-all')` 必须声明在 `@Put(':id/read')` 之前，否则 `read-all` 会被当成 `:id`。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新错误。

- [ ] **Step 3: Commit**

```bash
git add src/notification/notification.controller.ts
git commit -m "feat: notification center list/read/read-all/delete endpoints"
```

---

# Phase 3 — 通知中心前端（circle-im）

> 工作目录：`/Users/yiboding/projects/circle-im`。

## Task 3.1: 类型 + API client（互动消息 + 圈子全部已读）

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/services/api/notifications.ts`
- Modify: `src/services/api/circles.ts`
- Test: `test/notifications.api.test.js` (create)

- [ ] **Step 1: 加类型**

`src/types/index.ts` 末尾加：

```ts
export type NotificationType =
  | 'SYSTEM'
  | 'TRACE_LIKE'
  | 'TRACE_COMMENT'
  | 'COMMENT_REPLY'
  | 'FRIEND_REQUEST_RECEIVED'
  | 'FRIEND_REQUEST_ACCEPTED'
  | 'FRIEND_REQUEST_REJECTED'
  | 'SQUAD_REQUEST_RECEIVED'
  | 'SQUAD_REQUEST_ACCEPTED'
  | 'SQUAD_REQUEST_REJECTED';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  content: string;
  read: boolean;
  createdAt: string;
  fromUser: { id: string; nickname: string; avatarUrl: string | null } | null;
  fromTrace: { id: string; excerpt: string; firstImage: string | null } | null;
  fromReply: { id: string; content: string } | null;
}
```

并在 `CircleActivityItem`（line 314）加 `post`：

```ts
export interface CircleActivityItem {
  id: string;
  circleId: string;
  circleName: string;
  invitationId: string | null;
  type: CircleActivityType;
  actor: { id: string; nickname: string; avatarUrl: string | null; accountId: string };
  readAt: string | null;
  createdAt: string;
  post: { id: string; excerpt: string } | null;
}
```

并在 `CircleActivityType` union 加两个：

```ts
export type CircleActivityType =
  | 'VERIFICATION_REQUESTED'
  | 'VERIFICATION_APPROVED'
  | 'VERIFICATION_REJECTED'
  | 'INVITATION_ALL_APPROVED'
  | 'INVITATION_SLOT_REJECTED'
  | 'ADMIN_OVERRIDE_APPROVED'
  | 'POST_SIGNUP_RECEIVED'
  | 'POST_SIGNUP_CONFIRMED';
```

- [ ] **Step 2: 写失败测试**

`test/notifications.api.test.js`（仿 `test/temp-chat.api.test.js` 的 loader 写法）：

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadApi(filePathRel, apiResponse) {
  const filePath = path.join(process.cwd(), filePathRel);
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: { "@/*": ["src/*"] },
    },
    fileName: filePath,
  }).outputText;

  const calls = [];
  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier === "@/services/api/client") {
        return {
          apiClient: async (...args) => {
            calls.push(args);
            return apiResponse;
          },
        };
      }
      if (specifier.startsWith("@/")) {
        // utils / validate etc. — load real transpiled? For these tests we only
        // need notifications.ts which imports validate; stub minimal.
        return require(path.join(process.cwd(), "node_modules/.cache-stub-missing"));
      }
      return require(specifier);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return { api: context.module.exports, calls };
}

test("fetchNotifications calls /notification/list with page", async () => {
  const { api, calls } = loadApi("src/services/api/notifications.ts", []);
  await api.fetchNotifications(2);
  assert.equal(calls[0][0], "/notification/list?page=2");
});

test("markNotificationRead PUTs /notification/:id/read", async () => {
  const { api, calls } = loadApi("src/services/api/notifications.ts", undefined);
  await api.markNotificationRead("n1");
  assert.equal(calls[0][0], "/notification/n1/read");
  assert.equal(calls[0][1].method, "PUT");
});

test("markAllNotificationsRead PUTs /notification/read-all", async () => {
  const { api, calls } = loadApi("src/services/api/notifications.ts", { count: 0 });
  await api.markAllNotificationsRead();
  assert.equal(calls[0][0], "/notification/read-all");
  assert.equal(calls[0][1].method, "PUT");
});

test("deleteNotification DELETEs /notification/:id", async () => {
  const { api, calls } = loadApi("src/services/api/notifications.ts", undefined);
  await api.deleteNotification("n1");
  assert.equal(calls[0][0], "/notification/n1");
  assert.equal(calls[0][1].method, "DELETE");
});
```

> 注意：`notifications.ts` 目前 import 了 `@/utils/validate`。为让 loader 不炸，改用：在 `require` stub 里对 `@/utils/validate` 返回真实模块的轻量替身。**更简单的做法**：把新加的 4 个函数放进 `notifications.ts` 时不依赖 validate（list 直接返回 `apiClient` 结果）。loader 的 `@/` 分支改为：`if (specifier === "@/utils/validate") return { expectShape: (v) => v, isPlainObject: () => true, isFiniteNonNegativeNumber: () => true };`。请把上面 loader 的 `@/` 分支替换为该实现。

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/notifications.api.test.js`
Expected: FAIL（函数未定义）。

- [ ] **Step 4: 实现 API 函数**

`src/services/api/notifications.ts` 顶部 import 加 `NotificationItem`：

```ts
import type { NotificationItem } from '@/types';
```

文件末尾加：

```ts
export async function fetchNotifications(
  page = 1,
): Promise<NotificationItem[]> {
  return apiClient<NotificationItem[]>(`/notification/list?page=${page}`);
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiClient<void>(`/notification/${id}/read`, { method: 'PUT' });
}

export async function markAllNotificationsRead(): Promise<{ count: number }> {
  return apiClient<{ count: number }>('/notification/read-all', {
    method: 'PUT',
  });
}

export async function deleteNotification(id: string): Promise<void> {
  await apiClient<void>(`/notification/${id}`, { method: 'DELETE' });
}
```

`src/services/api/circles.ts` 末尾加：

```ts
export async function markAllCircleActivitiesRead(): Promise<{ count: number }> {
  return apiClient<{ count: number }>('/circle/activities/read-all', {
    method: 'POST',
  });
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test test/notifications.api.test.js`
Expected: PASS（4 用例）。

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/services/api/notifications.ts src/services/api/circles.ts test/notifications.api.test.js
git commit -m "feat: notification center + circle activity read-all API client"
```

---

## Task 3.2: 行适配器（Notification / CircleActivity → 行展示）

**Files:**
- Create: `src/features/notifications/utils/notification-summary.ts`
- Create: `src/features/notifications/utils/circle-activity-summary.ts`
- Test: `test/notification-adapters.test.js`

适配器把数据 + i18n `t` → `{ icon, title, summary, previewImage, avatarUrl, unread, createdAt }`，供共用行渲染。

- [ ] **Step 1: 写失败测试**

`test/notification-adapters.test.js`：

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(rel) {
  const filePath = path.join(process.cwd(), rel);
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: { "@/*": ["src/*"] },
    },
    fileName: filePath,
  }).outputText;
  const context = { module: { exports: {} }, exports: {}, require };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

const t = (key, opts) => (opts && opts.name ? `${key}:${opts.name}` : key);

test("interactive: TRACE_LIKE → heart icon + liked summary", () => {
  const { mapNotificationToRow } = load(
    "src/features/notifications/utils/notification-summary.ts",
  );
  const row = mapNotificationToRow(
    {
      id: "n1",
      type: "TRACE_LIKE",
      content: "",
      read: false,
      createdAt: "2026-06-05T00:00:00Z",
      fromUser: { id: "u2", nickname: "B", avatarUrl: null },
      fromTrace: { id: "t1", excerpt: "body", firstImage: "img1" },
      fromReply: null,
    },
    t,
  );
  assert.equal(row.icon, "heart-outline");
  assert.equal(row.unread, true);
  assert.equal(row.previewImage, "img1");
  assert.equal(row.title, "B");
});

test("circle: POST_SIGNUP_RECEIVED → uses post excerpt", () => {
  const { mapActivityToRow } = load(
    "src/features/notifications/utils/circle-activity-summary.ts",
  );
  const row = mapActivityToRow(
    {
      id: "a1",
      circleId: "c1",
      circleName: "C",
      invitationId: null,
      type: "POST_SIGNUP_RECEIVED",
      actor: { id: "u2", nickname: "B", avatarUrl: null, accountId: "2" },
      readAt: null,
      createdAt: "2026-06-05T00:00:00Z",
      post: { id: "p1", excerpt: "Hiking" },
    },
    t,
  );
  assert.equal(row.unread, true);
  assert.ok(row.summary.includes("Hiking"));
  assert.equal(row.title, "B");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/notification-adapters.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现两个适配器**

`src/features/notifications/utils/notification-summary.ts`：

```ts
import type { Ionicons } from '@expo/vector-icons';
import type { NotificationItem, NotificationType } from '@/types';

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

export interface NotificationRowData {
  id: string;
  avatarName: string;
  avatarUrl: string | null;
  title: string;
  summary: string;
  icon: keyof typeof Ionicons.glyphMap;
  previewImage: string | null;
  unread: boolean;
  createdAt: string;
}

function iconFor(type: NotificationType): keyof typeof Ionicons.glyphMap {
  if (type === 'TRACE_COMMENT' || type === 'COMMENT_REPLY') return 'chatbubble-outline';
  if (type === 'TRACE_LIKE') return 'heart-outline';
  if (type.startsWith('FRIEND_REQUEST')) return 'person-add-outline';
  if (type.startsWith('SQUAD_REQUEST')) return 'people-outline';
  return 'notifications-outline';
}

export function mapNotificationToRow(
  n: NotificationItem,
  t: TFunc,
): NotificationRowData {
  const name = n.fromUser?.nickname ?? t('notifications.system');
  const summary =
    n.type === 'SYSTEM'
      ? n.content
      : t(`notifications.summary.${n.type}`, {
          defaultValue: n.content || t('notifications.summary.default'),
        });
  return {
    id: n.id,
    avatarName: name,
    avatarUrl: n.fromUser?.avatarUrl ?? null,
    title: name,
    summary,
    icon: iconFor(n.type),
    previewImage: n.fromTrace?.firstImage ?? null,
    unread: !n.read,
    createdAt: n.createdAt,
  };
}
```

`src/features/notifications/utils/circle-activity-summary.ts`：

```ts
import type { Ionicons } from '@expo/vector-icons';
import type { CircleActivityItem, CircleActivityType } from '@/types';

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

export interface NotificationRowData {
  id: string;
  avatarName: string;
  avatarUrl: string | null;
  title: string;
  summary: string;
  icon: keyof typeof Ionicons.glyphMap;
  previewImage: string | null;
  unread: boolean;
  createdAt: string;
}

function iconFor(type: CircleActivityType): keyof typeof Ionicons.glyphMap {
  if (type.startsWith('POST_SIGNUP')) return 'hand-right-outline';
  if (type.startsWith('VERIFICATION')) return 'shield-checkmark-outline';
  return 'people-circle-outline';
}

export function mapActivityToRow(
  a: CircleActivityItem,
  t: TFunc,
): NotificationRowData {
  const excerpt = a.post?.excerpt ?? '';
  const summary = t(`notifications.activity.${a.type}`, {
    circle: a.circleName,
    post: excerpt,
    defaultValue: a.circleName,
  });
  return {
    id: a.id,
    avatarName: a.actor.nickname,
    avatarUrl: a.actor.avatarUrl,
    title: a.actor.nickname,
    summary,
    icon: iconFor(a.type),
    previewImage: null,
    unread: a.readAt === null,
    createdAt: a.createdAt,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/notification-adapters.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/features/notifications/utils test/notification-adapters.test.js
git commit -m "feat: notification + circle activity row adapters"
```

---

## Task 3.3: Zustand store（列表/未读/乐观更新）

**Files:**
- Create: `src/features/notifications/store/use-notification-center-store.ts`
- Test: `test/notification-center-store.test.js`

Store 负责：两栏数据、loading/error、乐观标已读、乐观删除、把已读拨回全部的辅助 selector。纯状态逻辑用 TDD。

- [ ] **Step 1: 写失败测试**

`test/notification-center-store.test.js`（用与适配器测试相同的 `load` helper，把它复制进文件顶部；store import 了 `zustand`，loader 的 `require` 用真实 node_modules 的 zustand）：

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(rel) {
  const filePath = path.join(process.cwd(), rel);
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, baseUrl: process.cwd(), paths: { "@/*": ["src/*"] } },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} }, exports: {},
    require: (s) => (s.startsWith("@/") ? {} : require(s)),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test("markInteractiveReadLocal flips read flag", () => {
  const { useNotificationCenterStore } = load(
    "src/features/notifications/store/use-notification-center-store.ts",
  );
  const store = useNotificationCenterStore.getState();
  store.setInteractive([
    { id: "n1", type: "SYSTEM", content: "x", read: false, createdAt: "", fromUser: null, fromTrace: null, fromReply: null },
  ]);
  store.markInteractiveReadLocal("n1");
  assert.equal(useNotificationCenterStore.getState().interactive[0].read, true);
});

test("removeInteractiveLocal drops the row", () => {
  const { useNotificationCenterStore } = load(
    "src/features/notifications/store/use-notification-center-store.ts",
  );
  const store = useNotificationCenterStore.getState();
  store.setInteractive([
    { id: "n1", type: "SYSTEM", content: "x", read: false, createdAt: "", fromUser: null, fromTrace: null, fromReply: null },
  ]);
  store.removeInteractiveLocal("n1");
  assert.equal(useNotificationCenterStore.getState().interactive.length, 0);
});

test("markCircleReadLocal sets readAt", () => {
  const { useNotificationCenterStore } = load(
    "src/features/notifications/store/use-notification-center-store.ts",
  );
  const store = useNotificationCenterStore.getState();
  store.setCircle([
    { id: "a1", circleId: "c", circleName: "C", invitationId: null, type: "POST_SIGNUP_RECEIVED", actor: { id: "u", nickname: "B", avatarUrl: null, accountId: "1" }, readAt: null, createdAt: "", post: null },
  ]);
  store.markCircleReadLocal("a1");
  assert.notEqual(useNotificationCenterStore.getState().circle[0].readAt, null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/notification-center-store.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现 store**

`src/features/notifications/store/use-notification-center-store.ts`：

```ts
import { create } from 'zustand';
import type { CircleActivityItem, NotificationItem } from '@/types';

interface NotificationCenterState {
  interactive: NotificationItem[];
  circle: CircleActivityItem[];
  setInteractive: (items: NotificationItem[]) => void;
  setCircle: (items: CircleActivityItem[]) => void;
  markInteractiveReadLocal: (id: string) => void;
  removeInteractiveLocal: (id: string) => void;
  markAllInteractiveReadLocal: () => void;
  markCircleReadLocal: (id: string) => void;
  markAllCircleReadLocal: () => void;
}

export const useNotificationCenterStore = create<NotificationCenterState>(
  (set) => ({
    interactive: [],
    circle: [],
    setInteractive: (items) => set({ interactive: items }),
    setCircle: (items) => set({ circle: items }),
    markInteractiveReadLocal: (id) =>
      set((s) => ({
        interactive: s.interactive.map((n) =>
          n.id === id ? { ...n, read: true } : n,
        ),
      })),
    removeInteractiveLocal: (id) =>
      set((s) => ({ interactive: s.interactive.filter((n) => n.id !== id) })),
    markAllInteractiveReadLocal: () =>
      set((s) => ({
        interactive: s.interactive.map((n) => ({ ...n, read: true })),
      })),
    markCircleReadLocal: (id) =>
      set((s) => ({
        circle: s.circle.map((a) =>
          a.id === id ? { ...a, readAt: new Date().toISOString() } : a,
        ),
      })),
    markAllCircleReadLocal: () =>
      set((s) => ({
        circle: s.circle.map((a) =>
          a.readAt ? a : { ...a, readAt: new Date().toISOString() },
        ),
      })),
  }),
);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/notification-center-store.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/features/notifications/store test/notification-center-store.test.js
git commit -m "feat: notification center zustand store"
```

---

## Task 3.4: 展示组件（TabBar / FilterBar / Row / EmptyState）

**Files:**
- Create: `src/features/notifications/components/NotificationTabBar.tsx`
- Create: `src/features/notifications/components/ReadFilterBar.tsx`
- Create: `src/features/notifications/components/NotificationRow.tsx`
- Create: `src/features/notifications/components/NotificationEmptyState.tsx`

纯展示组件，用 `useTheme` + 设计 tokens；无单测（仓库无 RN 渲染测试），靠 Task 3.6 的 app 手动验证。

- [ ] **Step 1: NotificationTabBar**

```tsx
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Spacing, useTheme } from '@/theme';

export type NotificationTabKey = 'interactive' | 'circle';

interface Props {
  active: NotificationTabKey;
  interactiveUnread: boolean;
  circleUnread: boolean;
  labels: { interactive: string; circle: string };
  onSelect: (key: NotificationTabKey) => void;
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', height: 44, borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF4D4F' },
  underline: { position: 'absolute', bottom: 0, height: 2, left: '25%', right: '25%' },
});

export const NotificationTabBar = memo(function NotificationTabBar(p: Props) {
  const { colors } = useTheme();
  const tab = (key: NotificationTabKey, label: string, unread: boolean) => {
    const selected = p.active === key;
    return (
      <Pressable style={s.tab} onPress={() => p.onSelect(key)}>
        <View style={s.labelRow}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: selected ? colors.primary : colors.text }}>
            {label}
          </Text>
          {unread ? <View style={s.dot} /> : null}
        </View>
        {selected ? <View style={[s.underline, { backgroundColor: colors.primary }]} /> : null}
      </Pressable>
    );
  };
  return (
    <View style={[s.bar, { backgroundColor: colors.surface, borderBottomColor: colors.surfaceBorder }]}>
      {tab('interactive', p.labels.interactive, p.interactiveUnread)}
      {tab('circle', p.labels.circle, p.circleUnread)}
    </View>
  );
});
```

- [ ] **Step 2: ReadFilterBar**

```tsx
import { memo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, useTheme } from '@/theme';

export type ReadFilter = 'all' | 'unread';

interface Props {
  filter: ReadFilter;
  labels: { all: string; unread: string; markAll: string };
  onSelect: (f: ReadFilter) => void;
  onMarkAll: () => Promise<void>;
}

const s = StyleSheet.create({
  bar: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, gap: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  chip: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: Radius.sm, borderWidth: 1 },
  spacer: { flex: 1 },
});

export const ReadFilterBar = memo(function ReadFilterBar(p: Props) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const chip = (key: ReadFilter, label: string) => {
    const on = p.filter === key;
    return (
      <Pressable
        style={[s.chip, { backgroundColor: on ? colors.primaryLight : colors.surface, borderColor: on ? colors.primary : colors.surfaceBorder }]}
        onPress={() => p.onSelect(key)}
      >
        <Text style={{ fontSize: 13, fontWeight: '700', color: on ? colors.primary : colors.textSecondary }}>{label}</Text>
      </Pressable>
    );
  };
  const handleMarkAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await p.onMarkAll();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[s.bar, { backgroundColor: colors.background, borderBottomColor: colors.surfaceBorder }]}>
      {chip('all', p.labels.all)}
      {chip('unread', p.labels.unread)}
      <View style={s.spacer} />
      <Pressable onPress={handleMarkAll} disabled={busy} hitSlop={8}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>{p.labels.markAll}</Text>
        )}
      </Pressable>
    </View>
  );
});
```

- [ ] **Step 3: NotificationRow（共用头像行）**

```tsx
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { Radius, Spacing, useTheme } from '@/theme';
import { formatRelativeTime } from '@/features/discover/utils/relative-time';
import { useTranslation } from 'react-i18next';
import type { NotificationRowData } from '@/features/notifications/utils/notification-summary';

interface Props {
  data: NotificationRowData;
  onPress: () => void;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm, gap: 11 },
  avatarWrap: { position: 'relative' },
  unreadDot: { position: 'absolute', top: -1, right: -1, width: 9, height: 9, borderRadius: 5, backgroundColor: '#FF4D4F' },
  body: { flex: 1, gap: 5 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  preview: { width: 52, height: 52, borderRadius: Radius.sm },
});

export const NotificationRow = memo(function NotificationRow({ data, onPress }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable style={s.row} onPress={onPress}>
      <View style={s.avatarWrap}>
        <Avatar size={48} name={data.avatarName} uri={data.avatarUrl ?? undefined} />
        {data.unread ? <View style={s.unreadDot} /> : null}
      </View>
      <View style={s.body}>
        <View style={s.topRow}>
          <Text numberOfLines={1} style={{ flex: 1, marginRight: 6, fontSize: 16, fontWeight: '700', color: colors.text }}>
            {data.title}
          </Text>
          <Text style={{ fontSize: 12, color: colors.textSecondary }}>{formatRelativeTime(data.createdAt, t)}</Text>
        </View>
        <View style={s.summaryRow}>
          <Ionicons name={data.icon} size={13} color={colors.textSecondary} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: colors.textSecondary }}>
            {data.summary}
          </Text>
        </View>
      </View>
      {data.previewImage ? (
        <Image source={{ uri: data.previewImage }} style={s.preview} contentFit="cover" />
      ) : null}
    </Pressable>
  );
});
```

- [ ] **Step 4: NotificationEmptyState**

```tsx
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, useTheme } from '@/theme';

interface Props {
  title: string;
  subtitle: string;
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: Spacing.xl, gap: 8 },
});

export const NotificationEmptyState = memo(function NotificationEmptyState(p: Props) {
  const { colors } = useTheme();
  return (
    <View style={s.wrap}>
      <Ionicons name="notifications-outline" size={34} color={colors.textSecondary} />
      <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{p.title}</Text>
      <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center' }}>{p.subtitle}</Text>
    </View>
  );
});
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新错误（若 `colors.primaryLight`/`surfaceBorder` 名称不符，参照 `src/theme/colors.ts` 改成实际 token 名）。

- [ ] **Step 6: Commit**

```bash
git add src/features/notifications/components
git commit -m "feat: notification center presentational components"
```

---

## Task 3.5: NotificationCenterScreen + 路由

**Files:**
- Create: `src/features/notifications/screens/NotificationCenterScreen.tsx`
- Create: `app/(tabs)/messages/notifications.tsx`
- Modify: `app/(tabs)/messages/_layout.tsx`（如需注册 Stack.Screen，参照同目录已有屏）

- [ ] **Step 1: 屏幕组件**

`src/features/notifications/screens/NotificationCenterScreen.tsx`：

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, useTheme } from '@/theme';
import { Divider } from '@/components/ui/divider';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  deleteNotification,
} from '@/services/api/notifications';
import {
  fetchCircleActivities,
  markAllCircleActivitiesRead,
  markCircleActivityRead,
} from '@/services/api/circles';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import { mapNotificationToRow } from '@/features/notifications/utils/notification-summary';
import { mapActivityToRow } from '@/features/notifications/utils/circle-activity-summary';
import { NotificationTabBar, type NotificationTabKey } from '@/features/notifications/components/NotificationTabBar';
import { ReadFilterBar, type ReadFilter } from '@/features/notifications/components/ReadFilterBar';
import { NotificationRow } from '@/features/notifications/components/NotificationRow';
import { NotificationEmptyState } from '@/features/notifications/components/NotificationEmptyState';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

export default function NotificationCenterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const interactive = useNotificationCenterStore((s) => s.interactive);
  const circle = useNotificationCenterStore((s) => s.circle);
  const store = useNotificationCenterStore.getState;

  const [tab, setTab] = useState<NotificationTabKey>('interactive');
  const [filter, setFilter] = useState<ReadFilter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [n, a] = await Promise.all([
        fetchNotifications(1).catch(() => []),
        fetchCircleActivities().catch(() => []),
      ]);
      store().setInteractive(n);
      store().setCircle(a);
    } finally {
      setRefreshing(false);
    }
  }, [store]);

  useEffect(() => {
    void load();
  }, [load]);

  const interactiveUnread = useMemo(() => interactive.some((n) => !n.read), [interactive]);
  const circleUnread = useMemo(() => circle.some((a) => a.readAt === null), [circle]);

  const rows = useMemo(() => {
    if (tab === 'interactive') {
      const mapped = interactive.map((n) => ({ raw: n, view: mapNotificationToRow(n, t) }));
      return filter === 'unread' ? mapped.filter((r) => r.view.unread) : mapped;
    }
    const mapped = circle.map((a) => ({ raw: a, view: mapActivityToRow(a, t) }));
    return filter === 'unread' ? mapped.filter((r) => r.view.unread) : mapped;
  }, [tab, filter, interactive, circle, t]);

  const handleMarkAll = useCallback(async () => {
    if (tab === 'interactive') {
      store().markAllInteractiveReadLocal();
      await markAllNotificationsRead().catch((e) => isDev && console.warn(e));
    } else {
      store().markAllCircleReadLocal();
      await markAllCircleActivitiesRead().catch((e) => isDev && console.warn(e));
    }
  }, [tab, store]);

  const handleRowPress = useCallback(
    (id: string) => {
      if (tab === 'interactive') {
        store().markInteractiveReadLocal(id);
        void markNotificationRead(id).catch((e) => isDev && console.warn(e));
        // TODO(Task 3.6 follow-up): route TRACE_* → moment, FRIEND_REQUEST → friend flow
      } else {
        store().markCircleReadLocal(id);
        void markCircleActivityRead(id).catch((e) => isDev && console.warn(e));
      }
    },
    [tab, store],
  );

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[s.header, { borderBottomColor: colors.surfaceBorder }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>
          {t('notifications.title')}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <NotificationTabBar
        active={tab}
        interactiveUnread={interactiveUnread}
        circleUnread={circleUnread}
        labels={{ interactive: t('notifications.tabInteractive'), circle: t('notifications.tabCircle') }}
        onSelect={setTab}
      />
      <ReadFilterBar
        filter={filter}
        labels={{ all: t('notifications.filterAll'), unread: t('notifications.filterUnread'), markAll: t('notifications.markAllRead') }}
        onSelect={setFilter}
        onMarkAll={handleMarkAll}
      />

      <FlatList
        data={rows}
        keyExtractor={(r) => r.view.id}
        renderItem={({ item }) => (
          <NotificationRow data={item.view} onPress={() => handleRowPress(item.view.id)} />
        )}
        ItemSeparatorComponent={Divider}
        refreshing={refreshing}
        onRefresh={load}
        contentContainerStyle={{ paddingHorizontal: Spacing.md, paddingBottom: 40 }}
        ListEmptyComponent={
          <NotificationEmptyState
            title={t('notifications.emptyTitle')}
            subtitle={t('notifications.emptySubtitle')}
          />
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
});
```

- [ ] **Step 2: 路由文件**

`app/(tabs)/messages/notifications.tsx`：

```tsx
export { default } from '@/features/notifications/screens/NotificationCenterScreen';
```

- [ ] **Step 3: 若 `_layout.tsx` 用显式 Stack.Screen 列表，注册新屏**

打开 `app/(tabs)/messages/_layout.tsx`，若看到其它屏以 `<Stack.Screen name="temp-chats" ... />` 形式列出，则照样加一行：

```tsx
<Stack.Screen name="notifications" options={{ headerShown: false }} />
```
若该 layout 是自动路由（无显式列表），跳过本步。

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新错误。

- [ ] **Step 5: Commit**

```bash
git add src/features/notifications/screens app/'(tabs)'/messages/notifications.tsx app/'(tabs)'/messages/_layout.tsx
git commit -m "feat: notification center screen and route"
```

---

## Task 3.6: 铃铛改向 + 角标 + i18n

**Files:**
- Modify: `src/features/messages/screens/MessagesScreen.tsx:343-345`（`handleOpenNotifications`）+ 角标数据源
- Modify: `src/i18n/locales/zh.json`、`src/i18n/locales/en.json`

- [ ] **Step 1: 铃铛 onPress 改向**

`handleOpenNotifications` 改为：

```ts
  const handleOpenNotifications = useCallback(() => {
    router.push('/(tabs)/messages/notifications');
  }, [router]);
```

- [ ] **Step 2: 角标数据源（互动未读 + 圈子未读）**

`MessagesScreen` 已有 `discoverUnread = useTabBadgeStore((s) => s.systemUnread)`。查看 `src/stores/tabBadgeStore.ts` 是否已有圈子未读字段（如 `circleUnread`）。
- 若有：`const circleUnread = useTabBadgeStore((s) => s.circleUnread);` 然后角标传 `count={discoverUnread + circleUnread}`。
- 若无：保持现状 `count={discoverUnread}`（铃铛角标后续随 realtime 完善；不阻塞本任务）。

把 `<Badge count={discoverUnread} />` 改为 `<Badge count={discoverUnread + (circleUnread ?? 0)} />`（按上面实际情况）。

- [ ] **Step 3: i18n — zh.json 加 `notifications` namespace**

在 `src/i18n/locales/zh.json` 顶层对象内加（与 `messages` 同级）：

```json
  "notifications": {
    "title": "消息通知",
    "tabInteractive": "互动消息",
    "tabCircle": "圈子动态",
    "filterAll": "全部",
    "filterUnread": "未读",
    "markAllRead": "全部已读",
    "system": "系统通知",
    "emptyTitle": "暂无通知",
    "emptySubtitle": "新的互动和圈子动态会出现在这里",
    "summary": {
      "default": "给你发来一条新通知",
      "TRACE_LIKE": "点赞了你的动态",
      "TRACE_COMMENT": "评论了你的动态",
      "COMMENT_REPLY": "回复了你",
      "FRIEND_REQUEST_RECEIVED": "申请添加你为好友",
      "FRIEND_REQUEST_ACCEPTED": "通过了你的好友申请",
      "FRIEND_REQUEST_REJECTED": "拒绝了你的好友申请",
      "SQUAD_REQUEST_RECEIVED": "申请加入",
      "SQUAD_REQUEST_ACCEPTED": "通过了你的入队申请",
      "SQUAD_REQUEST_REJECTED": "拒绝了你的入队申请"
    },
    "activity": {
      "POST_SIGNUP_RECEIVED": "报名了你的帖子：{{post}}",
      "POST_SIGNUP_CONFIRMED": "你已报名：{{post}}",
      "VERIFICATION_REQUESTED": "在「{{circle}}」发起了验证申请",
      "VERIFICATION_APPROVED": "通过了你在「{{circle}}」的验证",
      "VERIFICATION_REJECTED": "拒绝了你在「{{circle}}」的验证",
      "INVITATION_ALL_APPROVED": "你在「{{circle}}」的邀请已全部通过",
      "INVITATION_SLOT_REJECTED": "你在「{{circle}}」的一个邀请名额被拒",
      "ADMIN_OVERRIDE_APPROVED": "管理员通过了你在「{{circle}}」的申请"
    }
  },
```

- [ ] **Step 4: i18n — en.json 同结构**

在 `src/i18n/locales/en.json` 加对应英文：

```json
  "notifications": {
    "title": "Notifications",
    "tabInteractive": "Interactions",
    "tabCircle": "Circle Activity",
    "filterAll": "All",
    "filterUnread": "Unread",
    "markAllRead": "Mark all read",
    "system": "System",
    "emptyTitle": "No notifications",
    "emptySubtitle": "New interactions and circle activity show up here",
    "summary": {
      "default": "sent you a notification",
      "TRACE_LIKE": "liked your moment",
      "TRACE_COMMENT": "commented on your moment",
      "COMMENT_REPLY": "replied to you",
      "FRIEND_REQUEST_RECEIVED": "wants to add you as a friend",
      "FRIEND_REQUEST_ACCEPTED": "accepted your friend request",
      "FRIEND_REQUEST_REJECTED": "declined your friend request",
      "SQUAD_REQUEST_RECEIVED": "requested to join",
      "SQUAD_REQUEST_ACCEPTED": "accepted your join request",
      "SQUAD_REQUEST_REJECTED": "declined your join request"
    },
    "activity": {
      "POST_SIGNUP_RECEIVED": "signed up for your post: {{post}}",
      "POST_SIGNUP_CONFIRMED": "You signed up: {{post}}",
      "VERIFICATION_REQUESTED": "requested verification in {{circle}}",
      "VERIFICATION_APPROVED": "approved your verification in {{circle}}",
      "VERIFICATION_REJECTED": "rejected your verification in {{circle}}",
      "INVITATION_ALL_APPROVED": "your invitation to {{circle}} is fully approved",
      "INVITATION_SLOT_REJECTED": "an invitation slot in {{circle}} was rejected",
      "ADMIN_OVERRIDE_APPROVED": "an admin approved your request in {{circle}}"
    }
  },
```

- [ ] **Step 5: 校验 JSON 合法**

Run: `node -e "require('./src/i18n/locales/zh.json'); require('./src/i18n/locales/en.json'); console.log('ok')"`
Expected: 输出 `ok`（无 JSON 解析错误，注意补/删尾逗号）。

- [ ] **Step 6: 手动验证（关键交付）**

Run: 启动 app（`npx expo start`，或项目既有 `/run` 流程）。进入「消息」页 → 点右上角铃铛 → 应进入「消息通知」页，看到两栏「互动消息 / 圈子动态」、筛选「全部 / 未读 / 全部已读」、下拉刷新、列表行（头像 + 未读红点 + 名称 + 时间 + 图标摘要 + 预览图）。切换栏、点「全部已读」、点单条都应即时反应。
Expected: 与图1 一致；无崩溃。

- [ ] **Step 7: Commit**

```bash
git add src/features/messages/screens/MessagesScreen.tsx src/i18n/locales/zh.json src/i18n/locales/en.json
git commit -m "feat: route bell to notification center and add i18n"
```

---

# Phase 4 — 报名按钮前端（circle-im）

## Task 4.1: plaza API signup/cancel + 类型

**Files:**
- Modify: `src/services/api/plaza.ts`
- Modify: `src/types/index.ts`（`CirclePlazaPost`）
- Test: `test/plaza-signup.api.test.js`

- [ ] **Step 1: 类型加字段**

`src/types/index.ts` 的 `CirclePlazaPost` 接口，在 `viewCount: number;` 下加：

```ts
  viewCount: number;
  signupCount: number;
  signedByMe: boolean;
```

- [ ] **Step 2: 写失败测试**

`test/plaza-signup.api.test.js`（用 Task 3.1 的同款 loader，但 stub `@/services/api/utils` 的 `buildQuery`/`normalizeMediaUrl`）：

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(apiResponse) {
  const filePath = path.join(process.cwd(), "src/services/api/plaza.ts");
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, baseUrl: process.cwd(), paths: { "@/*": ["src/*"] } },
    fileName: filePath,
  }).outputText;
  const calls = [];
  const context = {
    module: { exports: {} }, exports: {},
    require: (s) => {
      if (s === "@/services/api/client") return { apiClient: async (...a) => { calls.push(a); return apiResponse; } };
      if (s === "@/services/api/utils") return { buildQuery: () => "", normalizeMediaUrl: (u) => u };
      if (s.startsWith("@/")) return {};
      return require(s);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return { api: context.module.exports, calls };
}

test("signupForPost POSTs /circle-plaza/posts/:id/signup", async () => {
  const { api, calls } = load({ signed: true, signupCount: 1 });
  const r = await api.signupForPost("p1");
  assert.equal(calls[0][0], "/circle-plaza/posts/p1/signup");
  assert.equal(calls[0][1].method, "POST");
  assert.deepEqual(r, { signed: true, signupCount: 1 });
});

test("cancelSignup DELETEs /circle-plaza/posts/:id/signup", async () => {
  const { api, calls } = load({ signed: false, signupCount: 0 });
  await api.cancelSignup("p1");
  assert.equal(calls[0][0], "/circle-plaza/posts/p1/signup");
  assert.equal(calls[0][1].method, "DELETE");
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/plaza-signup.api.test.js`
Expected: FAIL。

- [ ] **Step 4: 实现 API**

`src/services/api/plaza.ts` 末尾加：

```ts
export async function signupForPost(
  id: string,
): Promise<{ signed: boolean; signupCount: number }> {
  return apiClient<{ signed: boolean; signupCount: number }>(
    `/circle-plaza/posts/${id}/signup`,
    { method: 'POST' },
  );
}

export async function cancelSignup(
  id: string,
): Promise<{ signed: boolean; signupCount: number }> {
  return apiClient<{ signed: boolean; signupCount: number }>(
    `/circle-plaza/posts/${id}/signup`,
    { method: 'DELETE' },
  );
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test test/plaza-signup.api.test.js`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/services/api/plaza.ts src/types/index.ts test/plaza-signup.api.test.js
git commit -m "feat: plaza post signup API client"
```

---

## Task 4.2: 帖子卡片浏览数 → 报名数按钮

**Files:**
- Modify: `src/features/discover/components/plaza-post-card.tsx:185-191`

- [ ] **Step 1: 引入 state + API**

`plaza-post-card.tsx` 顶部 import 加：

```tsx
import { useState } from 'react';
import { signupForPost, cancelSignup } from '@/services/api/plaza';
```

组件内（`timeLabel` 之后）加本地状态：

```tsx
  const [signed, setSigned] = useState(post.signedByMe);
  const [signupCount, setSignupCount] = useState(post.signupCount);
  const [busy, setBusy] = useState(false);

  const handleToggleSignup = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const next = !signed;
    // 乐观更新
    setSigned(next);
    setSignupCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      const res = next ? await signupForPost(post.id) : await cancelSignup(post.id);
      setSigned(res.signed);
      setSignupCount(res.signupCount);
    } catch (e) {
      // 回滚
      setSigned(!next);
      setSignupCount((c) => Math.max(0, c + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }, [busy, signed, post.id]);
```

- [ ] **Step 2: footer 由浏览数改为报名按钮**

把现有 footer（line 185-191）整段替换为：

```tsx
      {/* Footer：报名按钮 + 报名数 */}
      <View style={s.footer}>
        <Pressable
          onPress={handleToggleSignup}
          disabled={busy}
          hitSlop={6}
          style={[
            s.signupBtn,
            { borderColor: signed ? colors.primary : colors.surfaceBorder, backgroundColor: signed ? colors.primaryLight : 'transparent' },
          ]}
        >
          <Ionicons
            name={signed ? 'checkmark-circle' : 'hand-right-outline'}
            size={16}
            color={signed ? colors.primary : colors.textSecondary}
          />
          <Text style={{ fontSize: 13, fontWeight: '600', color: signed ? colors.primary : colors.textSecondary }}>
            {signed ? t('plaza.signedUp', { defaultValue: '已报名' }) : t('plaza.signUp', { defaultValue: '报名' })}
            {signupCount > 0 ? ` ${signupCount}` : ''}
          </Text>
        </Pressable>
      </View>
```

并在底部 `StyleSheet.create` 的 `s` 里把 `viewCount` 样式替换/补一个 `signupBtn`：

```tsx
  signupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
```

（保留 `footer` 样式；删除不再用的 `viewCount` 样式和 `viewText`/`eye-outline` 相关；`Pressable` 已从 'react-native' import；`Radius`/`Spacing` 已 import。）

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新错误。

- [ ] **Step 4: 手动验证**

Run: 启动 app → 进入圈子广场 feed → 帖子卡片底部应显示「报名」按钮（含报名数），点击切换「已报名」并数字 +1；A 用户给 B 的帖子报名后，B 进通知中心「圈子动态」应看到「A 报名了你的帖子：…」。
Expected: 行为正确、乐观更新、失败回滚。

- [ ] **Step 5: Commit**

```bash
git add src/features/discover/components/plaza-post-card.tsx
git commit -m "feat: replace post view count with signup button"
```

---

# 收尾

- [ ] **后端全量测试**

在 `/Users/yiboding/projects/circle_be`：`npx jest`
Expected: 全绿（至少新增/改动的 spec 全过）。

- [ ] **前端全量测试**

在 `/Users/yiboding/projects/circle-im`：`node --test test/`
Expected: 全绿。

- [ ] **端到端手动验证**：报名 → 通知中心圈子动态出现报名事件；互动消息列表/已读/删除/全部已读；铃铛角标；下拉刷新。

---

## Self-Review notes（已核对）

- **Spec 覆盖**：报名后端(Task1.1-1.6)、通知中心后端互动(2.2-2.3)+圈子(2.1)、前端 API(3.1)/适配器(3.2)/store(3.3)/组件(3.4)/屏幕(3.5)/铃铛+i18n(3.6)、报名前端(4.1-4.2)——逐条对应 spec。
- **类型一致**：`NotificationRowData` 在两个适配器中字段一致；`signupForPost/cancelSignup` 返回 `{signed,signupCount}` 前后端一致；`CircleActivityItem.post` 后端 `{id,excerpt}` 与前端类型一致。
- **路由顺序**：notification controller `@Put('read-all')` 在 `@Put(':id/read')` 之前（已注明）。
- **已知需实现时确认**：`tabTabBadgeStore` 是否已有圈子未读字段（3.6 Step2 给了两种分支）；`colors.primaryLight/surfaceBorder` token 名以 `src/theme/colors.ts` 为准。

---

# Phase 1.5 — 报名资格限制后端（circle_be）增补（2026-06-05）

> 贴主可设置「谁能报名」的三维门槛（VIP/信用/靓号），独立于帖子查看限制。在 Phase 1 之后、与 circle-plaza 同文件。工作目录 `/Users/yiboding/projects/circle_be`，分支 `feat/notification-center`。

## Task 1.7: schema 加三字段 + migration

**Files:** `prisma/schema.prisma`

- [ ] **Step 1:** `CirclePost` 在 `signupCount Int @default(0)` 下加：

```prisma
  signupCount             Int              @default(0)
  signupVipRestriction    Int?
  signupCreditRestriction Int?
  signupFancyRestriction  Boolean          @default(false)
```

- [ ] **Step 2:** 生成迁移：`npx prisma migrate dev --name circle_post_signup_restriction`（无 DB 时同 Task 1.1 的 `migrate diff` 兜底；Phase 1 的 migration 已存在，本次只 diff 出三列）。然后 `npx prisma generate`。
- [ ] **Step 3:** `npx tsc --noEmit` 通过。
- [ ] **Step 4:** Commit：`feat: add per-post signup eligibility restrictions`

## Task 1.8: DTO + createPost 持久化

**Files:** `src/circle-plaza/dto/circle-plaza.dto.ts`、`src/circle-plaza/circle-plaza.service.ts`

- [ ] **Step 1:** `CreatePlazaPostDto` 末尾（`fancyRestriction?` 之后）加，照搬现有校验器：

```ts
  @ApiPropertyOptional({ description: 'Min VIP level to sign up, null = no restriction' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  @IsOptional()
  signupVipRestriction?: number;

  @ApiPropertyOptional({ description: 'Min credit score to sign up, null = no restriction' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  signupCreditRestriction?: number;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  signupFancyRestriction?: boolean;
```

- [ ] **Step 2:** `PlazaPostDto` 在 `signedByMe: boolean;` 下加：

```ts
  signupRestrictions: {
    vipLevel: number | null;
    creditScore: number | null;
    fancyNumber: boolean;
  };
  canSignup: boolean;
```

- [ ] **Step 3:** `createPost` 的 `tx.circlePost.create({ data: { ... } })` 里加三字段：

```ts
          fancyRestriction: dto.fancyRestriction ?? false,
          signupVipRestriction: dto.signupVipRestriction ?? null,
          signupCreditRestriction: dto.signupCreditRestriction ?? null,
          signupFancyRestriction: dto.signupFancyRestriction ?? false,
```

## Task 1.9: 报名拦截 + DTO 计算字段（TDD）

**Files:** `src/circle-plaza/circle-plaza.service.ts`、`src/circle-plaza/circle-plaza.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
  describe('signup eligibility', () => {
    const restrictedPost = {
      id: 'post-1', authorID: 'author-1', circleID: 'circle-1',
      signupVipRestriction: 3, signupCreditRestriction: null, signupFancyRestriction: false,
    };

    it('rejects signup when viewer VIP below signup restriction', async () => {
      prisma.circlePost.findFirst.mockResolvedValue(restrictedPost);
      prisma.circlePostSignup.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ vipLevel: 1, creditScore: 100, fancyNumber: false });

      await expect(service.signupForPost('user-2', 'post-1')).rejects.toThrow(ForbiddenException);
      expect(prisma.circlePostSignup.create).not.toHaveBeenCalled();
    });

    it('allows signup when viewer meets restriction', async () => {
      prisma.circlePost.findFirst.mockResolvedValue(restrictedPost);
      prisma.circlePostSignup.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ vipLevel: 5, creditScore: 100, fancyNumber: false });
      prisma.circlePostSignup.create.mockResolvedValue({ id: 's-1' });
      prisma.circlePost.update.mockResolvedValue({ signupCount: 1 });
      prisma.circleActivity.create.mockResolvedValue({});

      const result = await service.signupForPost('user-2', 'post-1');
      expect(result).toEqual({ signed: true, signupCount: 1 });
    });
  });
```

（`ForbiddenException` 已在文件顶部 import。`restrictedPost` mock 不再含 `content`，因 Task 1.4 的 cleanup 已删 `content` select。）

- [ ] **Step 2:** 跑确认失败：`npx jest src/circle-plaza/circle-plaza.service.spec.ts -t 'signup eligibility'` → FAIL。

- [ ] **Step 3: 实现**

(a) `signupForPost` 的 `findFirst` select 加三个限制字段：

```ts
      select: {
        id: true, authorID: true, circleID: true,
        signupVipRestriction: true,
        signupCreditRestriction: true,
        signupFancyRestriction: true,
      },
```

(b) 在「幂等 existing 返回」之后、`$transaction` 之前插入资格校验：

```ts
    // 报名资格校验（独立于帖子查看限制 vipRestriction，仅看 signup* 门槛）
    const viewer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { vipLevel: true, creditScore: true, fancyNumber: true },
    });
    if (!this.checkCanSignup(post, viewer)) {
      throw new ForbiddenException('您的等级不满足该帖子的报名要求');
    }
```

(c) 加私有方法（紧挨 `checkCanInteract`）：

```ts
  private checkCanSignup(
    post: any,
    viewer: { vipLevel: number; creditScore: number; fancyNumber: boolean } | null,
  ): boolean {
    if (!viewer) return false;
    if (post.signupVipRestriction != null && viewer.vipLevel < post.signupVipRestriction) return false;
    if (post.signupCreditRestriction != null && viewer.creditScore < post.signupCreditRestriction) return false;
    if (post.signupFancyRestriction && !viewer.fancyNumber) return false;
    return true;
  }
```

(d) `toPlazaPostDto` 改签名 `(post, canInteract, signedByMe, canSignup)`，return 加：

```ts
      signedByMe,
      signupRestrictions: {
        vipLevel: post.signupVipRestriction ?? null,
        creditScore: post.signupCreditRestriction ?? null,
        fancyNumber: post.signupFancyRestriction ?? false,
      },
      canSignup,
```

(e) 三个调用点：
- `createPost` 末尾：`return this.toPlazaPostDto(post, true, false, true);`
- `getPost`：`return this.toPlazaPostDto(post, this.checkCanInteract(post, viewer), Boolean(signed), this.checkCanSignup(post, viewer));`
- `getFeed` 的 map：`this.toPlazaPostDto(post, this.checkCanInteract(post, viewer), signedSet.has(post.id), this.checkCanSignup(post, viewer))`

- [ ] **Step 4:** 跑确认通过：`npx jest src/circle-plaza/circle-plaza.service.spec.ts` → 全过（更新可能受影响的旧 signupForPost 测试：给它们的 `restrictedPost`/`activePost` mock 补三个 `signup*Restriction` 字段 = null/null/false，并给 `prisma.user.findUnique` 一个达标的 mock，否则新加的资格校验会拦截）。
- [ ] **Step 5:** `npx tsc --noEmit` 通过。
- [ ] **Step 6:** Commit：`feat: enforce per-post signup eligibility and expose canSignup`

---

# Phase 4.5 — 报名资格限制前端（circle-im）增补

> 与 Phase 4 同批做。工作目录 `/Users/yiboding/projects/circle-im`。

## Task 4.3: 类型 + 发帖设置

**Files:** `src/types/index.ts`、`src/features/social/screens/CreatePostScreen.tsx`、`src/services/api/plaza.ts`（无需改，`createPlazaPost` 直接透传 input）

- [ ] **Step 1:** `CreatePlazaPostInput` 加：

```ts
  fancyRestriction: boolean;
  signupVipRestriction: number | null;
  signupCreditRestriction: number | null;
  signupFancyRestriction: boolean;
```

`CirclePlazaPost` 加（在 `signedByMe` 下）：

```ts
  signedByMe: boolean;
  signupRestrictions: {
    vipLevel: number | null;
    creditScore: number | null;
    fancyNumber: boolean;
  };
  canSignup: boolean;
```

- [ ] **Step 2:** `CreatePostScreen.tsx`：照搬现有 VIP/信用/靓号三档限制的 state + cycle 回调 + 渲染行（约 line 155-228、476-490），新增 `signupVipRestriction`/`signupCreditRestriction`/`signupFancyEnabled` 三个 state 与对应「报名 VIP / 报名信用 / 报名仅靓号」设置行（复用 `VIP_OPTIONS`/`CREDIT_OPTIONS`），并在提交对象（约 line 292-294）加：

```ts
        signupVipRestriction,
        signupCreditRestriction,
        signupFancyRestriction: signupFancyEnabled,
```

- [ ] **Step 3:** 手动验证：发帖页能分别设置「查看限制」与「报名限制」两组；`npx tsc --noEmit` 通过。
- [ ] **Step 4:** Commit：`feat: signup eligibility settings in post composer`

## Task 4.4: 帖子卡片报名按钮按 canSignup 置灰

**Files:** `src/features/discover/components/plaza-post-card.tsx`

- [ ] **Step 1:** Task 4.2 的报名按钮基础上：当 `!post.canSignup` 时按钮 `disabled` 且置灰，点击弹 `Alert` 提示报名门槛（仿 `handleAvatarPress` 里拼 `reasons` 的写法，但用 `post.signupRestrictions` 的 `vipLevel/creditScore/fancyNumber`）。已报名者（`signedByMe`）即使现在不达标也允许取消（取消不校验门槛）。
- [ ] **Step 2:** `npx tsc --noEmit` 通过；手动验证：不达标用户看到置灰报名按钮 + 点击提示门槛。
- [ ] **Step 3:** Commit：`feat: gate signup button by canSignup with restriction hint`

> 注：Phase 1.5 / 4.5 与 Phase 1 的 `signupForPost` 改动同文件，执行顺序须在 Phase 1 之后；与 Phase 2/3 互不冲突。
