import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, type GestureResponderHandlers } from 'react-native';

interface DragReorderOptions {
  ids: readonly string[];
  /** 每行占的高度（行高 + 行间距），拖动时按它换算落点。 */
  rowStride: number;
  /** 松手且顺序真的变了才回调；新顺序已经应用在预览里。 */
  onCommit: (nextIds: string[]) => void;
  /** 上一次保存还没回来时不让开始新的拖动。 */
  disabled?: boolean;
}

interface DragMeta {
  id: string;
  startIndex: number;
  activeIndex: number;
}

/**
 * 按住拖柄上下拖动排序（定高行）。拖动中只改预览顺序，松手一次性 onCommit。
 * 手势回调都读 ref，拖柄的 responder 按 id 缓存，重渲染不会打断正在进行的手势。
 */
export function useDragReorder({ ids, rowStride, onCommit, disabled = false }: DragReorderOptions) {
  const [previewIds, setPreviewIds] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const idsRef = useRef(ids);
  const previewRef = useRef<string[] | null>(null);
  const metaRef = useRef<DragMeta | null>(null);
  const onCommitRef = useRef(onCommit);
  const disabledRef = useRef(disabled);
  const respondersRef = useRef(new Map<string, ReturnType<typeof PanResponder.create>>());

  idsRef.current = ids;
  onCommitRef.current = onCommit;
  disabledRef.current = disabled;

  useEffect(() => {
    for (const id of respondersRef.current.keys()) {
      if (!ids.includes(id)) respondersRef.current.delete(id);
    }
  }, [ids]);

  const finishDrag = useCallback(() => {
    const meta = metaRef.current;
    const finalIds = previewRef.current;
    const startIds = idsRef.current;
    metaRef.current = null;
    previewRef.current = null;
    dragY.stopAnimation();
    dragY.setValue(0);
    setPreviewIds(null);
    setDraggingId(null);
    if (!meta || !finalIds) return;
    if (finalIds.some((id, index) => id !== startIds[index])) {
      onCommitRef.current(finalIds);
    }
  }, [dragY]);

  const getHandlers = useCallback(
    (id: string): GestureResponderHandlers => {
      const cached = respondersRef.current.get(id);
      if (cached) return cached.panHandlers;

      const canStart = () => !disabledRef.current;
      const responder = PanResponder.create({
        onStartShouldSetPanResponder: canStart,
        onMoveShouldSetPanResponder: canStart,
        onMoveShouldSetPanResponderCapture: canStart,
        onPanResponderGrant: () => {
          const current = [...idsRef.current];
          const startIndex = current.indexOf(id);
          if (startIndex < 0 || disabledRef.current) return;
          metaRef.current = { id, startIndex, activeIndex: startIndex };
          previewRef.current = current;
          setPreviewIds(current);
          setDraggingId(id);
          dragY.setValue(0);
        },
        onPanResponderMove: (_event, gesture) => {
          const meta = metaRef.current;
          const current = previewRef.current;
          if (!meta || !current) return;
          const nextIndex = Math.max(
            0,
            Math.min(
              current.length - 1,
              Math.round((meta.startIndex * rowStride + gesture.dy) / rowStride),
            ),
          );
          if (nextIndex !== meta.activeIndex) {
            const next = [...current];
            const [moved] = next.splice(meta.activeIndex, 1);
            next.splice(nextIndex, 0, moved);
            meta.activeIndex = nextIndex;
            previewRef.current = next;
            setPreviewIds(next);
          }
          // 行本身已经挪到新下标，只补手指和新位置之间的差。
          dragY.setValue(gesture.dy - (meta.activeIndex - meta.startIndex) * rowStride);
        },
        onPanResponderRelease: finishDrag,
        onPanResponderTerminate: finishDrag,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      });
      respondersRef.current.set(id, responder);
      return responder.panHandlers;
    },
    [dragY, finishDrag, rowStride],
  );

  return {
    orderedIds: previewIds ?? ids,
    draggingId,
    dragY,
    getHandlers,
  };
}
