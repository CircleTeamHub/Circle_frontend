/**
 * react-commit-hook.ts — 生产包里拿到 React 每一次提交（commit）的回调。
 *
 * React 渲染器在模块加载时读一次 globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__，存在就把它记下，
 * 之后每次提交都调 onCommitFiberRoot（生产版也调，只是不带优先级）。开发包里 RN 已经装了
 * 真正的 DevTools 钩子，这里不碰；生产包没人装，我们装一个只负责转发的最小钩子。
 *
 * 必须先于渲染器加载：由仓库根目录的 index.ts 在 expo-router/entry 之前导入。所以本模块
 * 不能 import 任何东西——一 import 就可能把渲染器提前拉进来。
 */
export type ReactCommitListener = (root: unknown) => void;

const listeners = new Set<ReactCommitListener>();

export function installReactCommitHook(target: Record<string, unknown>, isDev: boolean): boolean {
  if (isDev || target.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== undefined) return false;
  target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject: () => 1,
    onCommitFiberRoot: (_rendererId: unknown, root: unknown) => {
      for (const listener of listeners) listener(root);
    },
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    checkDCE: () => {},
  };
  return true;
}

export function subscribeReactCommits(listener: ReactCommitListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
