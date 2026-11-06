/* eslint-disable no-undef */
/**
 * 本地持久化用到的两个原生模块,jest-expo 不会自动替身:
 *
 * - AsyncStorage:authStore → secure-auth-storage → @/storage 一路带进来,
 *   原生模块为 null 时在模块求值期就抛。用官方 jest mock(内存实现)。
 * - react-native-nitro-modules:react-native-mmkv 在 Jest 里 createMMKV 会自动
 *   换成内存实现(isTest),但它的 index 仍在求值期 import nitro,而 nitro 求值
 *   就要原生 TurboModule。给一个空壳,真要建原生对象时明确报错。
 *
 * 单个 spec 仍可 jest.mock('@/storage' / '@/stores/authStore') 覆盖。
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject(name) {
      throw new Error(`NitroModules.createHybridObject(${name}) is not available in Jest`);
    },
  },
}));
