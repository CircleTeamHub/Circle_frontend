# 用户朋友圈相册页 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从好友资料页「朋友圈」入口进入某用户的朋友圈相册页（仿微信「他的朋友圈」：顶部封面图 + 头像昵称，下方该用户动态列表）。

**Architecture:** 后端给现有 `GET /trace/feed` 加可选 `authorId` 查询参数，把好友聚合流收窄到单个作者（复用既有可见性/分页/点赞/评论逻辑）。前端新增 `fetchUserMoments` + `useUserMoments` hook + 三个展示组件（封面 header / 动态行）+ `UserMomentsScreen`，挂到四个 tab 栈的嵌套路由 `user/[id]/moments`，并把资料页「朋友圈」行接上跳转。

**Tech Stack:** Expo Router、React Native、expo-image、react-i18next；前端测试用 `node:test`（源码断言，仓库既有约定）；后端 NestJS + Prisma + jest。

## Global Constraints

- 颜色一律取自 `useTheme().colors`；字号取 `Typography`；间距取 `Spacing`；圆角取 `Radius`（来自 `@/theme`）。**禁止硬编码色值**；布局尺寸（封面高、头像大小等）必须定义成文件顶部具名常量，不用裸魔法数。
- 组件用具名 `interface` typed props；与 `src/features/discover/components` 现有组件保持一致用 `React.FC<Props>`。
- 不可变更新（spread），不 mutate。
- 禁止生产代码里 `console.log`（调试日志用 `if (__DEV__) console.warn(...)`，照 `moments-feed.tsx` 既有写法）。
- 后端 `authorId` 必须做可见性校验：作者对 viewer 不可见（非好友/被隐私屏蔽）→ 返回空列表，**不得**泄露存在性或内容。
- 前端测试命令：`node --test test/<file>.test.js`；后端测试命令：`npm test -- trace.service`（在 `/Users/yiboding/projects/circle_be` 下）。
- 提交只包含本功能文件，不要 `git add -A`（两个仓库 `main` 上都有上个会话遗留的未提交改动）。

---

## Task B1: 后端 feed 支持 authorId（circle_be）

**Repo:** `/Users/yiboding/projects/circle_be`（先建分支 `feat/user-moments-album`）

**Files:**
- Modify: `src/trace/dto/trace.dto.ts`（`TraceFeedQueryDto` 加 `authorId`）
- Modify: `src/trace/trace.service.ts:43-73`（`getFeed` 支持 `authorId`）
- Test: `src/trace/trace.service.spec.ts`（加两个用例）

**Interfaces:**
- Produces: `GET /trace/feed?authorId=<uuid>&page=&limit=` — 传 `authorId` 时只返回该作者对 viewer 可见的朋友圈；作者不可见时返回 `{ items: [], total: 0, page, limit, hasMore: false }`。

- [ ] **Step 1: 建后端分支**

```bash
cd /Users/yiboding/projects/circle_be
git checkout -b feat/user-moments-album
git branch --show-current   # 期望 feat/user-moments-album
```

- [ ] **Step 2: 写失败测试**

在 `src/trace/trace.service.spec.ts` 中，紧跟现有 `it('caps embedded likes and comments in the feed query', ...)`（约 223 行 `});` 之后）插入：

```ts
  it('narrows the feed to a single author when authorId is a visible friend', async () => {
    prisma.friend.findMany.mockResolvedValue([
      { userID: 'viewer-1', friendID: 'friend-1' },
    ]);
    privacySettings.canViewMoments.mockResolvedValue(true);
    prisma.trace.findMany.mockResolvedValue([]);
    prisma.trace.count.mockResolvedValue(0);
    prisma.traceLikeStat.findMany.mockResolvedValue([]);

    await service.getFeed('viewer-1', {
      page: 1,
      limit: 20,
      authorId: 'friend-1',
    });

    expect(prisma.trace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ fromID: 'friend-1' }),
      }),
    );
  });

  it('returns empty without querying when authorId is not visible to the viewer', async () => {
    prisma.friend.findMany.mockResolvedValue([]); // viewer 没有好友
    prisma.trace.findMany.mockResolvedValue([]);
    prisma.trace.count.mockResolvedValue(0);
    prisma.traceLikeStat.findMany.mockResolvedValue([]);

    const result = await service.getFeed('viewer-1', {
      page: 1,
      limit: 20,
      authorId: 'stranger-1',
    });

    assert: void 0;
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(prisma.trace.findMany).not.toHaveBeenCalled();
  });
```

（删掉那行 `assert: void 0;` —— 它只是占位提醒，写的时候不要带上。）

- [ ] **Step 3: 跑测试确认失败**

```bash
cd /Users/yiboding/projects/circle_be
npm test -- trace.service
```
期望：FAIL —— `authorId` 还不是合法 DTO 字段 / `where.fromID` 仍是 `{ in: [...] }`，两个新用例不通过。

- [ ] **Step 4: DTO 加 authorId**

`src/trace/dto/trace.dto.ts` 的 `TraceFeedQueryDto` 内，`limit` 字段之后加：

```ts
  @ApiPropertyOptional({ description: '只看某个用户的朋友圈' })
  @IsUUID()
  @IsOptional()
  authorId?: string;
```

（`IsUUID`、`IsOptional`、`ApiPropertyOptional` 该文件已 import，无需新增。）

- [ ] **Step 5: getFeed 收窄到单作者**

`src/trace/trace.service.ts`，把现有 `getFeed` 里这段（约 59-73 行）：

```ts
    const visibleUserIds = await this.filterMomentVisibleAuthorIds(
      userId,
      [userId, ...friendIds],
      friendIdSet,
    );

    const where = {
      deleted: false,
      fromID: { in: visibleUserIds },
      OR: [
        { fromID: userId },
        { visibility: 'FRIENDS_ONLY' as const },
        { visibility: 'PUBLIC' as const },
      ],
    };
```

替换为：

```ts
    const visibleUserIds = await this.filterMomentVisibleAuthorIds(
      userId,
      [userId, ...friendIds],
      friendIdSet,
    );

    // 单用户相册：authorId 收窄到某个作者。作者必须对 viewer 可见
    // （本人或已接受好友且未被隐私屏蔽），否则返回空——不泄露存在性。
    if (query.authorId && !visibleUserIds.includes(query.authorId)) {
      return { items: [], total: 0, page, limit, hasMore: false };
    }

    const where = {
      deleted: false,
      fromID: query.authorId ? query.authorId : { in: visibleUserIds },
      OR: [
        { fromID: userId },
        { visibility: 'FRIENDS_ONLY' as const },
        { visibility: 'PUBLIC' as const },
      ],
    };
```

- [ ] **Step 6: 跑测试确认通过**

```bash
cd /Users/yiboding/projects/circle_be
npm test -- trace.service
```
期望：PASS（含两个新用例 + 原有用例全绿）。

- [ ] **Step 7: 提交**

```bash
cd /Users/yiboding/projects/circle_be
git add src/trace/dto/trace.dto.ts src/trace/trace.service.ts src/trace/trace.service.spec.ts
git commit -m "feat: support authorId filter on moments feed"
```

---

## Task F1: getUserMomentsHref 路由构造（circle-im）

**Repo:** `/Users/yiboding/projects/circle-im`（已在分支 `feat/user-moments-album`）

**Files:**
- Modify: `src/features/user/utils/routes.ts`
- Test: `test/user-moments-routes.test.js`

**Interfaces:**
- Produces: `getUserMomentsHref(scope: UserProfileScope, id: string, name?: string): Href` → `{ pathname: '/(tabs)/<scope>/user/[id]/moments', params }`

- [ ] **Step 1: 写失败测试** — 新建 `test/user-moments-routes.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('getUserMomentsHref maps every scope to user/[id]/moments', () => {
  const src = read('src/features/user/utils/routes.ts');
  assert.match(src, /export function getUserMomentsHref/);
  assert.match(src, /\/\(tabs\)\/contacts\/user\/\[id\]\/moments/);
  assert.match(src, /\/\(tabs\)\/profile\/user\/\[id\]\/moments/);
  assert.match(src, /\/\(tabs\)\/discover\/user\/\[id\]\/moments/);
  assert.match(src, /\/\(tabs\)\/messages\/user\/\[id\]\/moments/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/yiboding/projects/circle-im
node --test test/user-moments-routes.test.js
```
期望：FAIL（`getUserMomentsHref` 未定义）。

- [ ] **Step 3: 实现** — 在 `src/features/user/utils/routes.ts` 的 `getEditFriendTagsHref` 之后插入：

```ts
export function getUserMomentsHref(
  scope: UserProfileScope,
  id: string,
  name?: string,
): Href {
  const params = name ? { id, name } : { id };

  switch (scope) {
    case 'contacts':
      return { pathname: '/(tabs)/contacts/user/[id]/moments', params };
    case 'profile':
      return { pathname: '/(tabs)/profile/user/[id]/moments', params };
    case 'discover':
      return { pathname: '/(tabs)/discover/user/[id]/moments', params };
    case 'messages':
    default:
      return { pathname: '/(tabs)/messages/user/[id]/moments', params };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test test/user-moments-routes.test.js
```
期望：PASS。（此时 TS 可能因路由文件尚不存在而报类型错，将在 Task F9 建齐路由文件后消除；本任务只验证源码结构。）

- [ ] **Step 5: 提交**

```bash
git add src/features/user/utils/routes.ts test/user-moments-routes.test.js
git commit -m "feat: add getUserMomentsHref route builder"
```

---

## Task F2: fetchUserMoments API（circle-im）

**Files:**
- Modify: `src/services/api/moments.ts`
- Test: `test/user-moments-api.test.js`

**Interfaces:**
- Consumes: `buildQuery`、`normalizeMoment`、`PaginatedResponse<MomentPost>`（同文件已有）
- Produces: `fetchUserMoments(userId: string, params?: { page?: number; limit?: number }): Promise<PaginatedResponse<MomentPost>>`

- [ ] **Step 1: 写失败测试** — 新建 `test/user-moments-api.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('fetchUserMoments hits /trace/feed with authorId and normalizes', () => {
  const src = read('src/services/api/moments.ts');
  assert.match(src, /export async function fetchUserMoments/);
  // authorId 进 query
  assert.match(src, /authorId:\s*userId/);
  assert.match(src, /\/trace\/feed/);
  // 复用 normalizeMoment（与 fetchMomentsFeed 一致）
  assert.match(src, /items:\s*result\.items\.map\(normalizeMoment\)/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/user-moments-api.test.js
```
期望：FAIL（`fetchUserMoments` 未定义）。

- [ ] **Step 3: 实现** — 在 `src/services/api/moments.ts` 的 `fetchMomentsFeed` 之后插入：

```ts
export async function fetchUserMoments(
  userId: string,
  params?: { page?: number; limit?: number },
): Promise<PaginatedResponse<MomentPost>> {
  const result = await apiClient<PaginatedResponse<MomentPost>>(
    `/trace/feed${buildQuery({ ...(params ?? {}), authorId: userId })}`,
  );

  return {
    ...result,
    items: result.items.map(normalizeMoment),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test test/user-moments-api.test.js
```
期望：PASS。

- [ ] **Step 5: 提交**

```bash
git add src/services/api/moments.ts test/user-moments-api.test.js
git commit -m "feat: add fetchUserMoments api"
```

---

## Task F3: ImageGrid 支持外部宽度（circle-im）

**Files:**
- Modify: `src/features/discover/components/image-grid.tsx`
- Test: `test/image-grid-width.test.js`

**Interfaces:**
- Produces: `ImageGridProps` 增加可选 `containerWidth?: number`；不传时退回原有计算 `screenWidth - Spacing.lg * 2 - Spacing.md * 2`（向后兼容，现有 `moment-card` 调用不受影响）。

- [ ] **Step 1: 写失败测试** — 新建 `test/image-grid-width.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('ImageGrid accepts an optional containerWidth and falls back to default', () => {
  const src = read('src/features/discover/components/image-grid.tsx');
  assert.match(src, /containerWidth\?:\s*number/);
  // 入参优先，缺省退回原算法
  assert.match(src, /containerWidth\s*\?\?\s*screenWidth - Spacing\.lg \* 2 - Spacing\.md \* 2/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/image-grid-width.test.js
```
期望：FAIL。

- [ ] **Step 3: 实现** — 改 `src/features/discover/components/image-grid.tsx`：

把 props 接口：
```ts
interface ImageGridProps {
  images: string[];
  onPress?: (index: number) => void;
}
```
改为：
```ts
interface ImageGridProps {
  images: string[];
  onPress?: (index: number) => void;
  /** 外部容器可用宽度（相册行的内容列宽度）。缺省时按 discover 卡片布局计算。 */
  containerWidth?: number;
}
```

把组件签名与宽度计算：
```ts
export const ImageGrid: React.FC<ImageGridProps> = ({ images, onPress }) => {
  const { width: screenWidth } = useWindowDimensions();
  const containerWidth = screenWidth - Spacing.lg * 2 - Spacing.md * 2;
```
改为：
```ts
export const ImageGrid: React.FC<ImageGridProps> = ({
  images,
  onPress,
  containerWidth: containerWidthProp,
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const containerWidth =
    containerWidthProp ?? screenWidth - Spacing.lg * 2 - Spacing.md * 2;
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test test/image-grid-width.test.js
```
期望：PASS。

- [ ] **Step 5: 提交**

```bash
git add src/features/discover/components/image-grid.tsx test/image-grid-width.test.js
git commit -m "feat: let ImageGrid accept an explicit container width"
```

---

## Task F4: 相册日期工具（circle-im）

**Files:**
- Create: `src/features/discover/utils/album-date.ts`
- Test: `test/album-date.test.js`

**Interfaces:**
- Produces:
  - `getAlbumDateParts(createdAt: string, language: string): { day: string; month: string }` — `day` 为日号字符串；`month` 中文为 `"6月"`，其他语言为英文缩写（`Jun`）。非法日期返回 `{ day: '', month: '' }`。
  - `isSameCalendarDay(a: string, b: string): boolean` — 同年同月同日。

- [ ] **Step 1: 写失败测试** — 新建 `test/album-date.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('album-date helpers exist and branch on language + same-day', () => {
  const src = read('src/features/discover/utils/album-date.ts');
  assert.match(src, /export function getAlbumDateParts/);
  assert.match(src, /export function isSameCalendarDay/);
  // 中文走「月」，英文走缩写表
  assert.match(src, /language\.startsWith\('zh'\)/);
  assert.match(src, /月/);
  assert.match(src, /MONTHS_EN/);
  // 非法日期保护
  assert.match(src, /Number\.isNaN/);
  // 同日比较三要素
  assert.match(src, /getFullYear\(\)/);
  assert.match(src, /getMonth\(\)/);
  assert.match(src, /getDate\(\)/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/album-date.test.js
```
期望：FAIL（文件不存在）。

- [ ] **Step 3: 实现** — 新建 `src/features/discover/utils/album-date.ts`：

```ts
const MONTHS_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * 相册左侧日期列：返回日号 + 月份标签。
 * 中文显示「6月」，其他语言显示英文缩写「Jun」。
 */
export function getAlbumDateParts(
  createdAt: string,
  language: string,
): { day: string; month: string } {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return { day: '', month: '' };
  }
  const day = String(date.getDate());
  const monthIndex = date.getMonth();
  const month = language.startsWith('zh')
    ? `${monthIndex + 1}月`
    : MONTHS_EN[monthIndex];
  return { day, month };
}

/** 两个 ISO 时间是否同年同月同日。 */
export function isSameCalendarDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) {
    return false;
  }
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test test/album-date.test.js
```
期望：PASS。

- [ ] **Step 5: 提交**

```bash
git add src/features/discover/utils/album-date.ts test/album-date.test.js
git commit -m "feat: add album date helpers"
```

---

## Task F5: useUserMoments hook（circle-im）

**Files:**
- Create: `src/features/discover/hooks/use-user-moments.ts`
- Test: `test/use-user-moments.test.js`

**Interfaces:**
- Consumes: `fetchUserMoments`（Task F2）、`MomentPost`
- Produces: `useUserMoments(userId: string): { moments: MomentPost[]; loading: boolean; refreshing: boolean; hasMore: boolean; error: string | null; refresh: () => Promise<void>; loadMore: () => Promise<void> }`

- [ ] **Step 1: 写失败测试** — 新建 `test/use-user-moments.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('useUserMoments fetches per-user, paginates and dedupes', () => {
  const src = read('src/features/discover/hooks/use-user-moments.ts');
  assert.match(src, /export function useUserMoments/);
  assert.match(src, /fetchUserMoments\(/);
  // 分页状态
  assert.match(src, /hasMore/);
  assert.match(src, /refreshing/);
  // 错误态
  assert.match(src, /error/);
  // 去重（避免分页重复 id）
  assert.match(src, /Map\(|Set\(|\.some\(|filter\(/);
  // 初次加载
  assert.match(src, /useEffect\(/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/use-user-moments.test.js
```
期望：FAIL（文件不存在）。

- [ ] **Step 3: 实现** — 新建 `src/features/discover/hooks/use-user-moments.ts`：

```ts
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchUserMoments } from '@/services/api/moments';
import type { MomentPost } from '@/types';

const PAGE_SIZE = 20;

interface UseUserMomentsResult {
  moments: MomentPost[];
  loading: boolean;
  refreshing: boolean;
  hasMore: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

/** 拉取某个用户的朋友圈相册（分页、下拉刷新、去重）。 */
export function useUserMoments(userId: string): UseUserMomentsResult {
  const { t } = useTranslation();
  const [moments, setMoments] = useState<MomentPost[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextPage: number, replace: boolean) => {
      if (!userId) return;
      try {
        setError(null);
        const result = await fetchUserMoments(userId, {
          page: nextPage,
          limit: PAGE_SIZE,
        });
        setMoments((prev) => {
          const base = replace ? [] : prev;
          const seen = new Set(base.map((m) => m.id));
          const merged = [...base];
          for (const item of result.items) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              merged.push(item);
            }
          }
          return merged;
        });
        setHasMore(result.hasMore);
        setPage(nextPage);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('common.networkError'));
      }
    },
    [userId, t],
  );

  useEffect(() => {
    setLoading(true);
    void load(1, true).finally(() => setLoading(false));
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(1, true);
    setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loading || refreshing || !hasMore) return;
    setLoading(true);
    await load(page + 1, false);
    setLoading(false);
  }, [loading, refreshing, hasMore, page, load]);

  return { moments, loading, refreshing, hasMore, error, refresh, loadMore };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test test/use-user-moments.test.js
```
期望：PASS。

- [ ] **Step 5: 提交**

```bash
git add src/features/discover/hooks/use-user-moments.ts test/use-user-moments.test.js
git commit -m "feat: add useUserMoments hook"
```

---

## Task F6: MomentAlbumRow 组件（circle-im）

**Files:**
- Create: `src/features/discover/components/moment-album-row.tsx`
- Test: `test/moment-album-row.test.js`

**Interfaces:**
- Consumes: `getAlbumDateParts`（F4）、`ImageGrid` + `containerWidth`（F3）、`formatRelativeTime`、`MomentPost`
- Produces: `MomentAlbumRow: React.FC<{ post: MomentPost; showDate: boolean; onPress: (postId: string) => void }>`

- [ ] **Step 1: 写失败测试** — 新建 `test/moment-album-row.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('MomentAlbumRow renders date column + content + grid + social, themed', () => {
  const src = read('src/features/discover/components/moment-album-row.tsx');
  assert.match(src, /showDate/);
  assert.match(src, /getAlbumDateParts/);
  assert.match(src, /ImageGrid/);
  assert.match(src, /containerWidth=/); // 给九宫格传相册列宽
  assert.match(src, /formatRelativeTime/);
  // 主题：用 useTheme，不硬编码颜色
  assert.match(src, /useTheme\(\)/);
  assert.doesNotMatch(src, /#[0-9a-fA-F]{6}/);
  // 无重复头像（相册同一人）
  assert.doesNotMatch(src, /Avatar/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/moment-album-row.test.js
```
期望：FAIL。

- [ ] **Step 3: 实现** — 新建 `src/features/discover/components/moment-album-row.tsx`：

```tsx
import { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { formatRelativeTime } from '@/features/discover/utils/relative-time';
import { getAlbumDateParts } from '@/features/discover/utils/album-date';
import { ImageGrid } from './image-grid';
import type { MomentPost } from '@/types';

const DATE_COL_WIDTH = 56;

interface MomentAlbumRowProps {
  post: MomentPost;
  showDate: boolean;
  onPress: (postId: string) => void;
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  dateCol: {
    width: DATE_COL_WIDTH,
    alignItems: 'flex-start',
  },
  dayText: {
    ...Typography.h1,
  },
  monthText: {
    ...Typography.small,
    marginTop: Spacing.xs / 2,
  },
  body: {
    flex: 1,
    gap: Spacing.sm,
  },
  content: {
    ...Typography.bodyRegular,
    lineHeight: 21,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  socialBlock: {
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    gap: Spacing.xs,
  },
  likesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  commentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});

export const MomentAlbumRow: React.FC<MomentAlbumRowProps> = ({
  post,
  showDate,
  onPress,
}) => {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { width: screenWidth } = useWindowDimensions();

  const dateParts = useMemo(
    () => getAlbumDateParts(post.createdAt, i18n.language),
    [post.createdAt, i18n.language],
  );
  const timeLabel = useMemo(
    () => formatRelativeTime(post.createdAt, t),
    [post.createdAt, t],
  );

  const d = useMemo(
    () => ({
      dayText: { color: colors.text },
      monthText: { color: colors.textSecondary },
      content: { color: colors.text },
      timeText: { color: colors.textSecondary, ...Typography.small },
      socialBlock: { backgroundColor: colors.surface },
      likeText: { color: colors.primary, ...Typography.caption },
      commentUser: {
        color: colors.primary,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
      commentText: { color: colors.text, ...Typography.caption },
    }),
    [colors],
  );

  // 内容列宽 = 屏宽 - 左右页边距 - 日期列 - 行内 gap
  const contentWidth =
    screenWidth - Spacing.lg * 2 - DATE_COL_WIDTH - Spacing.md;

  const comments = post.comments ?? [];
  const likedFriends = post.likedFriends ?? [];

  return (
    <View style={s.row}>
      <View style={s.dateCol}>
        {showDate ? (
          <>
            <Text style={[s.dayText, d.dayText]}>{dateParts.day}</Text>
            <Text style={[s.monthText, d.monthText]}>{dateParts.month}</Text>
          </>
        ) : null}
      </View>

      <View style={s.body}>
        {post.content ? (
          <Pressable onPress={() => onPress(post.id)}>
            <Text style={[s.content, d.content]}>{post.content}</Text>
          </Pressable>
        ) : null}

        {post.images.length > 0 ? (
          <Pressable onPress={() => onPress(post.id)}>
            <ImageGrid images={post.images} containerWidth={contentWidth} />
          </Pressable>
        ) : null}

        <View style={s.footerRow}>
          <Text style={d.timeText}>{timeLabel}</Text>
        </View>

        {likedFriends.length > 0 || comments.length > 0 ? (
          <View style={[s.socialBlock, d.socialBlock]}>
            {likedFriends.length > 0 ? (
              <View style={s.likesRow}>
                <Ionicons name="heart" size={13} color={colors.warning} />
                <Text style={d.likeText}>
                  {likedFriends.map((friend) => friend.nickname).join('、')}
                </Text>
              </View>
            ) : null}

            {comments.map((comment) => (
              <Pressable
                key={comment.id}
                style={s.commentRow}
                onPress={() => onPress(post.id)}
              >
                <Text style={d.commentUser}>{comment.user.nickname}</Text>
                {comment.replyTo ? (
                  <>
                    <Text style={d.commentText}>
                      {' '}{t('moment.reply')}{' '}
                    </Text>
                    <Text style={d.commentUser}>
                      {comment.replyTo.nickname}
                    </Text>
                  </>
                ) : null}
                <Text style={d.commentText}>: {comment.content}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
};
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test test/moment-album-row.test.js
```
期望：PASS。

- [ ] **Step 5: 提交**

```bash
git add src/features/discover/components/moment-album-row.tsx test/moment-album-row.test.js
git commit -m "feat: add MomentAlbumRow (WeChat album style)"
```

---

## Task F7: MomentAlbumHeader 组件（circle-im）

**Files:**
- Create: `src/features/discover/components/moment-album-header.tsx`
- Test: `test/moment-album-header.test.js`

**Interfaces:**
- Consumes: `expo-image` 的 `Image`、`Avatar`、`MomentPost`(不需要)
- Produces: `MomentAlbumHeader: React.FC<{ coverUrl?: string | null; avatarUrl?: string | null; nickname: string }>`

- [ ] **Step 1: 写失败测试** — 新建 `test/moment-album-header.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('MomentAlbumHeader shows cover, nickname and avatar with themed fallback', () => {
  const src = read('src/features/discover/components/moment-album-header.tsx');
  assert.match(src, /coverUrl/);
  assert.match(src, /nickname/);
  assert.match(src, /Avatar/);
  // 封面用 expo-image
  assert.match(src, /from 'expo-image'/);
  // 主题化、无硬编码色值
  assert.match(src, /useTheme\(\)/);
  assert.doesNotMatch(src, /#[0-9a-fA-F]{6}/);
  // 具名尺寸常量（封面高 / 头像大小）
  assert.match(src, /const COVER_HEIGHT/);
  assert.match(src, /const AVATAR_SIZE/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/moment-album-header.test.js
```
期望：FAIL。

- [ ] **Step 3: 实现** — 新建 `src/features/discover/components/moment-album-header.tsx`：

```tsx
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Avatar } from '@/components/ui/avatar';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const COVER_HEIGHT = 260;
const AVATAR_SIZE = 64;

interface MomentAlbumHeaderProps {
  coverUrl?: string | null;
  avatarUrl?: string | null;
  nickname: string;
}

const s = StyleSheet.create({
  container: {
    height: COVER_HEIGHT + AVATAR_SIZE / 2,
  },
  cover: {
    width: '100%',
    height: COVER_HEIGHT,
  },
  identityRow: {
    position: 'absolute',
    top: COVER_HEIGHT - AVATAR_SIZE / 2,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  nickname: {
    ...Typography.h3,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  avatarWrap: {
    borderRadius: Radius.md,
    borderWidth: 2,
    overflow: 'hidden',
  },
});

export const MomentAlbumHeader: React.FC<MomentAlbumHeaderProps> = ({
  coverUrl,
  avatarUrl,
  nickname,
}) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      coverPlaceholder: { backgroundColor: colors.surface },
      nickname: {
        color: colors.white,
        textShadowColor: colors.overlay,
      },
      avatarWrap: { borderColor: colors.white },
    }),
    [colors],
  );

  return (
    <View style={s.container}>
      {coverUrl ? (
        <Image source={{ uri: coverUrl }} style={s.cover} contentFit="cover" />
      ) : (
        <View style={[s.cover, d.coverPlaceholder]} />
      )}

      <View style={s.identityRow}>
        <Text style={[s.nickname, d.nickname]} numberOfLines={1}>
          {nickname}
        </Text>
        <View style={[s.avatarWrap, d.avatarWrap]}>
          <Avatar
            size={AVATAR_SIZE}
            name={nickname}
            uri={avatarUrl ?? undefined}
          />
        </View>
      </View>
    </View>
  );
};
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test test/moment-album-header.test.js
```
期望：PASS。

- [ ] **Step 5: 提交**

```bash
git add src/features/discover/components/moment-album-header.tsx test/moment-album-header.test.js
git commit -m "feat: add MomentAlbumHeader cover component"
```

---

## Task F8: UserMomentsScreen 主屏 + i18n（circle-im）

**Files:**
- Create: `src/features/discover/screens/UserMomentsScreen.tsx`
- Modify: `src/i18n/locales/en.json`、`src/i18n/locales/zh.json`
- Test: `test/user-moments-screen.test.js`

**Interfaces:**
- Consumes: `useUserMoments`（F5）、`MomentAlbumHeader`（F7）、`MomentAlbumRow`（F6）、`isSameCalendarDay`（F4）、`fetchUserProfile`、`getUserProfileScopeFromSegments`
- Produces: 默认导出 `UserMomentsScreen`（无 props，自身读 `useLocalSearchParams<{ id: string; name?: string }>()`）

- [ ] **Step 1: 加 i18n 文案** — `src/i18n/locales/zh.json` 的 `moment` 对象内补：

```json
    "albumTitle": "{{name}}的朋友圈",
    "albumTitleFallback": "朋友圈"
```

`src/i18n/locales/en.json` 的 `moment` 对象内补：

```json
    "albumTitle": "{{name}}'s Moments",
    "albumTitleFallback": "Moments"
```

（注意 JSON 尾逗号：插在 `moment` 对象已有键之间或末键前，保持合法 JSON。）

- [ ] **Step 2: 写失败测试** — 新建 `test/user-moments-screen.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('UserMomentsScreen wires header + album list + pagination', () => {
  const src = read('src/features/discover/screens/UserMomentsScreen.tsx');
  assert.match(src, /useUserMoments/);
  assert.match(src, /MomentAlbumHeader/);
  assert.match(src, /MomentAlbumRow/);
  assert.match(src, /isSameCalendarDay/); // 同日分组决定 showDate
  assert.match(src, /FlatList/);
  assert.match(src, /onEndReached/);
  assert.match(src, /RefreshControl/);
  assert.match(src, /fetchUserProfile/); // 拉封面/头像
  // 跳详情复用现有路由
  assert.match(src, /moment\/\[id\]/);
  // 空态复用现有文案
  assert.match(src, /discover\.noMoments/);
});

test('moment album i18n keys exist in both locales', () => {
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  assert.ok(zh.moment.albumTitle);
  assert.ok(en.moment.albumTitle);
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
node --test test/user-moments-screen.test.js
```
期望：FAIL（屏文件不存在；i18n 用例应已通过）。

- [ ] **Step 4: 实现** — 新建 `src/features/discover/screens/UserMomentsScreen.tsx`：

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Stack,
  useLocalSearchParams,
  useRouter,
  useSegments,
} from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Spacing, Typography, useTheme } from '@/theme';
import { fetchUserProfile } from '@/services/api/profile';
import { getUserProfileScopeFromSegments } from '@/features/user/utils/routes';
import { useUserMoments } from '@/features/discover/hooks/use-user-moments';
import { isSameCalendarDay } from '@/features/discover/utils/album-date';
import { MomentAlbumHeader } from '@/features/discover/components/moment-album-header';
import { MomentAlbumRow } from '@/features/discover/components/moment-album-row';
import type { MomentPost } from '@/types';

const s = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingBottom: 80 },
  emptyContainer: { alignItems: 'center', paddingTop: 80, gap: Spacing.md },
  footerLoader: { paddingVertical: Spacing.lg, alignItems: 'center' },
});

export default function UserMomentsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const scope = getUserProfileScopeFromSegments(segments);
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const userId = params.id;

  const { moments, loading, refreshing, hasMore, error, refresh, loadMore } =
    useUserMoments(userId);

  const [cover, setCover] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [nickname, setNickname] = useState<string>(params.name ?? '');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const profile = await fetchUserProfile(userId);
        if (!active) return;
        setCover(profile.cover);
        setAvatarUrl(profile.avatarUrl);
        if (profile.nickname) setNickname(profile.nickname);
      } catch (err) {
        if (__DEV__) {
          console.warn('[UserMomentsScreen] fetchUserProfile failed', err);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const title = nickname
    ? t('moment.albumTitle', { name: nickname })
    : t('moment.albumTitleFallback');

  const handlePress = useCallback(
    (postId: string) => {
      router.push({
        pathname: '/(tabs)/discover/moment/[id]',
        params: { id: postId },
      });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: MomentPost; index: number }) => {
      const showDate =
        index === 0 ||
        !isSameCalendarDay(moments[index - 1].createdAt, item.createdAt);
      return (
        <MomentAlbumRow post={item} showDate={showDate} onPress={handlePress} />
      );
    },
    [moments, handlePress],
  );

  const keyExtractor = useCallback((item: MomentPost) => item.id, []);

  const ListHeader = (
    <MomentAlbumHeader
      coverUrl={cover}
      avatarUrl={avatarUrl}
      nickname={nickname || title}
    />
  );

  const ListEmpty = !loading ? (
    <View style={s.emptyContainer}>
      <Text style={{ color: colors.textSecondary, ...Typography.body }}>
        {error ?? t('discover.noMoments')}
      </Text>
    </View>
  ) : null;

  const ListFooter =
    loading && moments.length > 0 ? (
      <View style={s.footerLoader}>
        <ActivityIndicator color={colors.primary} />
      </View>
    ) : null;

  const handleEndReached = useCallback(() => {
    if (!loading && hasMore) {
      void loadMore();
    }
  }, [loading, hasMore, loadMore]);

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title, headerTransparent: true, headerTitle: '' }} />
      <FlatList
        data={moments}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        contentContainerStyle={s.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.primary}
          />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
node --test test/user-moments-screen.test.js
```
期望：PASS。

- [ ] **Step 6: 提交**

```bash
git add src/features/discover/screens/UserMomentsScreen.tsx src/i18n/locales/en.json src/i18n/locales/zh.json test/user-moments-screen.test.js
git commit -m "feat: add UserMomentsScreen album page"
```

---

## Task F9: 四个 tab 的嵌套路由文件（circle-im）

**Files:**
- Create: `app/(tabs)/discover/user/[id]/moments.tsx`
- Create: `app/(tabs)/profile/user/[id]/moments.tsx`
- Create: `app/(tabs)/contacts/user/[id]/moments.tsx`
- Create: `app/(tabs)/messages/user/[id]/moments.tsx`
- Test: `test/user-moments-routes-files.test.js`

**Interfaces:**
- Consumes: `UserMomentsScreen` 默认导出（F8）
- Produces: 四条路由 `/(tabs)/<scope>/user/[id]/moments`

- [ ] **Step 1: 写失败测试** — 新建 `test/user-moments-routes-files.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const exists = (p) => fs.existsSync(path.join(process.cwd(), p));
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const scopes = ['discover', 'profile', 'contacts', 'messages'];

test('every tab scope has a user/[id]/moments route re-exporting the screen', () => {
  for (const scope of scopes) {
    const p = `app/(tabs)/${scope}/user/[id]/moments.tsx`;
    assert.ok(exists(p), `missing route file: ${p}`);
    assert.match(read(p), /UserMomentsScreen/);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/user-moments-routes-files.test.js
```
期望：FAIL（文件缺失）。

- [ ] **Step 3: 实现** — 四个文件内容都是同一行 re-export（messages 也要建，`messages` scope 用得到）：

`app/(tabs)/discover/user/[id]/moments.tsx`：
```tsx
export { default } from '@/features/discover/screens/UserMomentsScreen';
```
`app/(tabs)/profile/user/[id]/moments.tsx`：
```tsx
export { default } from '@/features/discover/screens/UserMomentsScreen';
```
`app/(tabs)/contacts/user/[id]/moments.tsx`：
```tsx
export { default } from '@/features/discover/screens/UserMomentsScreen';
```
`app/(tabs)/messages/user/[id]/moments.tsx`：
```tsx
export { default } from '@/features/discover/screens/UserMomentsScreen';
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test test/user-moments-routes-files.test.js
```
期望：PASS。

- [ ] **Step 5: 提交**

```bash
git add "app/(tabs)/discover/user/[id]/moments.tsx" "app/(tabs)/profile/user/[id]/moments.tsx" "app/(tabs)/contacts/user/[id]/moments.tsx" "app/(tabs)/messages/user/[id]/moments.tsx" test/user-moments-routes-files.test.js
git commit -m "feat: add user moments routes for all tab stacks"
```

---

## Task F10: 资料页「朋友圈」行接上跳转（circle-im）

**Files:**
- Modify: `src/features/user/screens/UserProfileScreen.tsx`
- Test: `test/user-profile-moments-nav.test.js`

**Interfaces:**
- Consumes: `getUserMomentsHref`（F1）、现有 `scope`/`profileId`/`profile.name`/`router`

- [ ] **Step 1: 写失败测试** — 新建 `test/user-profile-moments-nav.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('UserProfileScreen wires the moments row to the album route', () => {
  const src = read('src/features/user/screens/UserProfileScreen.tsx');
  assert.match(src, /getUserMomentsHref/);
  assert.match(src, /handleOpenMoments/);
  // moments 行带上 onPress
  assert.match(src, /id === 'moments'/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/user-profile-moments-nav.test.js
```
期望：FAIL。

- [ ] **Step 3: 实现** —

(a) 在 `src/features/user/screens/UserProfileScreen.tsx` 顶部 import 区，给现有 `@/features/user/utils/routes` 的 import 加上 `getUserMomentsHref`。该文件已从该模块按需 import 多个函数（如 `getSendFriendRequestHref` 等，见约 26-30 行的 import 块），在其中追加 `getUserMomentsHref`。

(b) 在 `handleEditTags` 回调之后（约 367 行）新增回调：
```ts
  const handleOpenMoments = useCallback(() => {
    if (profileId === 'unknown') {
      return;
    }

    router.push(getUserMomentsHref(scope, profileId, profile.name));
  }, [profile.name, profileId, router, scope]);
```

(c) 在 `infoRowItems` 的 `map` 里（约 419-440 行），`tags` 分支之后、最后的 `return { id, label };` 之前，插入 moments 分支：
```ts
        if (id === 'moments') {
          return {
            id,
            label,
            onPress: handleOpenMoments,
          };
        }
```

(d) 把 `infoRowItems` 的 `useMemo` 依赖数组加上 `handleOpenMoments`：
```ts
    [handleEditRemark, handleEditTags, handleOpenMoments, infoRows, remarkValue, t, tagValue],
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test test/user-profile-moments-nav.test.js
```
期望：PASS。

- [ ] **Step 5: 提交**

```bash
git add src/features/user/screens/UserProfileScreen.tsx test/user-profile-moments-nav.test.js
git commit -m "feat: open user moments album from profile row"
```

---

## Task F11: 全量回归 + 类型检查（circle-im）

**Files:** 无新增（验证关）

- [ ] **Step 1: 跑全部新测试**

```bash
cd /Users/yiboding/projects/circle-im
node --test test/user-moments-routes.test.js test/user-moments-api.test.js test/image-grid-width.test.js test/album-date.test.js test/use-user-moments.test.js test/moment-album-row.test.js test/moment-album-header.test.js test/user-moments-screen.test.js test/user-moments-routes-files.test.js test/user-profile-moments-nav.test.js
```
期望：全部 PASS。

- [ ] **Step 2: TypeScript 类型检查**

```bash
npx tsc --noEmit
```
期望：无新增类型错误（与本功能相关）。若 Expo Router 的 typed-routes 对新路由报错，运行一次 `npx expo customize` 或重启 dev server 让其重新生成 `.expo/types`（也可临时在路由调用处用既有 `as Href` 模式，见 routes.ts 既有写法）。

- [ ] **Step 3: lint**

```bash
npm run lint
```
期望：无新增告警。

- [ ] **Step 4: 提交（如 lint/tsc 触发小修）**

```bash
git add -p   # 仅本功能相关改动
git commit -m "chore: typecheck + lint fixes for user moments album"
```

---

## Self-Review 检查（计划作者已核对）

- **Spec 覆盖**：①入口接线 → F10 ②封面 header → F7 ③相册列表/日期分组 → F6+F4+F8 ④数据 authorId → B1+F2 ⑤主题 token → 全组件 Global Constraint + 测试断言无硬编码色值 ⑥分页/刷新 → F5+F8 ⑦i18n → F8 ⑧九宫格复用 → F3。✔ 全覆盖。
- **占位符**：无 TBD/TODO；每步含真实代码与命令。（B1 Step 2 里 `assert: void 0;` 已显式标注删除。）
- **类型一致**：`fetchUserMoments`、`useUserMoments`、`getUserMomentsHref`、`getAlbumDateParts`、`isSameCalendarDay`、`MomentAlbumRow`/`MomentAlbumHeader` props 在产出处与消费处签名一致。
- **依赖顺序**：B1 独立；F1→F10 消费，F2→F5 消费，F3/F4→F6 消费，F5/F6/F7→F8 消费，F8→F9 消费。顺序无环。
