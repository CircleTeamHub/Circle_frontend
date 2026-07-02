import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, Spacing, Typography } from '@/theme';

// 波形条：对称包络（中间高、两端低）+ 稳定的伪随机抖动，形成类似微信的录音波形外观。
const WAVE_HEIGHTS = Array.from({ length: 32 }, (_, i) => {
  const t = i / 31;
  const envelope = Math.sin(t * Math.PI);
  const jitter = ((i * 17) % 9) / 9;
  return 4 + envelope * 24 * (0.45 + jitter * 0.55);
});

interface VoiceRecordingOverlayProps {
  /** 手指是否已滑入取消区。 */
  cancelArmed: boolean;
  /** 已录制秒数。 */
  elapsedSeconds: number;
}

/**
 * 微信式全屏录音浮层：暗化背景 + 居中气泡波形 + 底部取消区/松开发送提示。
 * pointerEvents="none" —— 手势由输入栏「按住说话」的 PanResponder 驱动，浮层纯展示，
 * 不拦截触摸（responder 已在按下时锁定，浮层后出现也不会抢走手势）。
 */
export const VoiceRecordingOverlay: React.FC<VoiceRecordingOverlayProps> = ({
  cancelArmed,
  elapsedSeconds,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const pulse = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 550,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.7,
          duration: 550,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const bubbleColor = cancelArmed ? colors.error : colors.sentBubble;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, styles.dim]} />

      {/* 居中气泡 + 波形 + 计时 */}
      <View style={styles.center}>
        <Animated.View
          style={[styles.bubble, { backgroundColor: bubbleColor, opacity: pulse }]}
        >
          {cancelArmed ? (
            <Ionicons name="close" size={32} color={colors.white} />
          ) : (
            <View style={styles.wave}>
              {WAVE_HEIGHTS.map((h, i) => (
                <View
                  key={i}
                  style={[styles.waveBar, { height: h, backgroundColor: colors.white }]}
                />
              ))}
            </View>
          )}
        </Animated.View>
        <View style={[styles.tail, { borderTopColor: bubbleColor }]} />
        <Text style={[styles.timer, { color: colors.white }]}>
          {elapsedSeconds}&quot;
        </Text>
      </View>

      {/* 底部：取消区（左）+ 松开发送提示 */}
      <View style={styles.bottom}>
        <View style={styles.pillsRow}>
          <View
            style={[
              styles.cancelPill,
              {
                backgroundColor: cancelArmed
                  ? colors.error
                  : 'rgba(255,255,255,0.18)',
              },
            ]}
          >
            <Ionicons name="close" size={28} color={colors.white} />
          </View>
        </View>
        <Text style={[styles.hint, { color: colors.white }]}>
          {cancelArmed
            ? t('chat.voice.cancelTip', { defaultValue: '松开手指，取消发送' })
            : t('chat.voice.swipeCancelTip', {
                defaultValue: '左滑取消 · 松开发送',
              })}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  dim: {
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  center: {
    position: 'absolute',
    top: '34%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bubble: {
    minWidth: 180,
    height: 80,
    borderRadius: 18,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderTopWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
    marginLeft: 36,
    alignSelf: 'center',
  },
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 52,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
    opacity: 0.92,
  },
  timer: {
    ...Typography.body,
    marginTop: Spacing.md,
    opacity: 0.9,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 56,
    alignItems: 'center',
    gap: Spacing.md,
  },
  pillsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  cancelPill: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    ...Typography.small,
    opacity: 0.85,
  },
});
