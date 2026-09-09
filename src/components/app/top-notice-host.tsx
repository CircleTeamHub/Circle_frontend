import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  TopBannerCard,
  topBannerHiddenOffset,
  topBannerSurface,
} from '@/components/ui/top-banner-card';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useSwipeUpDismiss } from '@/hooks/use-swipe-up-dismiss';
import { Radius, Spacing, useTheme, withAlpha, type ThemeColors } from '@/theme';
import { fireTopNoticeHaptic } from './top-notice-haptics';
import { useTopNoticeStore, type TopNotice, type TopNoticeType } from './top-notice-store';

const EXIT_MS = 180;

const ICONS: Record<TopNoticeType, keyof typeof Ionicons.glyphMap> = {
  success: 'checkmark-circle',
  error: 'close-circle',
  warning: 'alert-circle',
  info: 'information-circle',
};

function tintFor(type: TopNoticeType, colors: ThemeColors): string {
  switch (type) {
    case 'success':
      return colors.success;
    case 'error':
      return colors.danger;
    case 'warning':
      return colors.warning;
    default:
      return colors.primary;
  }
}

const s = StyleSheet.create({
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs,
  },
  actionPressed: {
    opacity: 0.6,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});

/**
 * 顶部提醒宿主：操作回执（已复制 / 保存失败 / 已发送……）从状态栏上方滑入，
 * 到时自动收起，上滑可提前关掉。挂在根布局，任何页面（含 web）都能用
 * `topNotice.success(...)` 直接发。
 *
 * 进出场只做位移：卡片是玻璃材质，祖先 opacity < 1 会让磨砂失效。
 */
export function TopNoticeHost() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const current = useTopNoticeStore((state) => state.current);
  const hide = useTopNoticeStore((state) => state.hide);
  // current 是 store 里最新的；shown 是屏幕上那条 —— 分开才能让旧的先退场再换新的。
  const [shown, setShown] = useState<TopNotice | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;
  const anim = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  const { panHandlers, dragY } = useSwipeUpDismiss(() => {
    if (shown) hide(shown.id);
  });

  useEffect(() => {
    if (current === shown) return;
    if (!shown || reduceMotionRef.current) {
      setShown(current);
      return;
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: EXIT_MS,
      useNativeDriver: true,
    }).start(() => setShown(currentRef.current));
  }, [current, shown, anim]);

  useEffect(() => {
    if (!shown) return;
    dragY.setValue(0);
    if (reduceMotionRef.current) {
      anim.setValue(1);
    } else {
      anim.setValue(0);
      Animated.spring(anim, {
        toValue: 1,
        damping: 16,
        stiffness: 220,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    }
    void fireTopNoticeHaptic(shown.type);
    const timer = setTimeout(() => hide(shown.id), shown.durationMs);
    return () => clearTimeout(timer);
  }, [shown, anim, dragY, hide]);

  const handleAction = useCallback(() => {
    if (!shown?.action) return;
    shown.action.onPress();
    hide(shown.id);
  }, [shown, hide]);

  if (!shown) return null;

  const tint = tintFor(shown.type, colors);

  return (
    <View
      pointerEvents="box-none"
      style={[topBannerSurface.host, { paddingTop: insets.top + Spacing.sm }]}
    >
      <Animated.View
        {...panHandlers}
        style={[
          topBannerSurface.frame,
          {
            transform: [
              {
                translateY: Animated.add(
                  anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [topBannerHiddenOffset(insets.top), 0],
                  }),
                  dragY,
                ),
              },
            ],
          },
        ]}
      >
        <TopBannerCard>
          <View style={[s.iconBadge, { backgroundColor: withAlpha(tint, 0.14) }]}>
            <Ionicons name={ICONS[shown.type]} size={20} color={tint} />
          </View>
          {/* 文字块整体当一条 alert 播报；动作按钮留在外面单独可聚焦。 */}
          <View
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={topBannerSurface.textBlock}
          >
            <Text style={[topBannerSurface.title, { color: colors.text }]} numberOfLines={2}>
              {shown.title}
            </Text>
            {shown.message ? (
              <Text
                style={[topBannerSurface.summary, { color: colors.textSecondary }]}
                numberOfLines={2}
              >
                {shown.message}
              </Text>
            ) : null}
          </View>
          {shown.action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={shown.action.label}
              onPress={handleAction}
              hitSlop={8}
              style={({ pressed }) => [s.action, pressed && s.actionPressed]}
            >
              <Text style={[s.actionLabel, { color: colors.link }]}>{shown.action.label}</Text>
            </Pressable>
          ) : null}
        </TopBannerCard>
      </Animated.View>
    </View>
  );
}
