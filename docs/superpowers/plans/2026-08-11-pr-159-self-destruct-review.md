# PR #159 自毁消息审查修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复策略水合竞态、过期本地数据残留和自毁媒体磁盘缓存。

**Architecture:** Socket manager 串联策略解析和水合，并以会话与请求版本拒绝过期响应。Store 负责内存状态、到期调度与等待持久化清理；local-db 在单一排队事务中删除消息与过期 outbox。设置页只把属于当前账号的响应写入聊天策略。

**Tech Stack:** TypeScript、Zustand、Expo SQLite、Expo Image、Node test VM harness。

## Global Constraints

- 不改变服务端 API 或策略值语义。
- 离线时只使用当前账号独立缓存的最后有效策略。
- 所有生产行为改动均先以失败测试覆盖。
- 不回复或关闭 GitHub 审查线程。

---

### Task 1: 策略顺序和并发归属

**Files:**
- Modify: `src/chat-core/socket-manager.ts`
- Modify: `src/chat-core/store.ts`
- Modify: `src/features/profile/screens/PrivacySettingsScreen.tsx`
- Test: `test/chat-core-socket-manager.test.js`

**Interfaces:**
- Consumes: `fetchPrivacySettings(): Promise<{ messageSelfDestructDays: number }>`
- Produces: 仅接受当前会话、最新请求且未被本地设置覆盖的策略写入。

- [ ] **Step 1: 写失败测试**

```js
test('cold hydrate waits for the authoritative policy and ignores stale refreshes', async () => {
  // defer GET, start connect, assert hydrate is not called; resolve GET and assert policy precedes hydrate.
  // issue a newer local policy write before GET resolves, assert GET cannot overwrite it.
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test test/chat-core-socket-manager.test.js`

Expected: FAIL because hydration starts before the GET result and stale result is accepted.

- [ ] **Step 3: 实现最小顺序/版本门**

```ts
const request = ++viewerPolicyRefreshGeneration;
const revision = store.viewerSelfDestructPolicyRevision;
const settings = await fetchPrivacySettings();
if (request !== viewerPolicyRefreshGeneration || store.currentUserId !== userId || store.viewerSelfDestructPolicyRevision !== revision) return;
store.setViewerSelfDestructDays(settings.messageSelfDestructDays, { remoteRefresh: true });
```

- [ ] **Step 4: 运行测试验证通过**

Run: `node --test test/chat-core-socket-manager.test.js`

Expected: PASS.

### Task 2: 原子批量过期清理和水合安全

**Files:**
- Modify: `src/chat-core/local-db.ts`
- Modify: `src/chat-core/local-db.web.ts`
- Modify: `src/chat-core/store.ts`
- Modify: `src/chat-core/socket-manager.ts`
- Test: `test/chat-core-local-db-writes.test.js`
- Test: `test/chat-core-store.test.js`
- Test: `test/chat-core-socket-manager.test.js`

**Interfaces:**
- Consumes: `{ conversationId: string; cutoff: Date }[]`
- Produces: `purgeExpiredLocalMessages(entries): Promise<void>`，完成后 messages、FTS 与过期 outbox 均已删除。

- [ ] **Step 1: 写失败测试**

```js
test('batched burn purge removes expired messages and outbox in one transaction', async () => {
  await api.purgeExpiredLocalMessages([{ conversationId: 'c1', cutoff: new Date(0) }]);
  assert.equal(db.state.transactions, 1);
  assert.match(sql, /DELETE FROM outbox WHERE conversation_id = \? AND created_at < \?/);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test test/chat-core-local-db-writes.test.js test/chat-core-store.test.js test/chat-core-socket-manager.test.js`

Expected: FAIL because the old function accepts one conversation, does not delete outbox, and hydration does not await the purge.

- [ ] **Step 3: 实现最小事务与等待**

```ts
await writeTransaction(current.db, async () => {
  for (const { conversationId, cutoff } of entries) {
    await current.db.runAsync(deleteMessagesSql, conversationId, cutoff.toISOString());
    await current.db.runAsync(deleteOutboxSql, conversationId, cutoff.toISOString());
  }
});
```

- [ ] **Step 4: 运行测试验证通过**

Run: `node --test test/chat-core-local-db-writes.test.js test/chat-core-store.test.js test/chat-core-socket-manager.test.js`

Expected: PASS.

### Task 3: 到期调度、未读修正和媒体缓存

**Files:**
- Modify: `src/chat-core/store.ts`
- Modify: `src/features/chat/components/bubbles/image-bubble.tsx`
- Test: `test/chat-core-store.test.js`
- Test: `test/chat-core-remediation.test.js`

**Interfaces:**
- Consumes: 会话 burn duration、viewer policy 与消息时间戳。
- Produces: 到期时的下一次清理调度，以及自毁会话的 `cachePolicy="memory"`。

- [ ] **Step 1: 写失败测试**

```js
test('burn expiry resets an affected preview and unread count and schedules the next cutoff', async () => {
  // use fake timers/date and a self-destruct conversation, then assert unreadCount is zero after expiry.
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test test/chat-core-store.test.js test/chat-core-remediation.test.js`

Expected: FAIL because no expiry timer is installed, unread count is retained, and images always request disk cache.

- [ ] **Step 3: 实现最小调度和缓存策略**

```ts
scheduleNextBurnPurge(nextExpiryAt);
const cachePolicy = selfDestructEnabled ? 'memory' : 'memory-disk';
```

- [ ] **Step 4: 运行测试验证通过**

Run: `node --test test/chat-core-store.test.js test/chat-core-remediation.test.js`

Expected: PASS.

### Task 4: 集成验证与提交

**Files:**
- Verify: `test/chat-core-*.test.js`
- Verify: `src/chat-core/store.ts`
- Verify: `src/chat-core/socket-manager.ts`

- [ ] **Step 1: 运行聊天定向测试**

Run: `node --test test/chat-core-store.test.js test/chat-core-socket-manager.test.js test/chat-core-local-db-writes.test.js test/chat-core-remediation.test.js`

Expected: PASS.

- [ ] **Step 2: 运行类型和静态检查**

Run: `npm run typecheck && npm run lint`

Expected: exit 0.

- [ ] **Step 3: 审阅变更并提交**

Run: `git diff --check && git diff -- src/chat-core src/features/profile src/features/chat test`

Expected: 无空白错误，所有变更对应审查意见。
