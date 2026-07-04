import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { CircleAvatar } from '@/components/ui/circle-avatar';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { Circle } from '@/types';
import {
  normalizeCircleShortcutOrder,
  orderCircleShortcuts,
  reorderCircleShortcut,
} from '@/features/discover/utils/circle-shortcut-order';

interface CircleShortcutOrderSheetProps {
  visible: boolean;
  circles: Circle[];
  orderIds: string[];
  onSave: (ids: string[]) => void;
  onReset: () => void;
  onClose: () => void;
}

const ORDER_ROW_HEIGHT = 52;

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    maxHeight: '78%',
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.xs,
  },
  title: {
    flex: 1,
    ...Typography.h3,
  },
  hint: {
    ...Typography.caption,
    marginBottom: Spacing.md,
  },
  list: {
    maxHeight: 420,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    minHeight: ORDER_ROW_HEIGHT,
  },
  draggingRow: {
    borderRadius: Radius.lg,
  },
  rowText: {
    flex: 1,
    ...Typography.body,
    fontWeight: '600',
  },
  dragHandle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingTop: Spacing.md,
  },
  footerButton: {
    flex: 1,
    height: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerText: {
    ...Typography.body,
    fontWeight: '700',
  },
});

export function CircleShortcutOrderSheet({
  visible,
  circles,
  orderIds,
  onSave,
  onReset,
  onClose,
}: CircleShortcutOrderSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const dragY = useRef(new Animated.Value(0)).current;
  const [draftOrderIds, setDraftOrderIds] = useState<string[]>([]);
  const [draggingCircleId, setDraggingCircleId] = useState<string | null>(null);
  const draftOrderIdsRef = useRef<string[]>([]);
  const dragMetaRef = useRef<{
    circleId: string;
    startIndex: number;
    activeIndex: number;
  } | null>(null);
  const dragRespondersRef = useRef(
    new Map<string, ReturnType<typeof PanResponder.create>>(),
  );

  useEffect(() => {
    if (!visible) {
      dragMetaRef.current = null;
      dragY.stopAnimation();
      dragY.setValue(0);
      setDraggingCircleId(null);
      return;
    }
    setDraftOrderIds(normalizeCircleShortcutOrder(circles, orderIds));
  }, [circles, dragY, orderIds, visible]);

  useEffect(() => {
    draftOrderIdsRef.current = draftOrderIds;
  }, [draftOrderIds]);

  useEffect(() => {
    dragRespondersRef.current.clear();
  }, [circles]);

  const orderedCircles = useMemo(
    () => orderCircleShortcuts(circles, draftOrderIds),
    [circles, draftOrderIds],
  );

  const normalizedDraftOrderIds = useMemo(
    () => normalizeCircleShortcutOrder(circles, draftOrderIds),
    [circles, draftOrderIds],
  );

  const finishDrag = useCallback(() => {
    dragMetaRef.current = null;
    dragY.stopAnimation();
    dragY.setValue(0);
    setDraggingCircleId(null);
  }, [dragY]);

  const getDragResponder = useCallback(
    (circleId: string) => {
      const cached = dragRespondersRef.current.get(circleId);
      if (cached) return cached;

      const responder = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          const currentOrderIds = normalizeCircleShortcutOrder(
            circles,
            draftOrderIdsRef.current,
          );
          const startIndex = currentOrderIds.indexOf(circleId);
          if (startIndex < 0) return;

          dragMetaRef.current = {
            circleId,
            startIndex,
            activeIndex: startIndex,
          };
          setDraggingCircleId(circleId);
          setDraftOrderIds(currentOrderIds);
          dragY.setValue(0);
        },
        onPanResponderMove: (_evt, gestureState) => {
          const meta = dragMetaRef.current;
          if (!meta) return;

          const currentOrderIds = normalizeCircleShortcutOrder(
            circles,
            draftOrderIdsRef.current,
          );
          const nextIndex = Math.max(
            0,
            Math.min(
              currentOrderIds.length - 1,
              Math.round(
                (meta.startIndex * ORDER_ROW_HEIGHT + gestureState.dy) /
                  ORDER_ROW_HEIGHT,
              ),
            ),
          );

          dragY.setValue(
            gestureState.dy -
              (meta.activeIndex - meta.startIndex) * ORDER_ROW_HEIGHT,
          );

          if (nextIndex === meta.activeIndex) return;

          const nextOrderIds = reorderCircleShortcut(
            currentOrderIds,
            circleId,
            nextIndex,
          );
          meta.activeIndex = nextIndex;
          draftOrderIdsRef.current = nextOrderIds;
          setDraftOrderIds(nextOrderIds);
          dragY.setValue(
            gestureState.dy -
              (meta.activeIndex - meta.startIndex) * ORDER_ROW_HEIGHT,
          );
        },
        onPanResponderRelease: finishDrag,
        onPanResponderTerminate: finishDrag,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      });

      dragRespondersRef.current.set(circleId, responder);
      return responder;
    },
    [circles, finishDrag],
  );
  const handleSave = useCallback(() => {
    onSave(normalizedDraftOrderIds);
    onClose();
  }, [normalizedDraftOrderIds, onClose, onSave]);

  const handleReset = useCallback(() => {
    setDraftOrderIds([]);
    onReset();
    onClose();
  }, [onClose, onReset]);

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      backdropStyle={{ backgroundColor: colors.overlay }}
      sheetStyle={[
        s.sheet,
        {
          backgroundColor: colors.surface,
          paddingBottom: insets.bottom || Spacing.lg,
        },
      ]}
    >
      <View style={[s.handle, { backgroundColor: colors.surfaceBorder }]} />
      <View style={s.header}>
        <Text style={[s.title, { color: colors.text }]} numberOfLines={1}>
          {t('discover.shortcutOrder.title', {
            defaultValue: '调整圈子顺序',
          })}
        </Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>
      <Text style={[s.hint, { color: colors.textSecondary }]}>
        {t('discover.shortcutOrder.hint', {
          defaultValue: '上方横向列表会按这个顺序展示',
        })}
      </Text>

      <ScrollView
        style={s.list}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!draggingCircleId}
      >
        {orderedCircles.map((circle, index) => {
          const isDragging = draggingCircleId === circle.id;
          const rowAnimatedStyle = isDragging
            ? {
                transform: [{ translateY: dragY }],
                zIndex: 1,
              }
            : null;
          return (
            <Animated.View
              key={circle.id}
              style={[
                s.row,
                isDragging ? s.draggingRow : null,
                {
                  backgroundColor: colors.surface,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.divider,
                },
                rowAnimatedStyle,
              ]}
            >
              <CircleAvatar uri={circle.avatarUrl} size={34} />
              <Text
                style={[s.rowText, { color: colors.text }]}
                numberOfLines={1}
              >
                {circle.name}
              </Text>
              <View
                style={[
                  s.dragHandle,
                  { backgroundColor: colors.background },
                ]}
                {...getDragResponder(circle.id).panHandlers}
              >
                <Ionicons
                  name="reorder-three-outline"
                  size={22}
                  color={colors.textSecondary}
                />
              </View>
            </Animated.View>
          );
        })}
      </ScrollView>

      <View style={s.footer}>
        <Pressable
          style={[
            s.footerButton,
            { backgroundColor: colors.background },
          ]}
          onPress={handleReset}
        >
          <Text style={[s.footerText, { color: colors.text }]}>
            {t('discover.shortcutOrder.reset', {
              defaultValue: '恢复默认',
            })}
          </Text>
        </Pressable>
        <Pressable
          style={[
            s.footerButton,
            { backgroundColor: colors.primary },
          ]}
          onPress={handleSave}
        >
          <Text style={[s.footerText, { color: colors.white }]}>
            {t('common.save')}
          </Text>
        </Pressable>
      </View>
    </BottomSheetModal>
  );
}
