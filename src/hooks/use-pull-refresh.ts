import { useCallback, useState } from 'react';

/**
 * 列表下拉刷新控件的 refreshing:只在人真的往下拉时为 true,直到这次重拉结束。
 *
 * 进页面、回到页面、操作完重拉这些自动加载不能驱动它:iOS 的 UIRefreshControl 被程序
 * 置成刷新态时会把整张列表往下推一截转圈,加载完再弹回去,看起来就是内容从下往上弹。
 * 自动加载的进度请用页面自己的 loading 状态(列表为空时在中间转圈)。
 */
export function usePullRefresh(reload: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void reload().finally(() => setRefreshing(false));
  }, [reload]);
  return { refreshing, onRefresh };
}
