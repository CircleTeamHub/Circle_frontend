let lastGroupMutationAt = 0;

/**
 * 群相关的写请求(两种群的成员、角色、禁言、公告、头像、策略、改名、转让、入群审批…)
 * 成功后记一笔。群聊信息、群管理、入群申请列表回到前台时据此判断能不能跳过重拉:
 * 拉过之后改过任何东西就必须重拉。宁可多拉,不显示旧数据。
 *
 * 写请求分散在 chat-core/api(独立群/通用群操作)、services/api/groups(圈子群成员)
 * 与 group-admissions(入群申请)三处,所以单独成一个模块。包的是 Promise 而不是
 * apiClient 本身:每个调用点仍然是静态路径,诊断路由覆盖照常能扫到。
 */
export async function markGroupWrite<T>(request: Promise<T>): Promise<T> {
  const result = await request;
  lastGroupMutationAt = Date.now();
  return result;
}

/** since 之后有没有成功的群写请求。 */
export function groupsMutatedSince(since: number): boolean {
  return lastGroupMutationAt >= since;
}
