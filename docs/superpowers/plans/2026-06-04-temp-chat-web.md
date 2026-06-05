# 临时聊天 · 访客网页（temp-chat-web）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现访客在浏览器打开分享链接 → 不下载不注册 → 进入临时聊天房间收发文字/图片、看成员与倒计时的网页（`temp-chat-web`）。

**Architecture:** 独立 Vite + React + TS 单页应用，单路由 `/t/:token` 按状态机渲染（Loading/Landing/Chat/Ended/Invalid）。网络/SDK 逻辑收在 `lib/` + `hooks/`，UI 是纯展示组件。OpenIM Web SDK 藏在 `lib/openim.ts` 的 `OpenImClient` 接口后面，hooks/组件对接口编程，因此可用假实现单测。

**Tech Stack:** Vite、React 18、TypeScript、react-router-dom、`@openim/client-sdk`、Vitest + @testing-library/react + jsdom。

**对应 spec：** [`docs/superpowers/specs/2026-06-04-temp-chat-web-design.md`](../specs/2026-06-04-temp-chat-web-design.md)

**工程位置：** 新建 `/Users/yiboding/projects/temp-chat-web`（circle-im / circle_be 的同级目录）。下文命令默认 `cd /Users/yiboding/projects/temp-chat-web`。

---

## 文件结构

```
temp-chat-web/
├── index.html
├── package.json  vite.config.ts  tsconfig.json
├── .env.example
└── src/
    ├── main.tsx                       # 挂载 + Router
    ├── App.tsx                        # /t/:token → 状态机分发
    ├── constants/theme.ts             # 设计 token
    ├── types/index.ts                 # Message/Member/RoomMeta/GuestCreds/RoomState
    ├── lib/
    │   ├── api.ts                     # meta/join + 错误归类
    │   ├── roomState.ts               # deriveRoomState(meta|error) 纯函数
    │   ├── guestStorage.ts            # sessionStorage 缓存
    │   ├── avatar.ts                  # 昵称→首字+配色
    │   ├── countdown.ts               # formatCountdown(ms)
    │   ├── openimTypes.ts             # OpenImClient 接口 + RawMessage→Message 映射
    │   └── openim.ts                  # 真·SDK 适配（实现 OpenImClient）
    ├── hooks/
    │   ├── useRoomMeta.ts
    │   ├── useGuestSession.ts
    │   ├── useOpenIM.ts
    │   └── useCountdown.ts
    └── features/temp-chat/
        ├── LandingScreen.tsx
        ├── StatusScreen.tsx
        ├── ChatScreen.tsx
        └── components/
            ├── Avatar.tsx  ChatHeader.tsx  MessageList.tsx
            ├── MessageBubble.tsx  Composer.tsx  MemberSheet.tsx
```

测试与被测同目录（`*.test.ts(x)`）。运行：`npx vitest run <path>`（单文件）/ `npm test`（全量）。

---

## Task 1: 脚手架 + 工具链 + 设计 token + 类型

**Files:** Create 整个工程骨架。

- [ ] **Step 1: 用 Vite 创建工程**

```bash
cd /Users/yiboding/projects
npm create vite@latest temp-chat-web -- --template react-ts
cd temp-chat-web && npm install
```
Expected: 生成 React-TS 骨架，`npm install` 成功。

- [ ] **Step 2: 装依赖**

```bash
cd /Users/yiboding/projects/temp-chat-web
npm i react-router-dom @openim/client-sdk
npm i -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 3: 配置 Vitest（vite.config.ts）**

将 `vite.config.ts` 改为：
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
});
```
创建 `src/test-setup.ts`：
```ts
import '@testing-library/jest-dom';
```
在 `package.json` 的 `scripts` 加：`"test": "vitest run"`。

- [ ] **Step 4: 设计 token（src/constants/theme.ts）**

```ts
export const Colors = {
  bg: '#1A1B23',
  bgDeep: '#11121A',
  surface: '#252630',
  surfaceAlt: '#2E2F38',
  border: '#3A3B45',
  primary: '#6366F1',
  primarySoft: 'rgba(99,102,241,0.15)',
  text: '#FFFFFF',
  textDim: '#9CA3AF',
  textMuted: '#6B7280',
  danger: '#FF6B6B',
  success: '#22C55E',
  // 头像配色池（确定性取色用）
  avatarPalette: ['#6366F1', '#22C55E', '#FB8C00', '#3B82F6', '#FF6B6B', '#F97316'],
} as const;

export const Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
```

- [ ] **Step 5: 领域类型（src/types/index.ts）**

```ts
export interface RoomMeta {
  title: string;
  memberCount: number;
  maxMembers: number;
  status: 'ACTIVE' | 'ENDED' | 'EXPIRED';
  expiresAt: string;
  full: boolean;
}

export interface GuestCreds {
  imUserId: string;
  imToken: string;
  groupId: string;
  wsUrl: string;
  apiUrl: string;
  displayName: string;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  kind: 'text' | 'image';
  text?: string;
  imageUrl?: string;
  sentAt: number;
  isSelf: boolean;
}

export interface Member {
  imUserId: string;
  name: string;
  isOwner: boolean;
  isSelf: boolean;
}

export type RoomState =
  | { kind: 'loading' }
  | { kind: 'landing'; meta: RoomMeta }
  | { kind: 'full'; meta: RoomMeta }
  | { kind: 'chat'; creds: GuestCreds }
  | { kind: 'ended' }
  | { kind: 'invalid' };
```

- [ ] **Step 6: 冒烟测试（src/constants/theme.test.ts）**

```ts
import { describe, it, expect } from 'vitest';
import { Colors } from './theme';

describe('theme', () => {
  it('exposes primary indigo and an avatar palette', () => {
    expect(Colors.primary).toBe('#6366F1');
    expect(Colors.avatarPalette.length).toBeGreaterThan(3);
  });
});
```

- [ ] **Step 7: 跑测试 + 构建**

```bash
cd /Users/yiboding/projects/temp-chat-web && npm test && npm run build
```
Expected: 测试通过，`vite build` 成功。

- [ ] **Step 8: Commit**

```bash
cd /Users/yiboding/projects/temp-chat-web
git init -q && git add -A
git commit -q -m "chore: scaffold temp-chat-web (vite+react+ts+vitest), theme tokens, domain types"
```

---

## Task 2: avatar.ts — 首字 + 确定性配色

**Files:** Create `src/lib/avatar.ts` + `src/lib/avatar.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { avatarInitial, avatarColor } from './avatar';

describe('avatar', () => {
  it('takes the first visible character as the initial', () => {
    expect(avatarInitial('小明')).toBe('小');
    expect(avatarInitial('Lily')).toBe('L');
    expect(avatarInitial('  ')).toBe('?');
    expect(avatarInitial('')).toBe('?');
  });
  it('maps the same name to the same color deterministically', () => {
    expect(avatarColor('小明')).toBe(avatarColor('小明'));
  });
  it('returns a color from the palette', () => {
    const c = avatarColor('访客3927');
    expect(c).toMatch(/^#/);
  });
});
```

- [ ] **Step 2: 跑，确认失败** — `npx vitest run src/lib/avatar.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
import { Colors } from '../constants/theme';

export function avatarInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? Array.from(trimmed)[0] : '?';
}

export function avatarColor(name: string): string {
  const palette = Colors.avatarPalette;
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return palette[hash % palette.length];
}
```

- [ ] **Step 4: 跑，确认通过** — `npx vitest run src/lib/avatar.test.ts` → 3 passed。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/temp-chat-web
git add src/lib/avatar.ts src/lib/avatar.test.ts
git commit -q -m "feat: deterministic initial+color avatar util"
```

---

## Task 3: countdown.ts — 倒计时文案

**Files:** Create `src/lib/countdown.ts` + `src/lib/countdown.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { formatCountdown } from './countdown';

describe('formatCountdown', () => {
  it('shows days+hours when over a day', () => {
    expect(formatCountdown((2 * 24 + 14) * 3600 * 1000)).toBe('剩 2天14时');
  });
  it('shows H:MM:SS under a day', () => {
    expect(formatCountdown((3 * 3600 + 5 * 60 + 9) * 1000)).toBe('剩 3:05:09');
  });
  it('returns null at or below zero (expired)', () => {
    expect(formatCountdown(0)).toBeNull();
    expect(formatCountdown(-5000)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑，确认失败** — `npx vitest run src/lib/countdown.test.ts` → FAIL。

- [ ] **Step 3: 实现**

```ts
/** 返回展示文案；<=0 返回 null（表示已过期）。 */
export function formatCountdown(remainingMs: number): string | null {
  if (remainingMs <= 0) return null;
  const totalSec = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  if (days >= 1) return `剩 ${days}天${hours}时`;
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return `剩 ${hours}:${mm}:${ss}`;
}
```

- [ ] **Step 4: 跑，确认通过** — 3 passed。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/temp-chat-web
git add src/lib/countdown.ts src/lib/countdown.test.ts
git commit -q -m "feat: countdown formatter"
```

---

## Task 4: guestStorage.ts — 访客凭证缓存

**Files:** Create `src/lib/guestStorage.ts` + `src/lib/guestStorage.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { saveGuest, loadGuest, clearGuest } from './guestStorage';
import type { GuestCreds } from '../types';

const creds: GuestCreds = {
  imUserId: 'g1', imToken: 't', groupId: 'tmpA',
  wsUrl: 'ws://x', apiUrl: 'http://x', displayName: '访客1',
};

describe('guestStorage', () => {
  beforeEach(() => sessionStorage.clear());

  it('round-trips creds per token', () => {
    saveGuest('tok', creds);
    expect(loadGuest('tok')).toEqual(creds);
  });
  it('isolates by token', () => {
    saveGuest('tok', creds);
    expect(loadGuest('other')).toBeNull();
  });
  it('clears', () => {
    saveGuest('tok', creds);
    clearGuest('tok');
    expect(loadGuest('tok')).toBeNull();
  });
  it('returns null on corrupt json', () => {
    sessionStorage.setItem('tc:tok', '{bad');
    expect(loadGuest('tok')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑，确认失败** — FAIL。

- [ ] **Step 3: 实现**

```ts
import type { GuestCreds } from '../types';

const key = (token: string) => `tc:${token}`;

export function saveGuest(token: string, creds: GuestCreds): void {
  sessionStorage.setItem(key(token), JSON.stringify(creds));
}

export function loadGuest(token: string): GuestCreds | null {
  const raw = sessionStorage.getItem(key(token));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GuestCreds;
  } catch {
    return null;
  }
}

export function clearGuest(token: string): void {
  sessionStorage.removeItem(key(token));
}
```

- [ ] **Step 4: 跑，确认通过** — 4 passed。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/temp-chat-web
git add src/lib/guestStorage.ts src/lib/guestStorage.test.ts
git commit -q -m "feat: sessionStorage guest creds cache"
```

---

## Task 5: api.ts — meta/join + 错误归类

**Files:** Create `src/lib/api.ts` + `src/lib/api.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchMeta, joinRoom, ApiError } from './api';

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
const err = (status: number) => ({ ok: false, status, json: async () => ({}) });

describe('api', () => {
  beforeEach(() => { (globalThis as any).fetch = vi.fn(); vi.stubEnv('VITE_API_BASE', 'http://be'); });

  it('fetchMeta returns parsed meta', async () => {
    (fetch as any).mockResolvedValue(ok({ title: 'X', memberCount: 2, maxMembers: 50, status: 'ACTIVE', expiresAt: 'z', full: false }));
    const m = await fetchMeta('tok');
    expect(m.title).toBe('X');
    expect((fetch as any).mock.calls[0][0]).toBe('http://be/temp-chat/by-token/tok/meta');
  });

  it('classifies 404 as invalid', async () => {
    (fetch as any).mockResolvedValue(err(404));
    await expect(fetchMeta('tok')).rejects.toMatchObject({ kind: 'invalid' } as Partial<ApiError>);
  });
  it('classifies 410 as ended', async () => {
    (fetch as any).mockResolvedValue(err(410));
    await expect(fetchMeta('tok')).rejects.toMatchObject({ kind: 'ended' });
  });
  it('joinRoom posts displayName and returns creds', async () => {
    (fetch as any).mockResolvedValue(ok({ imUserId: 'g', imToken: 't', groupId: 'tmpA', wsUrl: 'w', apiUrl: 'a', displayName: '访客1' }));
    const c = await joinRoom('tok', '小明');
    expect(c.imUserId).toBe('g');
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body).toEqual({ displayName: '小明' });
  });
  it('classifies 409 join as full', async () => {
    (fetch as any).mockResolvedValue(err(409));
    await expect(joinRoom('tok')).rejects.toMatchObject({ kind: 'full' });
  });
});
```

- [ ] **Step 2: 跑，确认失败** — FAIL。

- [ ] **Step 3: 实现**

```ts
import type { GuestCreds, RoomMeta } from '../types';

export type ApiErrorKind = 'invalid' | 'ended' | 'full' | 'network' | 'unknown';

export class ApiError extends Error {
  constructor(public kind: ApiErrorKind, public status?: number) {
    super(kind);
    this.name = 'ApiError';
  }
}

const base = (): string => import.meta.env.VITE_API_BASE ?? '';

function classify(status: number): ApiErrorKind {
  if (status === 404) return 'invalid';
  if (status === 410) return 'ended';
  if (status === 409) return 'full';
  return 'unknown';
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network');
  }
  if (!res.ok) throw new ApiError(classify(res.status), res.status);
  return (await res.json()) as T;
}

export function fetchMeta(token: string): Promise<RoomMeta> {
  return post<RoomMeta>(`/temp-chat/by-token/${token}/meta`);
}

export function joinRoom(token: string, displayName?: string): Promise<GuestCreds> {
  return post<GuestCreds>(`/temp-chat/by-token/${token}/join`, { displayName });
}
```

- [ ] **Step 4: 跑，确认通过** — 5 passed。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/temp-chat-web
git add src/lib/api.ts src/lib/api.test.ts
git commit -q -m "feat: backend api client with error classification"
```

---

## Task 6: roomState.ts — 状态机映射（纯函数）

**Files:** Create `src/lib/roomState.ts` + `src/lib/roomState.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { deriveRoomStateFromMeta, deriveRoomStateFromError } from './roomState';
import type { RoomMeta } from '../types';
import { ApiError } from './api';

const meta = (o: Partial<RoomMeta> = {}): RoomMeta => ({
  title: 'X', memberCount: 2, maxMembers: 50, status: 'ACTIVE', expiresAt: 'z', full: false, ...o,
});

describe('deriveRoomStateFromMeta', () => {
  it('active + not full → landing', () => {
    expect(deriveRoomStateFromMeta(meta()).kind).toBe('landing');
  });
  it('active + full → full', () => {
    expect(deriveRoomStateFromMeta(meta({ full: true })).kind).toBe('full');
  });
  it('ended/expired → ended', () => {
    expect(deriveRoomStateFromMeta(meta({ status: 'ENDED' })).kind).toBe('ended');
    expect(deriveRoomStateFromMeta(meta({ status: 'EXPIRED' })).kind).toBe('ended');
  });
});

describe('deriveRoomStateFromError', () => {
  it('invalid → invalid', () => {
    expect(deriveRoomStateFromError(new ApiError('invalid')).kind).toBe('invalid');
  });
  it('ended → ended; full → full(meta-less fallback)', () => {
    expect(deriveRoomStateFromError(new ApiError('ended')).kind).toBe('ended');
    expect(deriveRoomStateFromError(new ApiError('full')).kind).toBe('invalid');
  });
});
```

- [ ] **Step 2: 跑，确认失败** — FAIL。

- [ ] **Step 3: 实现**

```ts
import type { RoomMeta, RoomState } from '../types';
import { ApiError } from './api';

export function deriveRoomStateFromMeta(meta: RoomMeta): RoomState {
  if (meta.status !== 'ACTIVE') return { kind: 'ended' };
  if (meta.full) return { kind: 'full', meta };
  return { kind: 'landing', meta };
}

export function deriveRoomStateFromError(err: unknown): RoomState {
  if (err instanceof ApiError) {
    if (err.kind === 'ended') return { kind: 'ended' };
    // invalid / full(无 meta 时无法进房) / network / unknown → 失效页
    return { kind: 'invalid' };
  }
  return { kind: 'invalid' };
}
```

- [ ] **Step 4: 跑，确认通过** — 5 passed。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/temp-chat-web
git add src/lib/roomState.ts src/lib/roomState.test.ts
git commit -q -m "feat: room state machine mapping"
```

---

## Task 7: openimTypes.ts — OpenImClient 接口 + 消息映射

定义 hooks 依赖的接口，并 TDD「SDK 原始消息 → 领域 Message」的映射（纯函数）。真实 SDK 适配在 Task 8。

**Files:** Create `src/lib/openimTypes.ts` + `src/lib/openimTypes.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { toMessage } from './openimTypes';

const raw = {
  clientMsgID: 'm1', sendID: 'g9', senderNickname: '访客9',
  contentType: 101, textElem: { content: '你好' }, sendTime: 1700,
};

describe('toMessage', () => {
  it('maps a text message and flags self', () => {
    const m = toMessage(raw, 'g9');
    expect(m).toMatchObject({ id: 'm1', senderId: 'g9', senderName: '访客9', kind: 'text', text: '你好', isSelf: true });
  });
  it('maps an image message', () => {
    const img = { clientMsgID: 'm2', sendID: 'g1', senderNickname: 'A', contentType: 102, pictureElem: { sourcePicture: { url: 'http://img' } }, sendTime: 1800 };
    const m = toMessage(img, 'g9');
    expect(m).toMatchObject({ kind: 'image', imageUrl: 'http://img', isSelf: false });
  });
});
```

- [ ] **Step 2: 跑，确认失败** — FAIL。

- [ ] **Step 3: 实现**

```ts
import type { Message } from '../types';

/** OpenIM 原始消息（只取我们用到的字段；不同版本字段名以官方为准）。 */
export interface RawMessage {
  clientMsgID: string;
  sendID: string;
  senderNickname?: string;
  contentType: number; // 101 文本, 102 图片（OpenIM 约定）
  textElem?: { content: string };
  pictureElem?: { sourcePicture?: { url: string } };
  sendTime: number;
}

export const MessageContentType = { Text: 101, Picture: 102 } as const;

export function toMessage(raw: RawMessage, selfId: string): Message {
  const isImage = raw.contentType === MessageContentType.Picture;
  return {
    id: raw.clientMsgID,
    senderId: raw.sendID,
    senderName: raw.senderNickname ?? raw.sendID,
    kind: isImage ? 'image' : 'text',
    text: raw.textElem?.content,
    imageUrl: raw.pictureElem?.sourcePicture?.url,
    sentAt: raw.sendTime,
    isSelf: raw.sendID === selfId,
  };
}

/** hooks/组件依赖的抽象客户端（真实现见 openim.ts；测试用假实现）。 */
export interface OpenImClient {
  connect(creds: import('../types').GuestCreds): Promise<void>;
  loadHistory(groupId: string): Promise<Message[]>;
  onMessage(cb: (m: Message) => void): () => void;   // 返回取消订阅
  onRoomDismissed(cb: () => void): () => void;
  loadMembers(groupId: string): Promise<import('../types').Member[]>;
  sendText(groupId: string, text: string): Promise<Message>;
  sendImage(groupId: string, file: File): Promise<Message>;
  disconnect(): Promise<void>;
}
```

- [ ] **Step 4: 跑，确认通过** — 2 passed。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/temp-chat-web
git add src/lib/openimTypes.ts src/lib/openimTypes.test.ts
git commit -q -m "feat: OpenImClient interface + raw→domain message mapping"
```

---

## Task 8: openim.ts — 真·SDK 适配（实现 OpenImClient）

> ⚠️ **版本敏感**：`@openim/client-sdk` 的精确方法/事件名随版本不同。本任务对照**已安装版本**的文档实现下列接口方法；映射逻辑已在 Task 7 测过。本文件不写单测（连真 SDK），由 Task 9–13 的 hook/组件用假实现覆盖逻辑，最终人工联调验证。

**Files:** Create `src/lib/openim.ts`

- [ ] **Step 1: 实现 OpenImClient（按接口逐方法对接 SDK）**

```ts
import { getSDK } from '@openim/client-sdk';
import type { GuestCreds, Member, Message } from '../types';
import { toMessage, type RawMessage, type OpenImClient, MessageContentType } from './openimTypes';

// getSDK 通常需要 wasm 资源路径；按安装版本文档配置（见 README）。
export function createOpenImClient(): OpenImClient {
  const sdk = getSDK();
  let selfId = '';

  return {
    async connect(creds: GuestCreds) {
      selfId = creds.imUserId;
      await sdk.login({
        userID: creds.imUserId,
        token: creds.imToken,
        platformID: 5, // Web
        apiAddr: creds.apiUrl,
        wsAddr: creds.wsUrl,
      });
    },
    async loadHistory(groupId: string): Promise<Message[]> {
      const res: any = await sdk.getAdvancedHistoryMessageList({
        groupID: groupId,
        count: 50,
        startClientMsgID: '',
      });
      const list: RawMessage[] = res?.data?.messageList ?? res?.messageList ?? [];
      return list.map((m) => toMessage(m, selfId));
    },
    onMessage(cb) {
      const handler = (data: any) => {
        const list: RawMessage[] = Array.isArray(data?.data) ? data.data : [data?.data];
        for (const raw of list) if (raw) cb(toMessage(raw, selfId));
      };
      sdk.on('OnRecvNewMessages', handler);
      return () => sdk.off('OnRecvNewMessages', handler);
    },
    onRoomDismissed(cb) {
      const handler = () => cb();
      // 群被解散/自己被移出群 → 房间结束（事件名按版本核对）
      sdk.on('OnJoinedGroupDeleted', handler);
      return () => sdk.off('OnJoinedGroupDeleted', handler);
    },
    async loadMembers(groupId: string): Promise<Member[]> {
      const res: any = await sdk.getGroupMemberList({ groupID: groupId, filter: 0, offset: 0, count: 100 });
      const list: any[] = res?.data ?? res ?? [];
      return list.map((mem) => ({
        imUserId: mem.userID,
        name: mem.nickname ?? mem.userID,
        isOwner: mem.roleLevel >= 100, // OpenIM: 群主 roleLevel 高
        isSelf: mem.userID === selfId,
      }));
    },
    async sendText(groupId: string, text: string): Promise<Message> {
      const msg: any = await sdk.createTextMessage(text);
      const sent: any = await sdk.sendMessage({ recvID: '', groupID: groupId, message: msg });
      return toMessage((sent?.data ?? sent) as RawMessage, selfId);
    },
    async sendImage(groupId: string, file: File): Promise<Message> {
      // createImageMessageByFile：SDK 内部上传到 OpenIM 对象存储
      const msg: any = await sdk.createImageMessageByFile(file);
      const sent: any = await sdk.sendMessage({ recvID: '', groupID: groupId, message: msg });
      return toMessage((sent?.data ?? sent) as RawMessage, selfId);
    },
    async disconnect() {
      try { await sdk.logout(); } catch { /* best-effort */ }
    },
  };
}
```

- [ ] **Step 2: 类型检查通过** — `cd /Users/yiboding/projects/temp-chat-web && npx tsc --noEmit`（若 SDK 类型与上述调用不符，按安装版本调整字段名/签名，保持 `OpenImClient` 接口不变）。Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/yiboding/projects/temp-chat-web
git add src/lib/openim.ts
git commit -q -m "feat: real OpenIM web SDK adapter implementing OpenImClient"
```

---

## Task 9: useGuestSession — join 或复用缓存

**Files:** Create `src/hooks/useGuestSession.ts` + `src/hooks/useGuestSession.test.tsx`

- [ ] **Step 1: 失败测试**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGuestSession } from './useGuestSession';
import * as api from '../lib/api';
import * as store from '../lib/guestStorage';
import type { GuestCreds } from '../types';

const creds: GuestCreds = { imUserId: 'g', imToken: 't', groupId: 'tmpA', wsUrl: 'w', apiUrl: 'a', displayName: '访客1' };

describe('useGuestSession', () => {
  beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

  it('reuses cached creds without calling join', async () => {
    store.saveGuest('tok', creds);
    const joinSpy = vi.spyOn(api, 'joinRoom');
    const { result } = renderHook(() => useGuestSession('tok'));
    await waitFor(() => expect(result.current.creds).toEqual(creds));
    expect(joinSpy).not.toHaveBeenCalled();
  });

  it('join() calls api, caches, exposes creds', async () => {
    vi.spyOn(api, 'joinRoom').mockResolvedValue(creds);
    const { result } = renderHook(() => useGuestSession('tok'));
    await act(async () => { await result.current.join('小明'); });
    expect(result.current.creds).toEqual(creds);
    expect(store.loadGuest('tok')).toEqual(creds);
  });
});
```

- [ ] **Step 2: 跑，确认失败** — FAIL。

- [ ] **Step 3: 实现**

```ts
import { useCallback, useEffect, useState } from 'react';
import { joinRoom } from '../lib/api';
import { loadGuest, saveGuest } from '../lib/guestStorage';
import type { GuestCreds } from '../types';

export function useGuestSession(token: string) {
  const [creds, setCreds] = useState<GuestCreds | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const cached = loadGuest(token);
    if (cached) setCreds(cached);
  }, [token]);

  const join = useCallback(
    async (displayName?: string) => {
      setJoining(true);
      setError(null);
      try {
        const c = await joinRoom(token, displayName);
        saveGuest(token, c);
        setCreds(c);
        return c;
      } catch (e) {
        setError(e);
        throw e;
      } finally {
        setJoining(false);
      }
    },
    [token],
  );

  return { creds, joining, error, join };
}
```

- [ ] **Step 4: 跑，确认通过** — 2 passed。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/temp-chat-web
git add src/hooks/useGuestSession.ts src/hooks/useGuestSession.test.tsx
git commit -q -m "feat: useGuestSession (join or reuse cache)"
```

---

## Task 10: useRoomMeta + useCountdown

**Files:** Create `src/hooks/useRoomMeta.ts`, `src/hooks/useCountdown.ts` + 各自 `.test.tsx`

- [ ] **Step 1: 失败测试（useRoomMeta）** — `src/hooks/useRoomMeta.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRoomMeta } from './useRoomMeta';
import * as api from '../lib/api';

describe('useRoomMeta', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('active → landing state', async () => {
    vi.spyOn(api, 'fetchMeta').mockResolvedValue({ title: 'X', memberCount: 1, maxMembers: 50, status: 'ACTIVE', expiresAt: 'z', full: false });
    const { result } = renderHook(() => useRoomMeta('tok'));
    await waitFor(() => expect(result.current.state.kind).toBe('landing'));
  });
  it('404 → invalid', async () => {
    vi.spyOn(api, 'fetchMeta').mockRejectedValue(new api.ApiError('invalid', 404));
    const { result } = renderHook(() => useRoomMeta('tok'));
    await waitFor(() => expect(result.current.state.kind).toBe('invalid'));
  });
});
```

- [ ] **Step 2: 失败测试（useCountdown）** — `src/hooks/useCountdown.test.tsx`

```tsx
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCountdown } from './useCountdown';

describe('useCountdown', () => {
  it('formats a future time and is non-null', () => {
    const future = new Date(Date.now() + (2 * 24 + 14) * 3600 * 1000).toISOString();
    const { result } = renderHook(() => useCountdown(future));
    expect(result.current.label).toMatch(/^剩 \d+天/);
    expect(result.current.expired).toBe(false);
  });
  it('past time → expired', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const { result } = renderHook(() => useCountdown(past));
    expect(result.current.expired).toBe(true);
  });
});
```

- [ ] **Step 3: 跑，确认失败** — 两个文件 FAIL。

- [ ] **Step 4: 实现 useRoomMeta** — `src/hooks/useRoomMeta.ts`

```ts
import { useEffect, useState } from 'react';
import { fetchMeta } from '../lib/api';
import { deriveRoomStateFromError, deriveRoomStateFromMeta } from '../lib/roomState';
import type { RoomState } from '../types';

export function useRoomMeta(token: string) {
  const [state, setState] = useState<RoomState>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    fetchMeta(token)
      .then((meta) => alive && setState(deriveRoomStateFromMeta(meta)))
      .catch((err) => alive && setState(deriveRoomStateFromError(err)));
    return () => { alive = false; };
  }, [token]);

  return { state, setState };
}
```

- [ ] **Step 5: 实现 useCountdown** — `src/hooks/useCountdown.ts`

```ts
import { useEffect, useState } from 'react';
import { formatCountdown } from '../lib/countdown';

export function useCountdown(expiresAtIso: string) {
  const compute = () => formatCountdown(new Date(expiresAtIso).getTime() - Date.now());
  const [label, setLabel] = useState<string | null>(compute);

  useEffect(() => {
    const id = setInterval(() => setLabel(compute()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAtIso]);

  return { label: label ?? '已结束', expired: label === null };
}
```

- [ ] **Step 6: 跑，确认通过** — 两文件全过。

- [ ] **Step 7: Commit**

```bash
cd /Users/yiboding/projects/temp-chat-web
git add src/hooks/useRoomMeta.ts src/hooks/useRoomMeta.test.tsx src/hooks/useCountdown.ts src/hooks/useCountdown.test.tsx
git commit -q -m "feat: useRoomMeta + useCountdown hooks"
```

---

## Task 11: useOpenIM — 连接/历史/实时/销毁（依赖 OpenImClient 假实现可测）

**Files:** Create `src/hooks/useOpenIM.ts` + `src/hooks/useOpenIM.test.tsx`

- [ ] **Step 1: 失败测试（用假 client）**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOpenIM } from './useOpenIM';
import type { OpenImClient } from '../lib/openimTypes';
import type { GuestCreds, Message } from '../types';

const creds: GuestCreds = { imUserId: 'g', imToken: 't', groupId: 'tmpA', wsUrl: 'w', apiUrl: 'a', displayName: '我' };
const msg = (id: string): Message => ({ id, senderId: 'x', senderName: 'X', kind: 'text', text: id, sentAt: 1, isSelf: false });

function fakeClient(over: Partial<OpenImClient> = {}): OpenImClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    loadHistory: vi.fn().mockResolvedValue([msg('h1')]),
    onMessage: vi.fn().mockReturnValue(() => {}),
    onRoomDismissed: vi.fn().mockReturnValue(() => {}),
    loadMembers: vi.fn().mockResolvedValue([]),
    sendText: vi.fn().mockResolvedValue(msg('s1')),
    sendImage: vi.fn().mockResolvedValue(msg('i1')),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('useOpenIM', () => {
  it('connects and loads history', async () => {
    const { result } = renderHook(() => useOpenIM(creds, fakeClient()));
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(['h1']));
  });

  it('appends realtime messages', async () => {
    let push: (m: Message) => void = () => {};
    const client = fakeClient({ onMessage: (cb) => { push = cb; return () => {}; } });
    const { result } = renderHook(() => useOpenIM(creds, client));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    act(() => push(msg('rt')));
    expect(result.current.messages.map((m) => m.id)).toContain('rt');
  });

  it('flags dismissed when room torn down', async () => {
    let dismiss = () => {};
    const client = fakeClient({ onRoomDismissed: (cb) => { dismiss = cb; return () => {}; } });
    const { result } = renderHook(() => useOpenIM(creds, client));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => dismiss());
    expect(result.current.dismissed).toBe(true);
  });

  it('sendText appends the sent message', async () => {
    const { result } = renderHook(() => useOpenIM(creds, fakeClient()));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.sendText('hi'); });
    expect(result.current.messages.map((m) => m.id)).toContain('s1');
  });
});
```

- [ ] **Step 2: 跑，确认失败** — FAIL。

- [ ] **Step 3: 实现**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpenImClient } from '../lib/openimTypes';
import type { GuestCreds, Message } from '../types';

export function useOpenIM(creds: GuestCreds, client: OpenImClient) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const clientRef = useRef(client);

  const append = useCallback((m: Message) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }, []);

  useEffect(() => {
    const c = clientRef.current;
    let offMsg = () => {};
    let offDismiss = () => {};
    let alive = true;

    (async () => {
      await c.connect(creds);
      offMsg = c.onMessage(append);
      offDismiss = c.onRoomDismissed(() => setDismissed(true));
      const history = await c.loadHistory(creds.groupId);
      if (alive) {
        setMessages(history);
        setReady(true);
      }
    })();

    return () => {
      alive = false;
      offMsg();
      offDismiss();
      c.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds.imUserId, creds.groupId]);

  const sendText = useCallback(
    async (text: string) => {
      const m = await clientRef.current.sendText(creds.groupId, text);
      append(m);
    },
    [creds.groupId, append],
  );

  const sendImage = useCallback(
    async (file: File) => {
      const m = await clientRef.current.sendImage(creds.groupId, file);
      append(m);
    },
    [creds.groupId, append],
  );

  return { messages, ready, dismissed, sendText, sendImage };
}
```

- [ ] **Step 4: 跑，确认通过** — 4 passed。

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/temp-chat-web
git add src/hooks/useOpenIM.ts src/hooks/useOpenIM.test.tsx
git commit -q -m "feat: useOpenIM (connect/history/realtime/dismiss/send)"
```

---

## Task 12: 展示组件 — Avatar / MessageBubble / Composer

**Files:** Create `src/features/temp-chat/components/{Avatar,MessageBubble,Composer}.tsx` + 测试

- [ ] **Step 1: 失败测试** — `src/features/temp-chat/components/Composer.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Composer } from './Composer';

describe('Composer', () => {
  it('disables send on empty/whitespace text', () => {
    render(<Composer onSendText={vi.fn()} onSendImage={vi.fn()} />);
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });
  it('sends trimmed text and clears', () => {
    const onSendText = vi.fn();
    render(<Composer onSendText={onSendText} onSendImage={vi.fn()} />);
    const input = screen.getByPlaceholderText('说点什么…');
    fireEvent.change(input, { target: { value: '  你好  ' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(onSendText).toHaveBeenCalledWith('你好');
    expect((input as HTMLInputElement).value).toBe('');
  });
  it('forwards a picked image file', () => {
    const onSendImage = vi.fn();
    render(<Composer onSendText={vi.fn()} onSendImage={onSendImage} />);
    const file = new File(['x'], 'p.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('image-input'), { target: { files: [file] } });
    expect(onSendImage).toHaveBeenCalledWith(file);
  });
});
```

- [ ] **Step 2: 跑，确认失败** — FAIL。

- [ ] **Step 3: 实现 Avatar** — `src/features/temp-chat/components/Avatar.tsx`

```tsx
import { avatarColor, avatarInitial } from '../../../lib/avatar';

interface AvatarProps { name: string; size?: number; }

export function Avatar({ name, size = 34 }: AvatarProps) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: avatarColor(name), color: '#fff', fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42,
    }}>
      {avatarInitial(name)}
    </div>
  );
}
```

- [ ] **Step 4: 实现 MessageBubble** — `src/features/temp-chat/components/MessageBubble.tsx`

```tsx
import { Colors } from '../../../constants/theme';
import type { Message } from '../../../types';
import { Avatar } from './Avatar';

export function MessageBubble({ message }: { message: Message }) {
  const self = message.isSelf;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: self ? 'flex-end' : 'flex-start', maxWidth: '78%', alignSelf: self ? 'flex-end' : 'flex-start' }}>
      {!self && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 3px 4px' }}>
          <Avatar name={message.senderName} size={18} />
          <span style={{ fontSize: 10, color: Colors.textDim }}>{message.senderName}</span>
        </div>
      )}
      <div style={{
        background: self ? Colors.primary : Colors.surfaceAlt,
        color: self ? '#fff' : '#E5E7EB',
        padding: message.kind === 'image' ? 6 : '8px 11px',
        borderRadius: 14,
        borderTopLeftRadius: self ? 14 : 4,
        borderTopRightRadius: self ? 4 : 14,
        fontSize: 13,
      }}>
        {message.kind === 'image'
          ? <img src={message.imageUrl} alt="" style={{ maxWidth: 200, borderRadius: 9, display: 'block' }} />
          : message.text}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 实现 Composer** — `src/features/temp-chat/components/Composer.tsx`

```tsx
import { useRef, useState } from 'react';
import { Colors } from '../../../constants/theme';

interface ComposerProps {
  onSendText: (text: string) => void;
  onSendImage: (file: File) => void;
}

export function Composer({ onSendText, onSendImage }: ComposerProps) {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const trimmed = text.trim();

  const send = () => { if (trimmed) { onSendText(trimmed); setText(''); } };

  return (
    <div style={{ background: Colors.surface, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 9 }}>
      <button aria-label="图片" onClick={() => fileRef.current?.click()} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}>🖼️</button>
      <input
        data-testid="image-input" ref={fileRef} type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onSendImage(f); e.target.value = ''; }}
      />
      <input
        placeholder="说点什么…" value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        style={{ flex: 1, background: Colors.bg, border: 'none', borderRadius: 16, padding: '7px 12px', color: '#fff', fontSize: 13, outline: 'none' }}
      />
      <button aria-label="发送" disabled={!trimmed} onClick={send}
        style={{ background: trimmed ? Colors.primary : Colors.surfaceAlt, color: '#fff', width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: trimmed ? 'pointer' : 'default' }}>➤</button>
    </div>
  );
}
```

- [ ] **Step 6: 跑，确认通过** — Composer 3 passed。

- [ ] **Step 7: Commit**

```bash
cd /Users/yiboding/projects/temp-chat-web
git add src/features/temp-chat/components/Avatar.tsx src/features/temp-chat/components/MessageBubble.tsx src/features/temp-chat/components/Composer.tsx src/features/temp-chat/components/Composer.test.tsx
git commit -q -m "feat: Avatar, MessageBubble, Composer components"
```

---

## Task 13: 屏幕 + 组装 + App 状态机 + 入口

**Files:** Create `LandingScreen.tsx`, `StatusScreen.tsx`, `ChatHeader.tsx`, `MessageList.tsx`, `MemberSheet.tsx`, `ChatScreen.tsx`, `App.tsx`, `main.tsx`

- [ ] **Step 1: 失败测试** — `src/features/temp-chat/LandingScreen.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LandingScreen } from './LandingScreen';
import type { RoomMeta } from '../../types';

const meta: RoomMeta = { title: '周末爬山', memberCount: 7, maxMembers: 50, status: 'ACTIVE', expiresAt: new Date(Date.now() + 3 * 86400_000).toISOString(), full: false };

describe('LandingScreen', () => {
  it('shows title and joins with typed nickname', () => {
    const onJoin = vi.fn();
    render(<LandingScreen meta={meta} joining={false} onJoin={onJoin} />);
    expect(screen.getByText('周末爬山')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('起个昵称（可留空）'), { target: { value: '小明' } });
    fireEvent.click(screen.getByRole('button', { name: '加入聊天' }));
    expect(onJoin).toHaveBeenCalledWith('小明');
  });
});
```

- [ ] **Step 2: 跑，确认失败** — FAIL。

- [ ] **Step 3: 实现 StatusScreen** — `src/features/temp-chat/StatusScreen.tsx`

```tsx
import { Colors } from '../../constants/theme';

const COPY = {
  loading: { emoji: '⏳', title: '加载中…', sub: '' },
  ended: { emoji: '🌙', title: '聊天已结束', sub: '到期或被发起人结束' },
  invalid: { emoji: '🔗', title: '链接无效', sub: '请向分享者确认' },
} as const;

export function StatusScreen({ kind }: { kind: keyof typeof COPY }) {
  const c = COPY[kind];
  return (
    <div style={{ minHeight: '100vh', background: Colors.bg, color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <div style={{ fontSize: 46 }}>{c.emoji}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: Colors.textDim }}>{c.title}</div>
      {c.sub && <div style={{ fontSize: 12, color: Colors.textMuted }}>{c.sub}</div>}
    </div>
  );
}
```

- [ ] **Step 4: 实现 LandingScreen** — `src/features/temp-chat/LandingScreen.tsx`

```tsx
import { useState } from 'react';
import { Colors } from '../../constants/theme';
import { useCountdown } from '../../hooks/useCountdown';
import type { RoomMeta } from '../../types';

interface LandingProps {
  meta: RoomMeta;
  joining: boolean;
  onJoin: (displayName: string) => void;
  full?: boolean;
}

export function LandingScreen({ meta, joining, onJoin, full = false }: LandingProps) {
  const [name, setName] = useState('');
  const { label } = useCountdown(meta.expiresAt);
  return (
    <div style={{ minHeight: '100vh', background: Colors.bg, color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 16 }}>
      <div style={{ fontSize: 12, color: Colors.textMuted, letterSpacing: 1 }}>CIRCLE IM</div>
      <div style={{ fontSize: 42 }}>{full ? '🙅' : '🏔️'}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{meta.title}</div>
      {full ? (
        <>
          <div style={{ color: Colors.danger, fontSize: 13 }}>人数已满（{meta.memberCount} / {meta.maxMembers}）</div>
          <button disabled style={{ background: Colors.surface, color: Colors.textMuted, border: 'none', borderRadius: 12, padding: 13, fontWeight: 600 }}>无法加入</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: Colors.textDim }}>👥 {meta.memberCount}人在聊 · ⏳ {label}</div>
          <input placeholder="起个昵称（可留空）" value={name} onChange={(e) => setName(e.target.value)} maxLength={20}
            style={{ width: 240, background: Colors.surface, border: `1px solid ${Colors.border}`, borderRadius: 12, padding: '11px 14px', color: '#fff', outline: 'none' }} />
          <button onClick={() => onJoin(name.trim())} disabled={joining}
            style={{ width: 268, background: Colors.primary, color: '#fff', border: 'none', borderRadius: 12, padding: 13, fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>
            {joining ? '加入中…' : '加入聊天'}
          </button>
          <div style={{ fontSize: 11, color: Colors.textMuted, lineHeight: 1.6 }}>无需下载 App · 无需注册<br />临时聊天，到期自动清除</div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 实现 ChatHeader / MessageList / MemberSheet**

`src/features/temp-chat/components/ChatHeader.tsx`:
```tsx
import { Colors } from '../../../constants/theme';
import { useCountdown } from '../../../hooks/useCountdown';

interface HeaderProps { title: string; expiresAt: string; memberCount: number; onOpenMembers: () => void; }

export function ChatHeader({ title, expiresAt, memberCount, onOpenMembers }: HeaderProps) {
  const { label } = useCountdown(expiresAt);
  return (
    <div style={{ background: Colors.surface, padding: '12px 14px', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
        <button onClick={onOpenMembers} style={{ fontSize: 12, color: Colors.primary, background: Colors.primarySoft, border: 'none', padding: '3px 8px', borderRadius: 10, cursor: 'pointer' }}>👥 {memberCount}人</button>
      </div>
      <div style={{ fontSize: 11, color: Colors.textDim, marginTop: 3 }}>⏳ {label} · 临时聊天</div>
    </div>
  );
}
```

`src/features/temp-chat/components/MessageList.tsx`:
```tsx
import { useEffect, useRef } from 'react';
import { Colors } from '../../../constants/theme';
import type { Message } from '../../../types';
import { MessageBubble } from './MessageBubble';

export function MessageList({ messages }: { messages: Message[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: Colors.bg, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
      <div ref={endRef} />
    </div>
  );
}
```

`src/features/temp-chat/components/MemberSheet.tsx`:
```tsx
import { Colors } from '../../../constants/theme';
import type { Member } from '../../../types';
import { Avatar } from './Avatar';

interface SheetProps { members: Member[]; onClose: () => void; }

export function MemberSheet({ members, onClose }: SheetProps) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: Colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: '14px 0 10px', maxHeight: '70vh', overflowY: 'auto' }}>
        <div style={{ width: 36, height: 4, background: Colors.border, borderRadius: 2, margin: '0 auto 12px' }} />
        <div style={{ padding: '0 18px 10px', fontWeight: 600, display: 'flex', justifyContent: 'space-between', color: '#fff' }}>
          <span>成员</span><span style={{ color: Colors.textDim, fontWeight: 400 }}>{members.length} 人</span>
        </div>
        {members.map((m) => (
          <div key={m.imUserId} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 18px', color: '#fff' }}>
            <Avatar name={m.name} />
            <div style={{ flex: 1, fontSize: 14 }}>{m.isSelf ? `我（${m.name}）` : m.name}</div>
            {m.isOwner && <span style={{ fontSize: 11, color: Colors.primary, background: Colors.primarySoft, padding: '2px 8px', borderRadius: 9 }}>群主</span>}
            {m.isSelf && !m.isOwner && <span style={{ fontSize: 11, color: Colors.textDim, background: Colors.bg, padding: '2px 8px', borderRadius: 9 }}>我</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 实现 ChatScreen** — `src/features/temp-chat/ChatScreen.tsx`

```tsx
import { useEffect, useState } from 'react';
import { Colors } from '../../constants/theme';
import { useOpenIM } from '../../hooks/useOpenIM';
import { createOpenImClient } from '../../lib/openim';
import type { GuestCreds, Member, RoomMeta } from '../../types';
import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { MemberSheet } from './components/MemberSheet';
import { MessageList } from './components/MessageList';

// client 注入以便测试；默认用真实现。
export function ChatScreen({ creds, meta, client = createOpenImClient() }: { creds: GuestCreds; meta: RoomMeta; client?: ReturnType<typeof createOpenImClient> }) {
  const { messages, ready, dismissed, sendText, sendImage } = useOpenIM(creds, client);
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => { if (showMembers) client.loadMembers(creds.groupId).then(setMembers).catch(() => setMembers([])); }, [showMembers, client, creds.groupId]);

  if (dismissed) return <div style={{ minHeight: '100vh', background: Colors.bg, color: Colors.textDim, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>聊天已结束</div>;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: Colors.bg }}>
      <ChatHeader title={meta.title} expiresAt={meta.expiresAt} memberCount={Math.max(meta.memberCount, members.length)} onOpenMembers={() => setShowMembers(true)} />
      {ready ? <MessageList messages={messages} /> : <div style={{ flex: 1, color: Colors.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>连接中…</div>}
      <Composer onSendText={sendText} onSendImage={sendImage} />
      {showMembers && <MemberSheet members={members} onClose={() => setShowMembers(false)} />}
    </div>
  );
}
```

- [ ] **Step 7: 实现 App + main** — `src/App.tsx`

```tsx
import { useParams } from 'react-router-dom';
import { useRoomMeta } from './hooks/useRoomMeta';
import { useGuestSession } from './hooks/useGuestSession';
import { LandingScreen } from './features/temp-chat/LandingScreen';
import { StatusScreen } from './features/temp-chat/StatusScreen';
import { ChatScreen } from './features/temp-chat/ChatScreen';

export function App() {
  const { token = '' } = useParams();
  const { state } = useRoomMeta(token);
  const { creds, joining, join } = useGuestSession(token);

  // 已有缓存凭证或刚 join 成功 → 直接进聊天（即便 meta 仍在 landing）
  if (creds && (state.kind === 'landing' || state.kind === 'chat' || state.kind === 'full')) {
    const meta = state.kind === 'full' || state.kind === 'landing' ? state.meta : undefined;
    if (meta) return <ChatScreen creds={creds} meta={meta} />;
  }

  switch (state.kind) {
    case 'loading': return <StatusScreen kind="loading" />;
    case 'invalid': return <StatusScreen kind="invalid" />;
    case 'ended': return <StatusScreen kind="ended" />;
    case 'full': return <LandingScreen meta={state.meta} joining={joining} onJoin={() => {}} full />;
    case 'landing': return <LandingScreen meta={state.meta} joining={joining} onJoin={(n) => join(n).catch(() => {})} />;
    default: return <StatusScreen kind="invalid" />;
  }
}
```

`src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { App } from './App';

const router = createBrowserRouter([
  { path: '/t/:token', element: <App /> },
  { path: '*', element: <Navigate to="/t/_" replace /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><RouterProvider router={router} /></React.StrictMode>,
);
```

> LandingScreen 测试需要 `useCountdown`，它不依赖 Router；ChatScreen 在测试里通过注入假 `client` 渲染。若 LandingScreen 测试因 Router 报错，用 `@testing-library` 直接渲染组件即可（组件本身不依赖 Router）。

- [ ] **Step 8: 跑全部测试 + 构建**

```bash
cd /Users/yiboding/projects/temp-chat-web && npm test && npm run build
```
Expected: 全绿，构建成功。

- [ ] **Step 9: Commit**

```bash
cd /Users/yiboding/projects/temp-chat-web
git add -A
git commit -q -m "feat: screens (Landing/Status/Chat), member sheet, App state machine + entry"
```

---

## Task 14: env、文档、最终联调清单

**Files:** Create `.env.example`, `README.md`

- [ ] **Step 1: .env.example**

```
# circle_be 基址（meta/join 接口）。生产填实际后端域名。
VITE_API_BASE=http://localhost:3000
```

- [ ] **Step 2: README（联调要点）** — 写入 `README.md`：
  - 启动：`npm run dev`，访问 `/t/<jwt>`（jwt 由 App 端创建房间生成）。
  - 依赖后端：`circle_be` 的 `TEMP_CHAT_WEB_BASE` 指向本站；OpenIM 网关需对本站域名开 CORS + wss。
  - SDK：`@openim/client-sdk` 的 wasm 资源路径与方法名以安装版本为准（见 `src/lib/openim.ts` 注释）。
  - 已知风险：见 spec §13。

- [ ] **Step 3: 全量验证**

```bash
cd /Users/yiboding/projects/temp-chat-web && npm test && npm run build && npx tsc --noEmit
```
Expected: 测试全绿、构建成功、无类型错误。

- [ ] **Step 4: Commit**

```bash
cd /Users/yiboding/projects/temp-chat-web
git add -A
git commit -q -m "docs: env example + README integration notes"
```

---

## 自查（spec 覆盖）

- 落地页 3 状态(正常/满员/已结束/失效)：Task 6（状态机）+ 10（useRoomMeta）+ 13（Landing/Status）✓
- 文字 + 图片收发：Task 11（send）+ 12（Composer/Bubble）+ 8（createImageMessageByFile）✓
- 成员列表 + 人数：Task 8（loadMembers）+ 13（MemberSheet/ChatHeader）✓
- 倒计时：Task 3 + 10 + 13 ✓
- sessionStorage 复用：Task 4 + 9 ✓
- 首字配色头像：Task 2 + 12 ✓
- 深色 App 同款视觉：Task 1 token + 各组件内联样式 ✓
- OpenIM Web SDK 集成（接口可测 + 真适配）：Task 7 + 8 + 11 ✓
- 仅消费 meta/join：Task 5 ✓
- 部署/CORS/wss、SDK 版本、wasm 首屏：spec §13 风险，Task 8/14 标注（实现时核对）

## 已知边界（有意保留）
- `lib/openim.ts` 真 SDK 调用无单测（连真网），靠接口假实现覆盖逻辑 + 人工联调（Task 14）。
- SDK 精确方法/事件名版本相关，封装层吸收，已在 Task 8 标注「实现时核对」。
