import { Radius, Spacing, Typography, useTheme } from '@/theme';
import * as Haptics from 'expo-haptics';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Platform,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/** 每个字母的标准高度;区域放不下全部字母时(小屏 + 27 个字母)按比例压扁。 */
const LETTER_HEIGHT = Spacing.md;
/**
 * 触控宽度直接做在索引条本身上(字母靠右摆):iOS 上触点超出父视图的 hitSlop 收不到,
 * 往左扩只能靠加宽。上下仍用 hitSlop,第一个/最后一个字母不必压得那么准。
 */
const BAR_WIDTH = Spacing.xl;
const BAR_HIT_SLOP = { top: Spacing.sm, bottom: Spacing.sm };
/**
 * 按住时索引条左边冒出的气泡:直径 48 的圆 + 指向字母的尖角。尖角是正方形不做圆角的那一角,
 * 整体转 45° 后伸出圆外约 10;气泡右缘离索引条再留 20,尖角离字母中心约 30(照设计图)。
 */
const BUBBLE_SIZE = Spacing.xxl;
const BUBBLE_OFFSET_RIGHT = BAR_WIDTH + Spacing.md + Spacing.xs;
/**
 * 读屏双击:TalkBack 走 activate 动作,VoiceOver 走 onAccessibilityTap。iOS 上不声明 activate ——
 * 新架构会把它原样塞进 VoiceOver 的「操作」列表,多出一个没翻译的 "activate"。
 */
const ANDROID_ACTIVATE_ACTIONS: AccessibilityActionInfo[] | undefined =
  Platform.OS === 'android' ? [{ name: 'activate' }] : undefined;

const returnTrue = () => true;
const returnFalse = () => false;

const s = StyleSheet.create({
  area: {
    position: 'absolute',
    right: 0,
    width: BAR_WIDTH,
    justifyContent: 'center',
    pointerEvents: 'box-none',
  },
  bar: {
    width: BAR_WIDTH,
  },
  // 字母本身不参与命中:触点永远落在索引条上,按下时的 locationY 才是相对索引条的。
  letters: {
    pointerEvents: 'none',
    paddingRight: Spacing.xs,
  },
  letterCell: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  letterDot: {
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letterText: {
    ...Typography.tiny,
  },
  bubble: {
    position: 'absolute',
    right: BUBBLE_OFFSET_RIGHT,
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  bubbleShape: {
    ...StyleSheet.absoluteFillObject,
    borderTopLeftRadius: BUBBLE_SIZE / 2,
    borderBottomLeftRadius: BUBBLE_SIZE / 2,
    borderBottomRightRadius: BUBBLE_SIZE / 2,
    transform: [{ rotate: '45deg' }],
  },
  bubbleText: {
    ...Typography.title,
  },
});

interface ContactIndexBarProps {
  /** 与列表分组一一对应:第 i 个字母就是第 i 组。 */
  letters: readonly string[];
  onSelect: (sectionIndex: number) => void;
  /** 索引条可占的竖向区域(top / bottom);索引条在区域里垂直居中。 */
  style?: StyleProp<ViewStyle>;
}

/**
 * 通讯录右侧的字母索引(微信同款):点字母跳到该组,按住上下滑动时跟着手指连续跳,
 * 索引条左边冒出气泡显示当前字母、随手指上下走,松手消失。读屏用户逐个字母聚焦、双击跳转。
 */
export const ContactIndexBar = memo(function ContactIndexBar({
  letters,
  onSelect,
  style,
}: ContactIndexBarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [areaHeight, setAreaHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // 按下时记下 locationY 与 pageY,之后只看 pageY 的位移 —— 手指滑出索引条后,
  // locationY 在安卓上会换成手指下那个视图的坐标,直接用会乱跳。
  const gestureRef = useRef({ startLocationY: 0, startPageY: 0, index: -1 });

  const letterHeight =
    areaHeight > 0 ? Math.min(LETTER_HEIGHT, areaHeight / letters.length) : LETTER_HEIGHT;

  const selectAt = useCallback(
    (y: number) => {
      const index = Math.min(letters.length - 1, Math.max(0, Math.floor(y / letterHeight)));
      if (index === gestureRef.current.index) return;
      gestureRef.current = { ...gestureRef.current, index };
      setActiveIndex(index);
      onSelect(index);
      void Haptics.selectionAsync();
    },
    [letterHeight, letters.length, onSelect],
  );

  const handleGrant = useCallback(
    (event: GestureResponderEvent) => {
      const { locationY, pageY } = event.nativeEvent;
      gestureRef.current = { startLocationY: locationY, startPageY: pageY, index: -1 };
      selectAt(locationY);
    },
    [selectAt],
  );

  const handleMove = useCallback(
    (event: GestureResponderEvent) => {
      const { startLocationY, startPageY } = gestureRef.current;
      selectAt(startLocationY + event.nativeEvent.pageY - startPageY);
    },
    [selectAt],
  );

  const handleEnd = useCallback(() => {
    gestureRef.current = { ...gestureRef.current, index: -1 };
    setActiveIndex(null);
  }, []);

  const handleAreaLayout = useCallback((event: LayoutChangeEvent) => {
    setAreaHeight(event.nativeEvent.layout.height);
  }, []);

  const handleAccessibilityAction = useCallback(
    (index: number, event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'activate') onSelect(index);
    },
    [onSelect],
  );

  const d = useMemo(
    () => ({
      letterCell: { height: letterHeight },
      letterDot: { width: letterHeight, height: letterHeight },
      letterDotActive: { backgroundColor: colors.primary },
      letterText: { color: colors.textSecondary },
      letterTextActive: { color: colors.white },
      bubbleShape: { backgroundColor: colors.indexBubble },
      bubbleText: { color: colors.white },
    }),
    [colors, letterHeight],
  );

  // 气泡的竖直中心对准当前字母的中心。
  const bubblePosition = useMemo(
    () => ({ top: (activeIndex ?? 0) * letterHeight + (letterHeight - BUBBLE_SIZE) / 2 }),
    [activeIndex, letterHeight],
  );

  const jumpHint = t('contacts.indexJumpHint');
  const activeLetter = activeIndex === null ? undefined : letters[activeIndex];

  return (
    <View style={[s.area, style]} onLayout={handleAreaLayout}>
      <View
        testID="contacts-index-bar"
        style={s.bar}
        hitSlop={BAR_HIT_SLOP}
        onStartShouldSetResponder={returnTrue}
        onResponderTerminationRequest={returnFalse}
        onResponderGrant={handleGrant}
        onResponderMove={handleMove}
        onResponderRelease={handleEnd}
        onResponderTerminate={handleEnd}
      >
        <View style={s.letters}>
          {letters.map((letter, index) => {
            const active = index === activeIndex;
            return (
              <View
                key={letter}
                accessible
                accessibilityRole="button"
                accessibilityLabel={letter}
                accessibilityHint={jumpHint}
                accessibilityActions={ANDROID_ACTIVATE_ACTIONS}
                onAccessibilityAction={(event) => handleAccessibilityAction(index, event)}
                onAccessibilityTap={() => onSelect(index)}
                style={[s.letterCell, d.letterCell]}
              >
                <View style={[s.letterDot, d.letterDot, active && d.letterDotActive]}>
                  {/* 索引条的几何是固定的,字号不跟系统放大;要看清就看按住时冒出的气泡。 */}
                  <Text
                    allowFontScaling={false}
                    style={[s.letterText, active ? d.letterTextActive : d.letterText]}
                  >
                    {letter}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
        {activeLetter ? (
          <View
            testID="contacts-index-bubble"
            style={[s.bubble, bubblePosition]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={[s.bubbleShape, d.bubbleShape]} />
            <Text allowFontScaling={false} style={[s.bubbleText, d.bubbleText]}>
              {activeLetter}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});
