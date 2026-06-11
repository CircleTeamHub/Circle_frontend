# LiveKit 音视频通话 · 后端接口设计

- **状态**：设计草案，待评审
- **日期**：2026-06-11
- **范围**：`circle_be` 后端接口 + `circle-im` 客户端接入边界
- **不包含**：本轮不改运行时代码，不实现前端 UI，不部署 LiveKit
- **参考**：Squady WebRTC 服务、LiveKit 官方 Expo/React Native 文档、LiveKit Server SDK 文档

---

## 1. 背景

当前 C1 音视频通话入口仍是占位：

- `src/features/user/screens/UserProfileScreen.tsx` 的音视频按钮只弹 coming soon；
- `src/features/chat/screens/ChatDetailScreen.tsx` 的 `video-call` 附件项只提示需要 RTC SDK；
- C2 语音消息已完成，但它是 OpenIM 文件消息链路，不等同实时通话。

Squady 的可复用经验是：服务端负责建房、鉴权和签发 LiveKit 连接凭证，客户端只拿 `url + token` 直连 LiveKit 媒体服务器。Circle IM 是 Expo / React Native 项目，不需要照搬 Squady 的 Flutter MethodChannel 和 Android 原生桥；第一版建议使用 LiveKit React Native SDK + Expo config plugin。

---

## 2. 目标

1. 明确定义 Circle IM 使用 LiveKit 实现音视频通话时的后端边界。
2. 让通话状态由业务后端掌控：发起、响铃、接听、拒绝、取消、挂断、超时。
3. 服务端短时签发 LiveKit token，客户端不接触 LiveKit API secret。
4. 通话进行中的事件走现有 `/realtime` WebSocket，通话结束后的历史记录可落 OpenIM 自定义消息。
5. 第一阶段优先支持 1v1 通话，为后续群通话留扩展点。

## 3. 非目标

- 不在本轮实现群通话、主持人、踢人、房间管理 UI。
- 不在本轮实现 iOS CallKit、PushKit、系统级来电页或后台保活。
- 不在本轮实现通话录制、转写、计费、通话质量统计面板。
- 不用 OpenIM SDK 承载实时媒体；OpenIM 只用于聊天上下文和后续通话记录。
- 不把 LiveKit API key / secret 暴露给客户端。

---

## 4. 方案选择

### 推荐：复用 Squady WebRTC 服务，构建 Circle 专用镜像

把 `/Users/yiboding/Downloads/squady-be-notification/apps/webrtc` 作为种子代码，派生出 Circle 的独立 WebRTC 服务镜像。保留它已有的 LiveKit 集成、房间管理、join token、webhook、Prisma schema、Docker Compose 和审计日志；`circle_be` 继续负责 Circle 业务状态、好友/拉黑权限、来电 realtime 事件和 OpenIM 通话记录。

推荐的边界：

- `circle-webrtc`：只管媒体房间和 LiveKit token，不直接信任 App。
- `circle_be`：对 App 暴露 `/api/v1/calls`，校验好友关系和通话状态，然后用内部凭证调用 `circle-webrtc`。
- `circle-im`：只调用 `circle_be`，永远不直接调用 `circle-webrtc`。

优点：

- 现成代码最多：Squady webrtc 已包含 `RoomsService`、`LiveKitService`、webhook、ACL/ban、tenant credential、Docker Compose 和测试。
- 部署边界正确：RTC 可独立镜像、独立数据库、独立扩缩容。
- 后续群语聊更顺：Squady 的 room/role/participants 模型天然比 1v1 CallSession 更接近多人房间。

必须改造的点：

- 服务命名、镜像名、环境变量默认值从 Squady 改为 Circle。
- 默认 tenant 从 `Squady` 改成 `CircleIM` 或 `circle-im`。
- `circle_be` 增加内部 WebRTC client，负责换取 webrtc JWT 和调用 `/rooms`、`/rooms/:id/join`、`/rooms/:id/close`。
- App 不直接拿 webrtc tenant JWT；所有 App 请求仍走 `circle_be` JWT。
- 如果第一阶段只做 1v1，`circle_be` 仍需要自己的 `CallSession` 表来表达响铃、拒接、取消、未接听等 IM 通话语义；webrtc 服务只表达房间是否 active/ended。

### 备选：`circle_be` 内置 CallModule + LiveKitService

在现有 NestJS 后端新增 `CallModule`，直接依赖 `livekit-server-sdk`。这个方案文件少、链路短，但会把 RTC 房间管理和业务后端绑在一起。既然 Squady 已有独立 webrtc 服务代码，当前不再作为主方案。

### 不建议：客户端直接连 LiveKit token endpoint

只做一个简单 token endpoint，让客户端自己决定通话状态。

这个方案看似快，但拒接、超时、重复来电、历史记录、权限校验都会散落到客户端。通话是强状态业务，不适合由客户端主导。

---

## 5. 第一阶段产品范围

第一阶段只做 1v1 音视频通话：

- 从用户资料页发起：目标用户明确，`sessionType=Single`。
- 从单聊聊天页发起：使用当前 `sourceID` 作为目标用户。
- 群聊聊天页点击视频通话时，后端返回 `GROUP_CALL_UNSUPPORTED`，客户端继续显示“群通话暂未开放”。
- 来电只保证 App 在线或前台有 realtime 连接时可实时响铃。
- 离线/后台系统级来电、APNs/FCM/CallKit 作为后续阶段。

推荐默认行为：

- 视频通话：LiveKit token 允许发布 `camera` + `microphone`。
- 语音通话：LiveKit token 只允许发布 `microphone`。
- 发起后 45 秒无人接听则变更为 `MISSED`。
- 同一用户同一时间只能有一个非终态 1v1 通话。

---

## 6. 后端服务拆分

建议拆成两个后端边界。

### 6.1 `circle-webrtc` 服务

从 Squady 复制/派生：

```text
apps/webrtc/
├── src/rooms/*
├── src/livekit/livekit.service.ts
├── src/webhook/*
├── src/auth/*
├── src/bans/*
├── src/acls/*
├── prisma/schema.prisma
├── docker-compose.yml
├── docker-compose.prod.yml
└── docker/webrtc.dockerfile 或等价 Dockerfile
```

保留：

- `POST /api/v1/rooms`
- `GET /api/v1/rooms/:roomId`
- `POST /api/v1/rooms/:roomId/join`
- `POST /api/v1/rooms/:roomId/close`
- participants / mute / role 管理接口
- LiveKit webhook 验签和事件处理
- tenant credentials / scopes 机制
- WebrtcRoom / WebrtcParticipantRole / WebrtcRoomLog / ACL / Ban schema

Circle 定制：

- 默认 tenant 改为 `circle-im`。
- 镜像名建议 `circle-webrtc`。
- 容器名、volume、network 从 `webrtc-*` 改成 `circle-webrtc-*`。
- 移除或关闭对公网暴露的 admin tenant API，至少生产环境只允许内网访问。
- 增加健康检查和 migration entrypoint：启动前执行 `prisma migrate deploy`。

### 6.2 `circle_be` CallModule

`circle_be` 仍新增轻量 `CallModule`，但不直接依赖 LiveKit SDK。它负责业务通话状态，并通过内部 HTTP client 调用 `circle-webrtc`。

```text
circle_be/src/call/
├── call.module.ts
├── call.controller.ts
├── call.service.ts
├── webrtc-client.service.ts
├── call-timeout.service.ts
└── dto/
    └── call.dto.ts
```

依赖：

- `PrismaModule`
- `RealtimeModule`
- `OpenimModule`（第二阶段：写通话记录自定义消息）
- `FriendModule` 或直接查 `Friend` 表做 1v1 权限校验
- 内部 HTTP client 调用 `circle-webrtc`

`circle_be` 环境变量：

```bash
WEBRTC_SERVICE_URL=http://circle-webrtc:3005
WEBRTC_TENANT_ID=circle-im
WEBRTC_CLIENT_ID=...
WEBRTC_CLIENT_SECRET=...
CALL_RING_TIMEOUT_SECONDS=45
CALL_ALLOW_OFFLINE_INVITE=false
```

`circle-webrtc` 环境变量：

```bash
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_TOKEN_MAX_TTL=3600
WEBRTC_DATABASE_URL=postgresql://...
JWT_SECRET=...
WEBRTC_TENANT_ID=circle-im
```

本地开发可使用 LiveKit dev server；生产必须使用 LiveKit Cloud 或正确配置公网 TLS / TURN / UDP 的自托管 LiveKit。

---

## 7. 数据模型

数据分两层。

`circle-webrtc` 复用 Squady schema：

- `WebrtcTenantCredential`
- `WebrtcRoom`
- `WebrtcParticipantRole`
- `WebrtcRoomLog`
- `WebrtcRoomAcl`
- `WebrtcBannedUser`

`circle_be` 新增业务通话表，用来表达 IM 产品语义：

```prisma
enum CallType {
  AUDIO
  VIDEO
}

enum CallStatus {
  RINGING
  ACCEPTED
  ACTIVE
  ENDED
  REJECTED
  CANCELED
  MISSED
  EXPIRED
  FAILED
}

enum CallEndReason {
  NORMAL
  REJECTED
  CANCELED
  MISSED
  TIMEOUT
  NETWORK
  ERROR
}

model CallSession {
  id              String        @id @default(uuid())
  conversationID  String
  sessionType     Int
  callType        CallType
  status          CallStatus    @default(RINGING)
  webrtcRoomId    String        @unique
  livekitRoomName String?
  callerID        String
  calleeID        String
  startedAt       DateTime?
  acceptedAt      DateTime?
  endedAt         DateTime?
  expiresAt       DateTime
  endedByID       String?
  endReason       CallEndReason?
  metadata        Json?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  caller User @relation("callCaller", fields: [callerID], references: [id], onDelete: Cascade)
  callee User @relation("callCallee", fields: [calleeID], references: [id], onDelete: Cascade)

  @@index([callerID, status])
  @@index([calleeID, status])
  @@index([conversationID, createdAt])
  @@index([expiresAt, status])
}
```

第一阶段不需要在 `circle_be` 新增 `CallParticipant` 表。群通话立项时可以直接复用 `circle-webrtc` 的 `WebrtcParticipantRole`，必要时再在 `circle_be` 增加业务参与者表：

```prisma
model CallParticipant {
  id        String @id @default(uuid())
  callID    String
  userID    String
  role      String
  joinedAt  DateTime?
  leftAt    DateTime?
  muted     Boolean @default(false)
}
```

---

## 8. 权限规则

后端必须用 JWT 中的 `req.user.userId` 做鉴权，不能信任客户端传入的 caller。

发起 1v1 通话：

1. `calleeID` 必须存在且状态可用。
2. `callerID !== calleeID`。
3. 双方必须是已通过好友，或者当前业务明确允许陌生人临时通话。
4. 用户不能被对方拉黑。
5. caller 和 callee 均不能已有非终态通话。
6. `conversationID` 必须与 caller/callee 对应的 OpenIM 单聊会话一致；否则后端重算并覆盖。

接听：

1. 只有 `calleeID` 可以调用 accept。
2. 只有 `RINGING` 状态可以接听。
3. `expiresAt` 已过则返回 `CALL_EXPIRED` 并把状态改为 `MISSED`。

取消 / 拒绝 / 挂断：

- caller 在 `RINGING` 时调用 cancel；
- callee 在 `RINGING` 时调用 reject；
- 任一参与者在 `ACCEPTED` / `ACTIVE` 时调用 hangup；
- 终态接口幂等，重复调用返回当前状态。

---

## 9. HTTP API

所有接口都挂在 `/api/v1/calls`，使用现有 Bearer access token。

### 9.1 发起通话

```http
POST /api/v1/calls
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "calleeID": "uuid",
  "conversationID": "si_xxx_yyy",
  "callType": "VIDEO"
}
```

返回：

```ts
type CreateCallResponse = {
  call: CallSessionDto;
  livekit: {
    url: string;
    token: string;
    expiresAt: string;
  };
};
```

说明：

- 创建 LiveKit room，状态为 `RINGING`。
- 给 caller 返回 token，caller 可进入等待页。
- 通过 realtime 给 callee 推送 `call.invite`。
- 如果 `CALL_ALLOW_OFFLINE_INVITE=false` 且 callee 无 realtime 连接，可返回 `409 CALLEE_OFFLINE`。

### 9.2 接听

```http
POST /api/v1/calls/:callId/accept
Authorization: Bearer <accessToken>
```

返回 callee 的 LiveKit 凭证：

```ts
type AcceptCallResponse = {
  call: CallSessionDto;
  livekit: {
    url: string;
    token: string;
    expiresAt: string;
  };
};
```

副作用：

- 状态 `RINGING -> ACCEPTED`；
- 广播 `call.accepted` 给 caller；
- 客户端拿 token 后进入通话页。

### 9.3 拒绝

```http
POST /api/v1/calls/:callId/reject
Authorization: Bearer <accessToken>
```

副作用：

- 状态 `RINGING -> REJECTED`；
- 删除或关闭 LiveKit room；
- 广播 `call.rejected` 给 caller；
- 第二阶段写 OpenIM 通话记录。

### 9.4 取消

```http
POST /api/v1/calls/:callId/cancel
Authorization: Bearer <accessToken>
```

副作用：

- 状态 `RINGING -> CANCELED`；
- 广播 `call.canceled` 给 callee。

### 9.5 挂断

```http
POST /api/v1/calls/:callId/hangup
Authorization: Bearer <accessToken>

{
  "reason": "NORMAL"
}
```

副作用：

- 状态 `ACCEPTED|ACTIVE -> ENDED`；
- 记录 `endedAt`、`endedByID`、`endReason`；
- 调用 LiveKit DeleteRoom，强制断开仍在房间内的参与者；
- 广播 `call.ended` 给双方；
- 第二阶段写 OpenIM 通话记录。

### 9.6 查询通话

```http
GET /api/v1/calls/:callId
Authorization: Bearer <accessToken>
```

仅参与者可读。用于客户端重连、刷新通话状态、从通知点击后确认通话是否仍有效。

### 9.7 重新获取 LiveKit token

```http
POST /api/v1/calls/:callId/join-token
Authorization: Bearer <accessToken>
```

用于 token 过期、App 切前台后恢复。仅 `ACCEPTED` / `ACTIVE` 且参与者本人可调用。

---

## 10. DTO

```ts
type CallSessionDto = {
  id: string;
  conversationID: string;
  sessionType: 'single';
  callType: 'AUDIO' | 'VIDEO';
  status:
    | 'RINGING'
    | 'ACCEPTED'
    | 'ACTIVE'
    | 'ENDED'
    | 'REJECTED'
    | 'CANCELED'
    | 'MISSED'
    | 'EXPIRED'
    | 'FAILED';
  caller: {
    id: string;
    nickname: string;
    avatarUrl: string | null;
  };
  callee: {
    id: string;
    nickname: string;
    avatarUrl: string | null;
  };
  startedAt: string | null;
  acceptedAt: string | null;
  endedAt: string | null;
  expiresAt: string;
  durationSeconds: number | null;
  endReason: string | null;
};
```

错误码建议：

| code | HTTP | 含义 |
| --- | --- | --- |
| `CALL_TARGET_NOT_FOUND` | 404 | 目标用户不存在 |
| `CALL_NOT_ALLOWED` | 403 | 非好友、被拉黑或无权限 |
| `CALL_BUSY` | 409 | 任一方已有非终态通话 |
| `CALLEE_OFFLINE` | 409 | 第一阶段在线通话模式下，对方不在线 |
| `GROUP_CALL_UNSUPPORTED` | 400 | 第一阶段不支持群通话 |
| `CALL_NOT_FOUND` | 404 | 通话不存在或当前用户无权访问 |
| `CALL_EXPIRED` | 409 | 来电已过期 |
| `LIVEKIT_UNAVAILABLE` | 503 | LiveKit 未配置或不可用 |

---

## 11. Realtime 事件

复用现有 `/realtime` WebSocket。客户端已经使用 message-based auth，避免 JWT 进入 URL，这一点适合继续沿用。

新增事件类型：

```ts
type CallRealtimeEvent =
  | { type: 'call.invite'; payload: CallInvitePayload }
  | { type: 'call.accepted'; payload: CallStatePayload }
  | { type: 'call.rejected'; payload: CallStatePayload }
  | { type: 'call.canceled'; payload: CallStatePayload }
  | { type: 'call.missed'; payload: CallStatePayload }
  | { type: 'call.ended'; payload: CallStatePayload }
  | { type: 'call.participant.changed'; payload: CallParticipantPayload };
```

`call.invite` payload：

```ts
type CallInvitePayload = {
  callId: string;
  conversationID: string;
  callType: 'AUDIO' | 'VIDEO';
  caller: {
    id: string;
    nickname: string;
    avatarUrl: string | null;
  };
  expiresAt: string;
  createdAt: string;
};
```

规则：

- Realtime payload 不携带 LiveKit token。
- callee 接听后必须通过 HTTP `/accept` 获取 token。
- 如果 realtime 断线，客户端用 `GET /calls/:callId` 或后续 pending-call 查询接口恢复状态。
- 后端发送事件要 best-effort，数据库状态是最终事实。

---

## 12. LiveKit token 生成

LiveKit token 由 `circle-webrtc` 使用 `livekit-server-sdk` 生成，`circle_be` 只是转发给已授权的 App 调用方。

- `RoomServiceClient` 创建/删除 room；
- `AccessToken` 签发参与者 token；
- token TTL 建议 10 分钟；
- participant identity 使用 Circle 用户 UUID，不使用 OpenIM 去横线 ID；
- participant name 使用昵称；
- room name 使用可控前缀：`circle_call_<callId>`。

权限：

```ts
import { TrackSource } from 'livekit-server-sdk';

const canPublishSources =
  callType === 'VIDEO'
    ? [TrackSource.MICROPHONE, TrackSource.CAMERA]
    : [TrackSource.MICROPHONE];

token.addGrant({
  roomJoin: true,
  room: livekitRoomName,
  canPublish: true,
  canSubscribe: true,
  canPublishData: true,
  canPublishSources,
});
```

客户端永远只拿签好的 token，不拿 API key / secret。

---

## 13. LiveKit Webhook

新增：

```http
POST /api/v1/calls/livekit/webhook
Content-Type: application/webhook+json
Authorization: Bearer <LiveKit signed webhook JWT>
```

用途：

- `participant_joined`：当第二个参与者加入后，把通话状态推进到 `ACTIVE`，设置 `startedAt`。
- `participant_left`：记录参与者离开；如果房间无人或双方都离开，推进到 `ENDED`。
- `room_finished`：确保业务状态进入终态，兜底清理。
- `track_published` / `track_unpublished`：第一阶段只记录日志，不驱动核心状态。

验签要求：

- 使用 LiveKit `WebhookReceiver`，必须拿到 raw body；
- 不能用已解析 JSON 代替 raw body 做验签；
- 验签失败返回 401。

---

## 14. OpenIM 通话记录

实时来电不建议依赖 OpenIM 消息驱动。原因：

- OpenIM 消息适合持久聊天记录，不适合驱动强实时状态机；
- 来电 token 不能放进 OpenIM 消息；
- 通话状态需要严格鉴权和幂等。

第二阶段建议在通话进入终态时，由后端发送 OpenIM 自定义消息：

```ts
type CallSummaryMessage = {
  customType: 'CALL_SUMMARY';
  callId: string;
  callType: 'AUDIO' | 'VIDEO';
  status: 'ENDED' | 'REJECTED' | 'CANCELED' | 'MISSED';
  durationSeconds: number | null;
  callerID: string;
  calleeID: string;
  endedAt: string;
};
```

客户端把该自定义消息映射成聊天气泡：

- 已取消：`已取消视频通话`
- 已拒绝：`对方已拒绝`
- 未接听：`未接听`
- 已结束：`视频通话 03:21`

这需要后端 `OpenimService` 增加发送自定义消息能力，或通过 OpenIM server API 封装 `sendCustomMessage`。

---

## 15. 客户端接入边界

本设计文档不实现客户端，但后续计划应包含：

1. 安装 LiveKit React Native 依赖：
   - `@livekit/react-native`
   - `@livekit/react-native-expo-plugin`
   - `@livekit/react-native-webrtc`
   - `@config-plugins/react-native-webrtc`
   - `livekit-client`
2. `app.json` 添加 LiveKit / WebRTC config plugins。
3. 应用入口调用 `registerGlobals()`。
4. 使用 Expo dev client 或原生 build；不能用 Expo Go。
5. 更新权限文案：
   - iOS `NSCameraUsageDescription` 从“扫描二维码”扩展到“扫描二维码和视频通话”；
   - iOS `NSMicrophoneUsageDescription` 从“语音消息”扩展到“语音消息和通话”；
   - Expo camera/audio plugin 文案同步更新。
6. 新增通话状态 store 和通话页：
   - 呼出等待页；
   - 来电弹层；
   - 通话页；
   - 异常/重连/挂断状态。

LiveKit UI 层建议后续从低成本开始：

- 语音通话：只渲染头像、计时、麦克风、扬声器、挂断。
- 视频通话：本地小窗 + 远端大窗，使用 LiveKit track hooks 渲染。

---

## 16. 状态机

```text
RINGING
  ├─ callee accept ───────▶ ACCEPTED
  │                         └─ LiveKit second participant joined ─▶ ACTIVE
  │                                                              └─ hangup/webhook empty ─▶ ENDED
  ├─ caller cancel ───────▶ CANCELED
  ├─ callee reject ───────▶ REJECTED
  └─ timeout ─────────────▶ MISSED
```

约束：

- 终态不可逆。
- 任意终态都要尝试删除 LiveKit room。
- webhook 只能把非终态推进到更靠后的状态，不能覆盖已存在的终态。
- `DeleteRoom` 导致客户端断开属于预期行为。

---

## 17. 超时与清理

后端需要一个定时任务或延迟队列：

1. 每 5-10 秒扫描 `RINGING` 且 `expiresAt < now()` 的通话。
2. 状态更新为 `MISSED`。
3. 删除 LiveKit room。
4. 广播 `call.missed` 给 caller/callee。
5. 第二阶段写 OpenIM 通话记录。

通话已 `ACTIVE` 但 webhook 未收到 `room_finished` 时，可用兜底任务检查 LiveKit participants；无人则结束。

---

## 18. 安全与隐私

- LiveKit API secret 只存在后端环境变量。
- LiveKit token 只能通过 HTTPS HTTP API 返回，不通过 realtime 或 OpenIM 发送。
- token TTL 短，过期后重新走 `/join-token`。
- 后端日志要脱敏 token、Authorization header、LiveKit credentials。
- `call.invite` payload 只包含必要展示信息。
- 通话 room name 不包含手机号、accountId、昵称等 PII。
- 对外 webhook 必须验签。
- 发起接口要加速率限制，避免骚扰和资源滥用。

---

## 19. 测试计划

后端单元测试：

- 非好友/被拉黑无法发起；
- caller/callee 已忙返回 `CALL_BUSY`；
- caller 创建通话后 callee 收到 `call.invite`；
- callee accept 后返回 token，状态变为 `ACCEPTED`；
- caller cancel、callee reject、任一方 hangup 幂等；
- 超时任务把 `RINGING` 推进到 `MISSED`；
- webhook 验签失败返回 401；
- `participant_joined` 把第二人加入后的通话推进到 `ACTIVE`。

`circle_be` 集成测试：

- 使用 mocked `WebrtcClientService` 验证 create/join/close 调用参数；
- 验证 webrtc 服务异常时，`circle_be` 返回稳定业务错误码而不是泄露内部错误。

`circle-webrtc` 集成测试：

- 复用 Squady webrtc 现有 rooms / livekit / webhook 测试；
- 可选本地 LiveKit dev server 做端到端 token join smoke test。

客户端后续验收：

- iOS/Android dev build 能请求麦克风/相机权限；
- 两台设备 1v1 视频通话可接通、挂断；
- 拒接/取消/超时双方 UI 一致；
- App 断网后通话页能退出或重连；
- Expo Go 明确不可作为验收环境。

---

## 20. 分阶段实施建议

### 阶段 1：派生 Squady WebRTC 镜像

- 复制 Squady `apps/webrtc` 到 Circle 服务目录或单独 repo；
- 改服务名、镜像名、默认 tenant、env example、docker compose；
- 补 Dockerfile 或复用 Squady `docker/webrtc.dockerfile`；
- 跑 `prisma migrate deploy`、`yarn test`、`yarn build`；
- 本地用 LiveKit dev server 验证 `/rooms`、`/join`、webhook。

### 阶段 2：`circle_be` 通话状态机 + WebRTC client

- 新增 `CallSession` Prisma model 和 migration；
- 新增 `CallModule` / `WebrtcClientService`；
- 实现 create/accept/reject/cancel/hangup/get/join-token；
- 内部调用 `circle-webrtc` 创建房间、获取 join token、关闭房间；
- 实现 realtime call events；
- mock `WebrtcClientService` 完成后端测试。

### 阶段 3：客户端最小通话

- 安装 LiveKit RN 依赖和 config plugins；
- 新增通话 API client；
- 接入聊天页/资料页发起按钮；
- 实现呼出、来电、通话页、挂断；
- 仅支持 App 在线时响铃。

### 阶段 4：历史记录与离线提醒

- 后端 OpenIM 自定义通话记录消息；
- 聊天气泡渲染通话记录；
- 如需后台来电，再单独接入原生推送、CallKit/ConnectionService。

### 阶段 5：群通话

- 复用 `circle-webrtc` participants / role / mute 接口；
- 支持群聊房间、成员列表、角色、主持人、静音；
- `circle_be` 只补群通话业务权限和 OpenIM 群聊入口。

---

## 21. 风险

1. **移动端 RTC 不能用 Expo Go**：必须用 dev client 或原生构建。
2. **离线来电不是纯 LiveKit 问题**：后台响铃需要 APNs/FCM/CallKit 等单独立项。
3. **自托管 LiveKit 生产网络复杂**：需要 TLS、UDP、TURN/NAT 配置；本地 `--dev` 不能代表生产。
4. **OpenIM 和 realtime 是两条链路**：通话状态以 `CallSession` 为准，OpenIM 只做历史记录。
5. **权限文案要更新**：现有相机文案只提扫码，麦克风只提语音消息，发布前必须覆盖通话用途。

---

## 22. 参考资料

- LiveKit Expo getting started: https://docs.livekit.io/transport/sdk-platforms/expo/
- LiveKit rooms, participants, tracks overview: https://docs.livekit.io/intro/basics/rooms-participants-tracks/
- LiveKit webhooks and events: https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/
- LiveKit frontend authentication: https://docs.livekit.io/frontends/build/authentication/
- LiveKit tokens and grants: https://docs.livekit.io/frontends/reference/tokens-grants/
- Squady reference: `/Users/yiboding/Downloads/squady-be-notification/apps/webrtc`
