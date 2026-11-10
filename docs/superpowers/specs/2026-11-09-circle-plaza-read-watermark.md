# 圈子广场红点快照已读语义

用户进入圈子广场主页并成功刷新列表后，本次刷新开始时已经存在的所有可见新帖都视为已读；数量和是否滚动到这些帖子都不影响结果。

约束：

- 只有列表刷新成功后才能推进已读状态；刷新失败时红点保持原状。
- feed 必须返回服务端数据库生成的 `snapshotAt`，且本次查询不得返回 `createdAt > snapshotAt` 的帖子。
- 客户端只把这次成功响应的 `snapshotAt` 提交给 `POST /circle-plaza/seen-through`。
- 服务端的 `circlePlazaSeenAt` 只能单调前进到该水位，且不能超过数据库当前时间。
- `snapshotAt` 之后创建的帖子继续保持未读；`seen` 响应和实时同步都要反映这一结果。
- 首次进入、已有缓存后点击带红点的 tab、以及下拉刷新，都遵循同一套“先刷新，后确认水位”逻辑。

兼容与事件次序：旧 `POST /circle-plaza/seen` 保留空 body / 204；新客户端只调用 seen-through，旧节点 404 时恢复红点。缺失或无效 feed 水位归一为 null，列表可显示但不确认。发帖事件 changedAt 使用帖子 createdAt；状态查询先取数据库 observedAt，再以同一时间限制 createdAt 上界及到期判断，true/false 都使用 observedAt 作为版本。seen-through 返回 { hasUpdate, changedAt }，HTTP 与实时结果都忽略更旧版本，失败恢复仅在版本尚未推进时执行；快照携带相同观察版本 circlePlazaChangedAt；仅在不落后时应用红点与版本，其他徽标照常更新。旧无版本快照仅在本地尚无版本时应用红点，不清空已知版本。
