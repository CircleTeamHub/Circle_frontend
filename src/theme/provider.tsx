import React, { createContext, useCallback, useState } from 'react';
import { useColorScheme as useSystemScheme } from 'react-native';
import { storage } from '@/storage';
import { darkColors, lightColors } from './colors';
import type { ThemeMode, ResolvedMode, ThemeContextValue } from './types';

/**
 * MMKV 中用于持久化用户主题偏好的存储键。
 * 存储的值为 'light' | 'dark' | 'system' 三者之一。
 */
const STORAGE_KEY = 'circle-im-theme-mode';

function readStoredThemeMode(): ThemeMode {
  const stored = storage.getString(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system'
    ? stored
    : 'system';
}

/**
 * 主题上下文，向组件树提供当前主题的颜色、模式以及切换方法。
 *
 * 默认值仅在组件未被 ThemeProvider 包裹时作为兜底使用，
 * 此时默认为深色主题 + system 模式。
 */
const ThemeContext = createContext<ThemeContextValue>({
  colors: darkColors,
  themeMode: 'system',
  resolvedMode: 'dark',
  setThemeMode: () => {},
  toggleTheme: () => {},
});

/**
 * 主题提供者组件 —— 管理整个应用的主题状态。
 *
 * 核心职责：
 * 1. 从 MMKV 中恢复用户上次选择的主题偏好（同步读取，无 hydration 异步等待）
 * 2. 监听系统配色方案变化（当 themeMode 为 'system' 时自动跟随）
 * 3. 将最终解析后的颜色方案通过 Context 下发给所有子组件
 *
 * @param children - 需要接收主题上下文的子组件树
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  /**
   * 获取操作系统当前的配色方案（'light' | 'dark' | null）。
   * 当 themeMode 为 'system' 时，使用此值来决定最终采用的颜色方案。
   */
  const systemScheme = useSystemScheme();

  /**
   * 用户选择的主题模式：
   * - 'light'  → 始终使用浅色主题
   * - 'dark'   → 始终使用深色主题
   * - 'system' → 跟随操作系统的配色偏好
   *
   * MMKV 同步读取，初始化阶段就能拿到值，无需等待 hydration、
   * 也就不会再出现"先以默认主题渲染、再闪烁切换到用户偏好"的问题。
   */
  const [themeMode, setThemeModeState] = useState<ThemeMode>(readStoredThemeMode);

  /**
   * 设置主题模式并同步持久化到 MMKV。
   *
   * 使用 useCallback 包裹以保持引用稳定，避免消费组件不必要的重渲染。
   *
   * @param mode - 目标主题模式 ('light' | 'dark' | 'system')
   */
  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    storage.set(STORAGE_KEY, mode);
  }, []);

  /**
   * 在深色和浅色之间快速切换的便捷方法。
   *
   * 切换逻辑：
   * - 当前为深色（显式 dark 或 system 解析为 dark）→ 切换到 light
   * - 其他情况 → 切换到 dark
   *
   * 注意：切换后 themeMode 会从 'system' 变为具体的 'light' 或 'dark'，
   * 即用户的手动切换会覆盖「跟随系统」的行为。
   *
   * 依赖 systemScheme 是因为当 themeMode 为 'system' 时，
   * 需要知道系统当前的配色方案才能决定切换方向。
   */
  const toggleTheme = useCallback(() => {
    setThemeModeState((prev) => {
      const next = prev === 'dark' || (prev === 'system' && systemScheme === 'dark')
        ? 'light'
        : 'dark';
      storage.set(STORAGE_KEY, next);
      return next;
    });
  }, [systemScheme]);

  /**
   * 将 themeMode（可能是 'system'）解析为最终的二元值 'light' | 'dark'。
   *
   * 解析规则：
   * - themeMode 为 'light' 或 'dark' → 直接使用
   * - themeMode 为 'system' → 使用 systemScheme；若 systemScheme 为 null（无法获取），兜底为 'dark'
   */
  const resolvedMode: ResolvedMode =
    themeMode === 'system'
      ? (systemScheme ?? 'dark') === 'dark' ? 'dark' : 'light'
      : themeMode;

  /** 根据最终解析的模式选择对应的颜色方案对象 */
  const colors = resolvedMode === 'dark' ? darkColors : lightColors;

  /** 组装传递给 Context 消费者的完整主题值 */
  const value: ThemeContextValue = {
    colors,        // 当前生效的颜色方案（ThemeColors）
    themeMode,     // 用户选择的原始模式（可能是 'system'）
    resolvedMode,  // 最终解析后的模式（仅 'light' | 'dark'）
    setThemeMode,  // 设置主题模式的方法
    toggleTheme,   // 深色/浅色快速切换的方法
  };

  return React.createElement(ThemeContext.Provider, { value }, children);
}

/**
 * 主题消费 Hook —— 任意组件中获取当前主题上下文。
 *
 * 返回值包含：
 * - colors:       当前生效的颜色方案（darkColors 或 lightColors）
 * - themeMode:    用户设置的主题模式（'light' | 'dark' | 'system'）
 * - resolvedMode: 最终解析的模式（'light' | 'dark'）
 * - setThemeMode: 设置主题模式（同时持久化）
 * - toggleTheme:  快速切换深色/浅色
 *
 * @example
 * ```tsx
 * const { colors, toggleTheme } = useTheme();
 * return <View style={{ backgroundColor: colors.background }} />;
 * ```
 */
export function useTheme(): ThemeContextValue {
  return React.useContext(ThemeContext);
}
