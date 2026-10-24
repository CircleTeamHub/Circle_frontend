import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import {
  cancelAnimation,
  Easing,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

interface MemberNameAnimationContextValue {
  progress: SharedValue<number>;
  reduceMotionEnabled: boolean;
  registerConsumer: () => () => void;
}

const MemberNameAnimationContext =
  createContext<MemberNameAnimationContextValue | null>(null);

export function MemberNameAnimationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const progress = useSharedValue(0);
  const consumerCountRef = useRef(0);
  const [hasConsumers, setHasConsumers] = useState(false);
  const [appIsActive, setAppIsActive] = useState(
    AppState.currentState == null || AppState.currentState === 'active',
  );
  // 系统偏好读取完成前默认禁用动画，避免 Reduce Motion 用户启动时短暂看到流光。
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(true);

  const registerConsumer = useCallback(() => {
    consumerCountRef.current += 1;
    if (consumerCountRef.current === 1) {
      setHasConsumers(true);
    }

    let registered = true;
    return () => {
      if (!registered) {
        return;
      }
      registered = false;
      consumerCountRef.current = Math.max(0, consumerCountRef.current - 1);
      if (consumerCountRef.current === 0) {
        setHasConsumers(false);
      }
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppIsActive(nextState === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let mounted = true;
    // 初次读取是异步的,而 reduceMotionChanged 事件可能先到:用户刚打开
    // Reduce Motion,随后那个「开关还没打开时」的 false 才 resolve —— 只有
    // mounted 守卫的话它会把用户的新偏好覆盖回去,所有名字重新开始流光。
    // 一旦收到过事件,初次读取的结果就已经过期,直接丢弃。
    let sawEvent = false;
    const applyInitial = (enabled: boolean) => {
      if (!mounted || sawEvent) return;
      setReduceMotionEnabled(enabled);
    };
    const applyEvent = (enabled: boolean) => {
      sawEvent = true;
      if (mounted) setReduceMotionEnabled(enabled);
    };

    void AccessibilityInfo.isReduceMotionEnabled()
      .then(applyInitial)
      // 读不到系统偏好时按「不限制动画」处理,与首屏默认禁用配对:
      // 默认禁用只是为了不让 Reduce Motion 用户在启动瞬间看到流光。
      .catch(() => applyInitial(false));

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      applyEvent,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;

    if (hasConsumers && appIsActive && !reduceMotionEnabled) {
      progress.value = withRepeat(
        withTiming(1, { duration: 2600, easing: Easing.linear }),
        -1,
        false,
      );
    }

    return () => cancelAnimation(progress);
  }, [appIsActive, hasConsumers, progress, reduceMotionEnabled]);

  const value = useMemo(
    () => ({ progress, reduceMotionEnabled, registerConsumer }),
    [progress, reduceMotionEnabled, registerConsumer],
  );

  return (
    <MemberNameAnimationContext.Provider value={value}>
      {children}
    </MemberNameAnimationContext.Provider>
  );
}

const NO_SUBSCRIPTION = () => {};

/**
 * 所在页面此刻是否在前台。tab 页切走后并不卸载、上面压了新页面也不卸载 ——
 * 只靠卸载计数的话,「我的」页上自己的名字会让时钟在别的 tab 里一直跑。
 *
 * 直接读 NavigationContext 而不用 useIsFocused:后者在页面外会抛错,而名字也会
 * 出现在弹窗宿主、测试桩这类不属于任何页面的地方,那里一律按「可见」处理。
 * watch=false 时不订阅:列表里几十个静态名字没必要各挂一份 focus/blur 监听。
 */
function useScreenFocused(watch: boolean): boolean {
  const navigation = useContext(NavigationContext);
  const tracked = watch ? navigation : undefined;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!tracked) {
        return NO_SUBSCRIPTION;
      }
      const offFocus = tracked.addListener('focus', onChange);
      const offBlur = tracked.addListener('blur', onChange);
      return () => {
        offFocus();
        offBlur();
      };
    },
    [tracked],
  );
  const getSnapshot = useCallback(() => tracked?.isFocused() ?? true, [tracked]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useMemberNameAnimation(enabled: boolean): {
  progress: SharedValue<number>;
  reduceMotionEnabled: boolean;
} {
  const context = useContext(MemberNameAnimationContext);
  if (!context) {
    throw new Error(
      'MemberName must be rendered inside MemberNameAnimationProvider',
    );
  }
  const { progress, reduceMotionEnabled, registerConsumer } = context;
  const screenFocused = useScreenFocused(enabled);
  const active = enabled && screenFocused;

  useEffect(() => {
    if (!active) {
      return;
    }
    return registerConsumer();
  }, [active, registerConsumer]);

  return {
    progress,
    reduceMotionEnabled,
  };
}
