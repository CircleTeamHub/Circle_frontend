# 专用测试数据约定

所有 fixture 必须属于隔离的 staging/E2E 环境，不得使用生产账号、真实好友、真实聊天内容或生产圈子。测试账号不得绑定真实支付、推送或个人资料。

## 业务 E2E fixture

- Runner 账号支持密码登录；若测验证码模式，验证码必须由测试环境固定或测试 API 提供，不能读取真实邮箱。
- `E2E_CONVERSATION_ID` 是 runner 已加入且可发送文本的会话，对应列表标题为 `E2E_CONVERSATION_NAME`。
- `E2E_ORIGINAL_NICKNAME` 必须与执行前昵称完全一致，保证资料流程可还原。
- 好友与圈子 fixture 同时提供精确 ID 和可搜索账号/名称，避免同名误点。
- 动态删除按钮的本地化文案通过 `E2E_DELETE_LABEL` 显式提供。

## 性能 fixture

账号文件复制自 `load-tests/data/accounts.example.json`，保存为已忽略的 `accounts.local.json`。每个 token 只授予该测试账号权限；`conversationIds` 必须是该账号已有权限的会话，`circleIds` 必须是为 join/leave 循环准备、执行前未加入的圈子。

完成 inbox seed 后生成不含 token 的 UI 清单：

```sh
LOAD_PERFORMANCE_FIXTURE=true npm run fixture:performance -- load-tests/data/accounts.local.json
```

将输出中的 `E2E_PERF_CONVERSATION_ID` 和 `E2E_PERF_SECOND_CONVERSATION_ID` 放入本地环境。大会话列表至少准备 500 个会话，深历史会话建议至少 2,000 条轻量文本消息；图片/视频内存场景应另建 fixture，不能混在默认文本压测中。

每次运行使用新的 `E2E_RUN_ID` / `LOAD_RUN_ID`，便于服务端清理、日志定位和隔离结果。严禁把 access token、密码、验证码或本地账号 JSON 提交到 git。
