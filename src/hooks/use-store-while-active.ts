import { useCallback, useSyncExternalStore } from 'react';

/** zustand 的 bound hook 与 vanilla store 都满足这个形状。 */
interface SubscribableStore<S> {
  getState: () => S;
  subscribe: (listener: () => void) => () => void;
}

const NO_SUBSCRIPTION = () => {};

/**
 * 只在 active 时订阅 store:不活跃期间 store 怎么变都不触发重渲染,重新活跃时
 * 立刻按当下状态取一次值。
 *
 * 为什么 freezeOnBlur 不够:原生栈为了右滑返回能露出下一层,不会冻结「紧挨在当前页
 * 下面」的那一页 —— 聊天页压在会话列表上时,列表照样逐条收消息、整表重算。
 *
 * selector 的返回值必须引用稳定(直接取 store 里的现成字段,或返回字符串/数字),
 * 每次都 new 一个对象会让 useSyncExternalStore 判成「一直在变」。selector 最好是
 * 模块级常量或 useCallback 包过的,省得每次渲染都换一次取值函数。
 */
export function useStoreWhileActive<S, T>(
  store: SubscribableStore<S>,
  selector: (state: S) => T,
  active: boolean,
): T {
  const subscribe = useCallback(
    (onChange: () => void) => (active ? store.subscribe(onChange) : NO_SUBSCRIPTION),
    [active, store],
  );
  const getSnapshot = useCallback(() => selector(store.getState()), [selector, store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
