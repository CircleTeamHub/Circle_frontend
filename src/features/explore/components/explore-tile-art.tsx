import { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import {
  CHAT_BUBBLE_COLORS,
  CHAT_BUBBLE_EYES,
  CHAT_BUBBLE_PATHS,
  CHAT_BUBBLE_VIEWBOX,
} from '@/components/app/chat-bubble-icon';
import { useTheme } from '@/theme';

// 所有坐标都在磁贴画布（ExploreTile 的 345 × 96）里；插画从右侧探出、被边缘裁掉一截。

// 单位大小的四角闪光（✦），按 size 缩放。
const SPARKLE_PATH =
  'M0 -1C0.12 -0.12 0.12 -0.12 1 0C0.12 0.12 0.12 0.12 0 1C-0.12 0.12 -0.12 0.12 -1 0C-0.12 -0.12 -0.12 -0.12 0 -1Z';
// 单位大小的爱心贴纸，中心在原点。
const HEART_PATH =
  'M0 3.2C-1.6 1.6 -4 0.2 -4 -1.6C-4 -3 -2.9 -4 -1.7 -4C-0.9 -4 -0.3 -3.6 0 -3C0.3 -3.6 0.9 -4 1.7 -4C2.9 -4 4 -3 4 -1.6C4 0.2 1.6 1.6 0 3.2Z';
const MASCOT_LAYERS = ['back', 'front', 'overlap'] as const;

interface Sparkle {
  x: number;
  y: number;
  size: number;
  opacity?: number;
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  /** 只描边的空心泡泡。 */
  ring?: boolean;
}

function TileDecor({ sparkles, bubbles }: { sparkles: Sparkle[]; bubbles: Bubble[] }) {
  const { colors } = useTheme();
  return (
    <>
      {bubbles.map((bubble) =>
        bubble.ring ? (
          <Circle
            key={`b${bubble.x}-${bubble.y}`}
            cx={bubble.x}
            cy={bubble.y}
            r={bubble.r}
            fill="none"
            stroke={colors.white}
            strokeOpacity={0.45}
            strokeWidth={1.5}
          />
        ) : (
          <Circle
            key={`b${bubble.x}-${bubble.y}`}
            cx={bubble.x}
            cy={bubble.y}
            r={bubble.r}
            fill={colors.white}
            fillOpacity={0.18}
          />
        ),
      )}
      {sparkles.map((sparkle) => (
        <Path
          key={`s${sparkle.x}-${sparkle.y}`}
          d={SPARKLE_PATH}
          transform={`translate(${sparkle.x} ${sparkle.y}) scale(${sparkle.size})`}
          fill={colors.white}
          fillOpacity={sparkle.opacity ?? 1}
        />
      ))}
    </>
  );
}

/** 朋友圈：两张错开的拍立得，前一张贴着爱心贴纸。 */
export function MomentsTileArt({ gradient }: { gradient: readonly [string, string] }) {
  const { colors } = useTheme();
  return (
    <>
      <TileDecor
        bubbles={[
          { x: 206, y: 82, r: 10 },
          { x: 186, y: 18, r: 4 },
          { x: 334, y: 86, r: 5, ring: true },
        ]}
        sparkles={[
          { x: 214, y: 26, size: 7 },
          { x: 226, y: 72, size: 4, opacity: 0.85 },
          { x: 330, y: 14, size: 5 },
        ]}
      />
      <G transform="rotate(14 300 52)">
        <Rect x={268} y={18} width={62} height={74} rx={10} fill={colors.black} fillOpacity={0.12} />
        <Rect x={268} y={14} width={62} height={74} rx={10} fill={colors.white} />
        <Rect x={274} y={20} width={50} height={48} rx={6} fill={gradient[0]} fillOpacity={0.25} />
      </G>
      <G transform="rotate(-9 262 58)">
        <Rect x={230} y={25} width={64} height={76} rx={10} fill={colors.black} fillOpacity={0.14} />
        <Rect x={230} y={20} width={64} height={76} rx={10} fill={colors.white} />
        <Rect x={236} y={26} width={52} height={48} rx={6} fill={gradient[1]} fillOpacity={0.28} />
        <Circle cx={276} cy={38} r={6} fill={colors.warning} />
        <Path d="M236 74L254 48L266 62L274 54L288 74Z" fill={gradient[0]} />
        <Path
          d={HEART_PATH}
          transform="translate(236 26) rotate(-14) scale(2.4)"
          fill={colors.error}
          stroke={colors.white}
          strokeWidth={1.1}
          strokeLinejoin="round"
        />
      </G>
    </>
  );
}

/** AI小助手：小助手气泡本尊，白描边贴纸 + 腮红，歪着头从右边探出来。 */
export function AssistantTileArt() {
  const { colors } = useTheme();
  const { width, height } = CHAT_BUBBLE_VIEWBOX;
  return (
    <>
      <TileDecor
        bubbles={[
          { x: 204, y: 80, r: 10 },
          { x: 196, y: 20, r: 4 },
          { x: 336, y: 12, r: 6, ring: true },
        ]}
        sparkles={[
          { x: 222, y: 30, size: 7 },
          { x: 332, y: 78, size: 5 },
          { x: 240, y: 80, size: 3.5, opacity: 0.85 },
        ]}
      />
      <G transform={`translate(284 56) rotate(-12) scale(0.27) translate(${-width / 2} ${-height / 2})`}>
        {/* 贴纸投影 → 白描边 → 本体：粗描边让它在渐变底上跳出来。 */}
        <G transform="translate(0 18)">
          {MASCOT_LAYERS.map((layer) => (
            <Path
              key={`shadow-${layer}`}
              d={CHAT_BUBBLE_PATHS[layer]}
              fill={colors.black}
              fillOpacity={0.14}
              stroke={colors.black}
              strokeOpacity={0.14}
              strokeWidth={26}
              strokeLinejoin="round"
            />
          ))}
        </G>
        {MASCOT_LAYERS.map((layer) => (
          <Path
            key={`outline-${layer}`}
            d={CHAT_BUBBLE_PATHS[layer]}
            fill={colors.white}
            stroke={colors.white}
            strokeWidth={26}
            strokeLinejoin="round"
          />
        ))}
        {MASCOT_LAYERS.map((layer) => (
          <Path
            key={`fill-${layer}`}
            d={CHAT_BUBBLE_PATHS[layer]}
            fill={CHAT_BUBBLE_COLORS[layer]}
            fillRule="evenodd"
          />
        ))}
        <Circle cx={CHAT_BUBBLE_EYES.leftX} cy={CHAT_BUBBLE_EYES.y} r={CHAT_BUBBLE_EYES.r} fill={colors.white} />
        <Circle cx={CHAT_BUBBLE_EYES.rightX} cy={CHAT_BUBBLE_EYES.y} r={CHAT_BUBBLE_EYES.r} fill={colors.white} />
        <Ellipse cx={76} cy={160} rx={18} ry={10} fill={colors.error} fillOpacity={0.55} />
        <Ellipse cx={240} cy={160} rx={18} ry={10} fill={colors.error} fillOpacity={0.55} />
      </G>
    </>
  );
}
