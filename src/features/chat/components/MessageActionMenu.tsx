import { useMemo } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export type MessageAction = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
};

interface MessageActionMenuProps {
  // Screen-space point the long-press happened at; null hides the menu.
  anchor: { x: number; y: number } | null;
  actions: MessageAction[];
  onDismiss: () => void;
}

const ITEM_WIDTH = 60;
const GRID_ITEM_WIDTH = 64;
const GRID_ITEM_HEIGHT = 58;
const GRID_COLUMNS = 4;
const COMPACT_GRID_THRESHOLD = 5;
const H_PADDING = Spacing.xs;
const V_PADDING = Spacing.sm;
const MENU_HEIGHT = 62;
const SCREEN_MARGIN = Spacing.md;
const GAP = 14; // distance between the touch point and the menu

// WeChat-style floating action menu anchored above (or below) the pressed
// bubble, instead of a native Alert. Tapping the backdrop dismisses it.
export function MessageActionMenu({
  anchor,
  actions,
  onDismiss,
}: MessageActionMenuProps) {
  const { colors } = useTheme();
  const { width: screenW, height: screenH } = Dimensions.get('window');

  const layout = useMemo(() => {
    if (!anchor || actions.length === 0) return null;
    const compactGrid = actions.length >= COMPACT_GRID_THRESHOLD;
    if (compactGrid) {
      const maxColumns = Math.max(
        1,
        Math.floor(
          (screenW - SCREEN_MARGIN * 2 - H_PADDING * 2) / GRID_ITEM_WIDTH,
        ),
      );
      const columns = Math.min(GRID_COLUMNS, actions.length, maxColumns);
      const gridRows = Math.ceil(actions.length / columns);
      const menuW = columns * GRID_ITEM_WIDTH + H_PADDING * 2;
      const left = Math.max(
        SCREEN_MARGIN,
        Math.min(anchor.x - menuW / 2, screenW - menuW - SCREEN_MARGIN),
      );
      const height = gridRows * GRID_ITEM_HEIGHT + V_PADDING * 2;
      const placeAbove = anchor.y > height + GAP + 40;
      const rawTop = placeAbove ? anchor.y - height - GAP : anchor.y + GAP;
      // 多行网格在小屏 + 底部锚点时可能溢出屏幕：垂直方向也钳制到可视区内，
      // 与水平方向的 left 钳制对称。菜单比屏还高的极端情况则顶到 SCREEN_MARGIN。
      const top = Math.max(
        SCREEN_MARGIN,
        Math.min(rawTop, screenH - height - SCREEN_MARGIN),
      );
      return { compactGrid, gridRows, left, top, menuW };
    }
    const menuW = Math.min(
      actions.length * ITEM_WIDTH + H_PADDING * 2,
      screenW - SCREEN_MARGIN * 2,
    );
    const left = Math.max(
      SCREEN_MARGIN,
      Math.min(anchor.x - menuW / 2, screenW - menuW - SCREEN_MARGIN),
    );
    // Prefer above the bubble; flip below when too close to the top.
    const placeAbove = anchor.y > MENU_HEIGHT + GAP + 80;
    const top = placeAbove ? anchor.y - MENU_HEIGHT - GAP : anchor.y + GAP;
    return { compactGrid, gridRows: 1, left, top, menuW };
  }, [anchor, actions.length, screenW, screenH]);

  if (!anchor || !layout) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={s.backdrop} onPress={onDismiss}>
        <View
          style={[
            s.menu,
            layout.compactGrid ? s.menuGrid : null,
            {
              left: layout.left,
              top: layout.top,
              width: layout.menuW,
              backgroundColor: colors.text,
            },
          ]}
        >
          {actions.map((action) => (
            <Pressable
              key={action.key}
              style={layout.compactGrid ? s.itemGrid : s.item}
              onPress={() => {
                onDismiss();
                action.onPress();
              }}
            >
              <Ionicons name={action.icon} size={20} color={colors.background} />
              <Text
                style={[s.label, { color: colors.background }]}
                numberOfLines={1}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1 },
  menu: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    paddingVertical: V_PADDING,
    paddingHorizontal: H_PADDING,
  },
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: Spacing.xs,
  },
  label: { ...Typography.tiny },
  itemGrid: {
    width: GRID_ITEM_WIDTH,
    height: GRID_ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: Spacing.xs,
  },
});
