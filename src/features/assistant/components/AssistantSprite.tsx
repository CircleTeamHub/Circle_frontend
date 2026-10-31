import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import {
  CHAT_BUBBLE_COLORS,
  CHAT_BUBBLE_EYES,
  CHAT_BUBBLE_VIEWBOX,
  ChatBubbleIcon,
} from '@/components/app/chat-bubble-icon';
import { useAssistantSpriteMotion } from '@/features/assistant/hooks/use-assistant-sprite-motion';
import { useTheme } from '@/theme';

const STAGE = 104;
const DISC = 80;
const MARK = 48;
const CENTER = STAGE / 2;
const ORBIT_R = 48;
const RING_R = DISC / 2 - 1;
const DIAGONAL = ORBIT_R * Math.SQRT1_2;
const SPARKLE_R = 6;
const MARK_HEIGHT = (MARK * CHAT_BUBBLE_VIEWBOX.height) / CHAT_BUBBLE_VIEWBOX.width;
const EYE_SCALE = MARK / CHAT_BUBBLE_VIEWBOX.width;
const EYE_SIZE = CHAT_BUBBLE_EYES.r * 2 * EYE_SCALE;
const EYE_TOP = CHAT_BUBBLE_EYES.y * EYE_SCALE - EYE_SIZE / 2;

/** Four-point AI sparkle: quadratic curves pulled through its own centre. */
function sparklePath(cx: number, cy: number, r: number): string {
  return (
    `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}` +
    `Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}` +
    `Q${cx} ${cy} ${cx} ${cy - r}Z`
  );
}

const SPARKLE = sparklePath(CENTER + DIAGONAL, CENTER - DIAGONAL, SPARKLE_R);

type AssistantSpriteProps = {
  /** True for a moment after the assistant replies: hop + orbit sweep. */
  reacting?: boolean;
};

/**
 * The assistant's header character. The mark (eyes drawn here so they can
 * blink) sits on a glowing disc; a gradient ring, dashed orbit and
 * sparkle satellite give it the AI read and sweep once around when it replies.
 */
export function AssistantSprite({ reacting = false }: AssistantSpriteProps) {
  const { colors } = useTheme();
  const { blink, hop, orbitRotate } = useAssistantSpriteMotion(reacting);

  return (
    <View accessible={false} pointerEvents="none" style={styles.stage}>
      <View style={[styles.disc, { backgroundColor: colors.surface }]} />
      <Animated.View
        style={[styles.orbit, { transform: [{ rotate: orbitRotate }] }]}
      >
        <Svg height={STAGE} width={STAGE}>
          <Defs>
            <LinearGradient id="assistantRing" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={CHAT_BUBBLE_COLORS.back} />
              <Stop offset="1" stopColor={CHAT_BUBBLE_COLORS.front} />
            </LinearGradient>
          </Defs>
          <Circle
            cx={CENTER}
            cy={CENTER}
            fill="none"
            r={ORBIT_R}
            stroke={colors.glassBorder}
            strokeDasharray="2 6"
            strokeWidth={1}
          />
          <Circle
            cx={CENTER}
            cy={CENTER}
            fill="none"
            r={RING_R}
            stroke="url(#assistantRing)"
            strokeWidth={1.5}
          />
          <Path d={SPARKLE} fill="url(#assistantRing)" />
          <Circle
            cx={CENTER - DIAGONAL}
            cy={CENTER + DIAGONAL}
            fill={CHAT_BUBBLE_COLORS.front}
            r={2}
          />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.mark, { transform: [{ translateY: hop }] }]}>
        <ChatBubbleIcon showEyes={false} size={MARK} />
        <Animated.View
          style={[styles.eye, styles.leftEye, { transform: [{ scaleY: blink }] }]}
        />
        <Animated.View
          style={[styles.eye, styles.rightEye, { transform: [{ scaleY: blink }] }]}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    height: STAGE,
    justifyContent: 'center',
    width: STAGE,
  },
  // The glow reuses the mark's two layers in their offset directions: the
  // lavender back bubble up-right, the pink front one down-left.
  disc: {
    borderRadius: DISC / 2,
    boxShadow:
      '8px -8px 24px rgba(165, 166, 246, 0.45), -8px 8px 24px rgba(239, 181, 237, 0.35)',
    height: DISC,
    position: 'absolute',
    width: DISC,
  },
  orbit: {
    ...StyleSheet.absoluteFillObject,
  },
  mark: {
    height: MARK_HEIGHT,
    width: MARK,
  },
  eye: {
    backgroundColor: '#FFFFFF',
    borderRadius: EYE_SIZE / 2,
    height: EYE_SIZE,
    position: 'absolute',
    top: EYE_TOP,
    width: EYE_SIZE,
  },
  leftEye: {
    left: CHAT_BUBBLE_EYES.leftX * EYE_SCALE - EYE_SIZE / 2,
  },
  rightEye: {
    left: CHAT_BUBBLE_EYES.rightX * EYE_SCALE - EYE_SIZE / 2,
  },
});
