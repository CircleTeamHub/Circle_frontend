> **2026-10-25 起已停用(第一阶段)。** App 里已没有开启入口,文字/引用一律明文发送,已有的加密消息只显示占位文案、不再解密;后端拒绝开启加密和新的 `encrypted-text`(错误码 `CHAT_TEXT_ENCRYPTION_DISABLED`),已加密会话由迁移改回 `PLAIN`。`src/services/e2ee` 只剩一个用处:删除 / 清空 / 焚毁时清掉本机以前解密存下的正文。第二阶段确认没有真实用户依赖加密数据后,删除 `packages/e2ee`、`src/services/e2ee`、`tools/e2ee-*` 和本文。下文是停用前的记录,启用步骤已不再适用。

> 恢复、迁移与长期归档的最新实现和验收边界见 [文字加密恢复与历史归档](./text-encryption-recovery.md)。以下为上一阶段接入记录。

# 文字加密开发入口

本阶段仅加密新发送的文字/文字引用，授权管理员设备也是明确披露的解密成员。媒体、卡片和既有明文历史没有因此改为端到端加密。

App 开发开关为 `EXPO_PUBLIC_E2EE_TEXT_ENABLED=true`，当前 `.env.local` 已设置；重新加载开发构建后，在“账号与安全”或“聊天信息”中进入“文字加密与设备”。原生 App 的密钥在 SecureStore，状态与消息明文只进入加密 SQLite 日志；普通消息缓存及待发队列保持密文。加密开发开关开启时暂不自动持久化新的文字草稿。

完整后端、管理员浏览器保险库配置与验证步骤位于相邻仓库 `circle_be/docs/security/text-encryption-local.md`。后端本地联调脚本 `circle_be/scripts/test-e2ee-local.ts` 使用真实 PostgreSQL 和 HTTP，验证设备批准、撤销、私聊/群聊、密文存储、管理员解密和断线恢复。

本地通过不等于生产验收：当前仍是固定管理设备的开发协议，管理设备移交/丢失恢复、新设备历史迁移、长期加密归档及真机运行尚未完成。每个会话最多 64 台设备，开发日志 inbox/outbox 各 1,000 项。已加密会话不得降级明文。App Web 暂不提供加密设备存储，明确拒绝明文降级。

共享协议唯一源为 `packages/e2ee`；管理台通过自己的 `npm run sync:e2ee` 生成 `vendor/e2ee` 与源文件哈希，保持单仓 CI 可独立构建。
