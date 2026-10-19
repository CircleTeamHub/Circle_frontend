# Circle MLS 本地协议验证

状态：2026-10-16，开发阶段协议实验代码；**尚未接入 App，现有聊天仍不是端到端加密**。协议核心已提取到 `packages/e2ee` 并作为 App 的本地依赖；实验目录复用同一份代码，现有聊天发送流程尚未切换。

## 运行

实验测试需要支持 `node:sqlite` 的 Node.js；WebCrypto 只用于对照互通测试。已验证 Node 25.8.1。

```sh
cd tools/e2ee-poc
npm ci --prefix ../../packages/e2ee --ignore-scripts
npm ci --ignore-scripts
npm test
npm run test:portable
```

测试只使用随机虚构账号、临时 SQLite 文件和本地内存投递，不访问业务数据库、线上服务器或真实聊天。每个测试结束后删除临时状态；存储包装密钥仅在测试进程中持有。

## 已实现和验证

- 使用固定版本 `ts-mls@1.6.4`、MLS RFC 9420 suite 1（X25519 / AES-128-GCM / SHA-256 / Ed25519），没有自行实现消息密钥协商或棘轮。
- 每台设备独立签名身份；身份和公钥必须预先由可信外部渠道固定。陌生身份、替换公钥、伪造群邀请、非管理设备提交成员变更均拒绝。
- 发送设备、会话、epoch、幂等消息 ID 与 MLS authenticated data 绑定。修改上下文、密文、附加尾部数据或重放不能交付正文。
- 加密 SQLite 日志以 compare-and-swap 事务同时提交协议状态与 outbox，提交完成才返回密文。重启或请求重试返回相同密文；失败事务不发送；并发发送只有一个状态版本能提交。
- 接收端把协议状态和解密后的 inbox 一起加密落盘，避免先推进棘轮、崩溃后却丢掉正文。重启仍可读取 inbox，不需要重放网络密文。
- 离线、乱序、双向消息；新增设备无旧 epoch 历史；移除设备不能解密未来消息。验证了 32 台设备加入及批量移除 15 台设备。
- 附件独立随机 AES-256-GCM 密钥、nonce、对象 ID；对象存储只接收密文，引用和密钥放进 MLS 消息。篡改、截断、跨会话/对象替换会失败。
- 固定 MLS 工作组提交的六组 suite 1 crypto-basics 测试向量，包括对外部生成的 HPKE 密文进行解密。来源及 SHA-256 在 `fixtures/SOURCE.json`，这些测试不代表完成所有 MLS 互操作测试。

常规 26 项测试通过；移除 `crypto.subtle` 后，协议场景、持久化接入和测试向量共 23 项也通过。新增适配器使用 hpke-js 的公开 DHKEM 接口与 Noble 的 HKDF/AES，实现无 WebCrypto 的 suite 1；随机数仍必须由系统 CSPRNG 提供。

对照测试验证此适配器与原库默认 WebCrypto 实现双向收发和更新 epoch；没有系统安全随机数或请求不支持的 suite 时拒绝初始化。保留旧 provider 缺少 WebCrypto 时会失败的回归，防止误删适配层。上述测试使用 Node 模拟缺少 WebCrypto，**尚不等于 Hermes / 真机验收**。

## 本轮选型结论与接入门槛

按开发阶段推进原生适配、设备身份、服务端密文投递及 App 联调。第三方安全审计列入上线前验收，不作为继续编写和测试开发功能的前置条件。实验能力可以在开发环境逐步接入，界面和验收记录需如实标注完成范围。

| 项目 | 当前结果 | 后续验收 |
|---|---|---|
| Node 双端 / 群组协议 | 本地测试通过 | 与另一 MLS 实现做完整互操作、长期断线跨 epoch、并发提交重同步 |
| React Native / Expo | 新增无 WebCrypto 密码适配器；模拟环境下完整协议/向量通过 | Expo 系统随机源、Metro 打包、Hermes 与 iOS / Android development build 实测；禁止明文回退 |
| Web | Node 不代表浏览器验收 | 浏览器 WebCrypto、worker、持久化与多标签页竞争测试 |
| 安全审查 | 上游明确说明尚无正式安全审计 | 库及 Circle 协议集成的独立审查；不能用单测代替 |
| 身份与设备批准 | 测试通过可信外部渠道预置公钥 | App 设备签名链、二维码/安全码、替换提示、密钥目录一致性及恢复流程 |
| 本地安全存储 | Node 加密 SQLite 原型 | Keychain/Keystore 包装密钥、设备锁定行为、备份/回滚防护、原子存储适配器 |
| 服务端 | 无真实投递接口 | 账号与设备绑定、KeyPackage 一次性领取、密文幂等投递、持久化 encryptionMode / 最低版本，禁止已加密会话降级 |
| 产品功能 | 无正式 UI 或迁移 | 编辑/转发/搜索/推送/举报/历史迁移的加密语义和端侧行为测试 |

实验特有限制：由一台固定管理设备串行更新群成员；没有管理员轮换、并发提案合并、恢复备份或透明度服务。Inbox/outbox 各最多 1000 条，达到上限拒绝操作，不自动删除安全状态。附件一次最多 8 MiB，没有分块视频协议。JavaScript 不能保证擦除所有字符串或 GC 副本。整个 SQLite 文件回滚/复制到另一设备不在当前原型的防护范围内。不能将这些实验默认值作为生产配置。

## 来源

- [MLS RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html)
- [ts-mls 实现和安全状态](https://github.com/LukaJCB/ts-mls)（MIT；固定依赖完整性见 lockfile）
- [HPKE WebCrypto 实现](https://github.com/dajiaji/hpke-js)
- [MLS 工作组测试向量固定版本](https://github.com/mlswg/mls-implementations/tree/2034fe72e0c805a683ba76165660c834f2a8142a/test-vectors)
- [OpenMLS](https://github.com/openmls/openmls) / [mls-rs](https://github.com/awslabs/mls-rs)：原生绑定备选，尚未完成本项目的平台、审计、许可证和迁移成本验收。

## 共享代码与原生接入进度

`packages/e2ee` 已移除 Node Buffer / node:crypto 依赖，支持异步 journal；确认的设备公钥持久化于加密状态，打开设备不会自动批准其身份。`src/services/e2ee/journal.ts` 使用 Expo SecureStore 的本设备解锁级密钥和 AES-256-GCM 加密 SQLite 记录，CAS 事务失败时拒绝发送，无明文降级。Web 适配器在尚未提供显式解锁的浏览器密钥库前拒绝打开，绝不使用 localStorage 保存私钥。

TypeScript 与独立入口的 iOS / Android Metro 打包已通过；尚未完成 Hermes 设备运行、UI、后端密文接口或管理员解锁页面。管理员作为公开披露的可解密方，服务器不持有其私钥；新增管理员设备不能仅凭入群读取旧 MLS epoch。

桌面基线可用 `npm run benchmark` 重现：1 KB 文本、2 个用户设备加 1 个管理员设备，10 次预热与 100 次采样，包含 SQLite FULL 持久化。2026-10-16 本机 Node 25.8.1、arm64、无 SubtleCrypto 的发送中位数 / p95 为 0.87 / 1.10 ms；接收为 1.36 / 1.55 ms。此结果不包含网络、UI，也不代表 Hermes、手机耗电或大量历史记录情况下的性能；当前实验 journal 为整份状态加密，需继续验证数据量增长。
