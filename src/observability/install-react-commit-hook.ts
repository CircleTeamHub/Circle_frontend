// 副作用模块：只能由根目录 index.ts 在 expo-router/entry 之前导入（见 react-commit-hook）。
import { installReactCommitHook } from './react-commit-hook';

installReactCommitHook(
  globalThis as unknown as Record<string, unknown>,
  typeof __DEV__ !== 'undefined' && __DEV__,
);
