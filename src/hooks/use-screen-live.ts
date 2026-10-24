import { useEffect, useState } from 'react';
import { useIsFocused, useNavigation } from '@react-navigation/native';

type StackEventName = 'focus' | 'blur' | 'transitionStart' | 'transitionEnd';

/** native-stack 屏幕上用到的那几个事件;不从 @react-navigation/native-stack 引类型(非直接依赖)。 */
interface StackScreenEvents {
  addListener: (
    type: StackEventName,
    listener: (event: { data?: { closing?: boolean } }) => void,
  ) => () => void;
}

/**
 * 页面此刻要不要跟着数据实时刷新:在前台,或者正被返回手势露出来。
 *
 * 只看 isFocused 不够:native-stack 要等返回动画结束(onDismissed)才真正出栈,
 * 右滑返回的整个过程中底下这页都还是「失焦」—— 露出来的是上一页压上去那一刻的旧数据,
 * 松手才跳成最新。栈在手势一开始就给这页发 transitionStart(closing:false),
 * 手势取消时这页会收到 transitionEnd(closing:true)。
 */
export function useScreenLive(): boolean {
  const navigation = useNavigation() as unknown as StackScreenEvents;
  const isFocused = useIsFocused();
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    const offStart = navigation.addListener('transitionStart', (event) => {
      if (event.data?.closing === false) setRevealing(true);
    });
    const offEnd = navigation.addListener('transitionEnd', (event) => {
      if (event.data?.closing) setRevealing(false);
    });
    // 真正 focus 之后交还给 isFocused;blur 时也清掉,免得下一次压栈继承一个过期的「露出中」。
    const offFocus = navigation.addListener('focus', () => setRevealing(false));
    const offBlur = navigation.addListener('blur', () => setRevealing(false));
    return () => {
      offStart();
      offEnd();
      offFocus();
      offBlur();
    };
  }, [navigation]);

  return isFocused || revealing;
}
