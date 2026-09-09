import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { DIALOG_SCRIM_ALPHA } from '@/components/ui/glass-surface';
import { Spacing, useTheme, withAlpha } from '@/theme';
import { AppDialogCard } from './app-dialog-card';
import { resolveDialogButtonLayout, type DialogButtonSlot } from './app-dialog-buttons';
import {
  dismissDialog,
  resolveDialogDismissal,
  useAppDialogStore,
  type QueuedDialog,
} from './app-dialog-store';
import { DialogOverlay } from './dialog-overlay';

const EXIT_MS = 140;

const s = StyleSheet.create({
  fill: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  cardFrame: {
    width: '100%',
    alignItems: 'center',
  },
});

/**
 * 全 App 统一的弹窗宿主（iOS / Android / Web 同一套自绘样式）。
 *
 * 数据来自 app-dialog-store 的队列（Alert.alert / Alert.prompt 经 alert-bridge 投入），
 * 这里只负责：取队首 → 弹簧入场 → 处理按钮 / 蒙层 / 返回 → 淡出 → 出队 → 下一条。
 */
export function AppDialogHost() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const head = useAppDialogStore((state) => state.queue[0] ?? null);
  const [shown, setShown] = useState<QueuedDialog | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const progress = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);
  const reduceMotion = useReduceMotion();
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  // 队首 → 屏幕：正在退场的先退完，再接下一条。
  useEffect(() => {
    if (shown || !head) return;
    setShown(head);
    setPromptValue(head.prompt?.defaultValue ?? '');
  }, [head, shown]);

  useEffect(() => {
    if (!shown) return;
    closingRef.current = false;
    if (reduceMotionRef.current) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    Animated.spring(progress, {
      toValue: 1,
      damping: 18,
      stiffness: 260,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
  }, [shown, progress]);

  const close = useCallback(() => {
    if (!shown || closingRef.current) return;
    closingRef.current = true;
    const finish = () => {
      dismissDialog(shown.id);
      setShown(null);
    };
    if (reduceMotionRef.current) {
      finish();
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: EXIT_MS,
      useNativeDriver: true,
    }).start(finish);
  }, [shown, progress]);

  const layout = useMemo(() => {
    if (!shown) return null;
    const buttons =
      shown.buttons && shown.buttons.length > 0
        ? shown.buttons
        : [{ text: t('common.ok', { defaultValue: '知道了' }) }];
    return resolveDialogButtonLayout(buttons);
  }, [shown, t]);

  const handleButtonPress = useCallback(
    (slot: DialogButtonSlot) => {
      if (!shown || closingRef.current) return;
      // 回调在点击的同步栈里先跑，再退场：web 上剪贴板 / window.open 这类要用户
      // 手势的 API 跨过一次 await 就会被拦；原生上导航类回调也更跟手。
      // finally 保证回调抛错也不会把弹窗卡在屏上。
      try {
        if (shown.prompt) {
          slot.button.onPress?.(promptValue);
        } else {
          slot.button.onPress?.();
        }
      } finally {
        close();
      }
    },
    [shown, promptValue, close],
  );

  const handleDismissRequest = useCallback(() => {
    if (!shown || closingRef.current) return;
    const decision = resolveDialogDismissal(shown);
    if (!decision.allowed) return;
    try {
      decision.cancelButton?.onPress?.(shown.prompt ? promptValue : undefined);
      shown.onDismiss?.();
    } finally {
      close();
    }
  }, [shown, promptValue, close]);

  const handlePromptSubmit = useCallback(() => {
    const primary = layout?.slots.find(
      (slot) => slot.role === 'primary' || slot.role === 'destructive',
    );
    if (primary) handleButtonPress(primary);
  }, [layout, handleButtonPress]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });

  return (
    <DialogOverlay visible={shown !== null} onRequestClose={handleDismissRequest}>
      {shown && layout ? (
        <KeyboardAvoidingView
          style={s.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {DIALOG_SCRIM_ALPHA > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: withAlpha(colors.black, DIALOG_SCRIM_ALPHA), opacity: progress },
              ]}
            />
          ) : null}
          {/* 蒙层本身不进无障碍焦点链：读屏用户只在卡片里活动，靠取消按钮关。 */}
          <Pressable
            testID="app-dialog-scrim"
            accessible={false}
            importantForAccessibility="no"
            style={s.center}
            onPress={handleDismissRequest}
          >
            <Animated.View
              // 卡片自己接管触摸，点卡片不会冒泡成"点蒙层关闭"。
              // 只缩放不改 opacity：玻璃材质的祖先透明度 < 1 会让磨砂失效，
              // 淡入淡出交给卡片内容（contentOpacity）。
              onStartShouldSetResponder={() => true}
              style={[s.cardFrame, { transform: [{ scale }] }]}
            >
              <AppDialogCard
                dialog={shown}
                layout={layout}
                contentOpacity={progress}
                promptValue={promptValue}
                onPromptChange={setPromptValue}
                onPromptSubmit={handlePromptSubmit}
                onButtonPress={handleButtonPress}
              />
            </Animated.View>
          </Pressable>
        </KeyboardAvoidingView>
      ) : null}
    </DialogOverlay>
  );
}
