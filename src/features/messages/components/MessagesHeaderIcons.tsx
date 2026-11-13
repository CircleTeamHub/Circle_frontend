import type { ReactNode } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

// The four messages-header glyphs ("双色" set, docs/superpowers/specs/2026-11-12-messages-header-icons-design.md):
// 2px line on a 24 grid; the glyphs that enclose an area get one soft tint in the icon colour, the same stroke-plus-fill
// language as the tab bar's PlaneLogoIcon. Tints are opacities of `color`, so both themes just work.

function Glyph({ color, children }: { color: string; children: ReactNode }) {
  return (
    <Svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

/** 圈子通知: the 圈子 tab's paper plane, kept inside a full ring (nothing pokes out of the box). */
export function CircleNotificationsIcon({ color }: { color: string }) {
  return (
    <Glyph color={color}>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M15.4 8.3 7.8 12.1 10.75 13.35 12 16.3Z" fill={color} fillOpacity={0.3} strokeWidth={1.75} />
      <Path d="M10.75 13.35 15.4 8.3" strokeWidth={1.75} />
    </Glyph>
  );
}

/** 多选: a checked row above an unchecked one. `background` cuts the check out of the solid dot. */
export function SelectChatsIcon({ color, background }: { color: string; background: string }) {
  return (
    <Glyph color={color}>
      <Circle cx={6} cy={8} r={4} fill={color} stroke="none" />
      <Path d="M4.3 8.1l1.2 1.2 2.2-2.4" stroke={background} strokeWidth={1.6} />
      <Circle cx={6} cy={16} r={3} fill={color} fillOpacity={0.22} />
      <Path d="M13 8h7M13 16h7" />
    </Glyph>
  );
}

/** 搜索: tinted lens with a small highlight, slightly heavier handle. */
export function HeaderSearchIcon({ color }: { color: string }) {
  return (
    <Glyph color={color}>
      <Circle cx={10.5} cy={10.5} r={6.5} fill={color} fillOpacity={0.14} />
      <Path d="m15.4 15.4 4.6 4.6" strokeWidth={2.6} />
      <Path d="M7.2 9.3A3.5 3.5 0 0 1 9.3 7.2" strokeWidth={1.5} />
    </Glyph>
  );
}

/** Bare line ＋ like its neighbours (a tinted disc behind it read as a button). Rotating it 45° gives ×. */
export function QuickAddIcon({ color }: { color: string }) {
  return (
    <Glyph color={color}>
      <Path d="M12 4v16M4 12h16" />
    </Glyph>
  );
}
