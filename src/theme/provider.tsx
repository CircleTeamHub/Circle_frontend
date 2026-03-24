import React, { createContext, useCallback, useEffect, useState } from 'react';
import { useColorScheme as useSystemScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors } from './colors';
import type { ThemeMode, ResolvedMode, ThemeContextValue } from './types';

/**
 * AsyncStorage 中用于持久化用户主题偏好的存储键。
 * 存储的值为 'light' | 'dark' | 'system' 三者之一。
 */
const STORAGE_KEY = 'circle-im-theme-mode';

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
 * 1. 从 AsyncStorage 中恢复（hydrate）用户上次选择的主题偏好
 * 2. 监听系统配色方案变化（当 themeMode 为 'system' 时自动跟随）
 * 3. 将最终解析后的颜色方案通过 Context 下发给所有子组件
 *
 * 渲染时序：
 * - 在 AsyncStorage 读取完成前（hydrated = false），不渲染任何子组件，
 *   以避免主题从默认值闪烁到用户偏好值的视觉跳变（flash of unstyled theme）。
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
   */
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');

  /**
   * 标识 AsyncStorage 中的主题偏好是否已读取完毕。
   * 在 hydrated 变为 true 之前，Provider 返回 null 以阻止子组件渲染。
   */
  const [hydrated, setHydrated] = useState(false);

  /**
   * 组件挂载时，从 AsyncStorage 中异步读取持久化的主题偏好。
   * - 如果存储的值合法（'light' / 'dark' / 'system'），则恢复为该值
   * - 无论是否找到有效值，最终都标记 hydrated = true 以解除渲染阻塞
   * - 空依赖数组 [] 确保只在首次挂载时执行一次
   */
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setThemeModeState(stored);
      }
      setHydrated(true);
    });
  }, []);

  /**
   * 设置主题模式并同步持久化到 AsyncStorage。
   * 供外部组件调用，例如设置页面中的主题选择器。
   *
   * 使用 useCallback 包裹以保持引用稳定，避免消费组件不必要的重渲染。
   *
   * @param mode - 目标主题模式 ('light' | 'dark' | 'system')
   */
  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    AsyncStorage.setItem(STORAGE_KEY, mode);
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
      AsyncStorage.setItem(STORAGE_KEY, next);
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

  /**
   * 在 AsyncStorage hydration 完成前返回 null，
   * 防止子组件先以默认主题渲染、再闪烁切换到用户偏好主题。
   */
  if (!hydrated) return null;

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
