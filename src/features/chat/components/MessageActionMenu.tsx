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
const VERTICAL_WIDTH = 180;
const VERTICAL_ITEM_HEIGHT = 50;
const H_PADDING = Spacing.xs;
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
  const { width: screenW } = Dimensions.get('window');

  const layout = useMemo(() => {
    if (!anchor || actions.length === 0) return null;
    const vertical = actions.length > 4;
    if (vertical) {
      const menuW = Math.min(VERTICAL_WIDTH, screenW - SCREEN_MARGIN * 2);
      const left = Math.max(
        SCREEN_MARGIN,
        Math.min(anchor.x - menuW / 2, screenW - menuW - SCREEN_MARGIN),
      );
      const height = actions.length * VERTICAL_ITEM_HEIGHT + H_PADDING * 2;
      const placeAbove = anchor.y > height + GAP + 40;
      const top = placeAbove ? anchor.y - height - GAP : anchor.y + GAP;
      return { left, top, menuW, vertical };
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
    return { left, top, menuW, vertical };
  }, [anchor, actions.length, screenW]);

  if (!anchor || !layout) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={s.backdrop} onPress={onDismiss}>
        <View
          style={[
            s.menu,
            layout.vertical ? s.menuVertical : null,
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
              style={layout.vertical ? s.itemVertical : s.item}
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
    paddingVertical: Spacing.sm,
    paddingHorizontal: H_PADDING,
  },
  menuVertical: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: Spacing.xs,
  },
  label: { ...Typography.tiny },
  itemVertical: {
    height: VERTICAL_ITEM_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
});
