import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useUploadProgressStore } from '@/stores/upload-progress-store';

interface NoteMediaUploadRingProps {
  /** 与上传时传给 startUploadProgress 的 progressKey 一致(编辑器里就是这张图的 clientId)。 */
  progressKey: string;
}

const RING_SIZE = 44;
const STROKE = 3;
const RADIUS = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/**
 * 字节全交给系统 ≠ 存储那边收完:原图在远距离链路上,「100%」之后还要等好一会儿。
 * 停在 99% 直到这张图真正传完(覆盖层随之消失),不再出现一个说不清在确认什么的阶段。
 */
const MAX_SHOWN_PERCENT = 99;

/**
 * 编辑笔记时盖在每张待上传图片/视频上的圆圈进度(类似微信):暗色蒙层 + 白色进度环 + 百分比。
 * 只在这张图还没传完时挂载;压缩、签名阶段还没有字节进度,环停在 0。
 */
export function NoteMediaUploadRing({ progressKey }: NoteMediaUploadRingProps) {
  const { t } = useTranslation();
  // 只取自己这张的任务:别的图的字节进度不会让这一格重渲染。
  const task = useUploadProgressStore((state) =>
    Object.values(state.tasks).find((item) => item.progressKey === progressKey),
  );
  const total = task?.total != null && task.total > 0 ? task.total : null;
  const percent = task && total !== null
    ? Math.min(MAX_SHOWN_PERCENT, Math.floor((task.loaded / total) * 100))
    : 0;
  const dashOffset = CIRCUMFERENCE * (1 - percent / 100);

  return (
    <View
      style={styles.overlay}
      pointerEvents="none"
      testID="note-media-upload-ring"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('mediaUpload.uploading', { defaultValue: '上传中' })}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
    >
      <View style={styles.ring}>
        <Svg width={RING_SIZE} height={RING_SIZE}>
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={STROKE}
            fill="none"
          />
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            stroke="#FFFFFF"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            strokeDashoffset={dashOffset}
            fill="none"
            // 从 12 点方向顺时针走。
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          />
        </Svg>
        <Text style={styles.percent}>{percent}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  ring: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  percent: {
    position: 'absolute',
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});
