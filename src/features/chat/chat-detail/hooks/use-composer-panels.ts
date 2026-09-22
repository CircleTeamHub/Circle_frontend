import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { Keyboard, LayoutAnimation, PanResponder } from 'react-native';
import { PANEL_LAYOUT_ANIM } from '@/features/chat/chat-detail/constants';

export interface ComposerPanelsParams {
  setMentionPickerVisible: Dispatch<SetStateAction<boolean>>;
}

/**
 * 输入栏下方的「+」工具面板与表情面板:展开/收起(带布局过渡)、互斥,拖动列表时一并收起。
 */
export function useComposerPanels({
  setMentionPickerVisible,
}: ComposerPanelsParams) {
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [attachmentPage, setAttachmentPage] = useState(0);
  const [attachmentPagerWidth, setAttachmentPagerWidth] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // 面板展开/收起前调一次，让这次布局变化（面板高度 + 消息区缩放）平滑过渡。
  const animatePanels = useCallback(() => {
    LayoutAnimation.configureNext(PANEL_LAYOUT_ANIM);
  }, []);

  const handleAttachmentToggle = useCallback(() => {
    Keyboard.dismiss();
    animatePanels();
    setEmojiOpen(false);
    setMentionPickerVisible(false);
    setAttachmentPage(0);
    setAttachmentOpen((prev) => !prev);
  }, [animatePanels, setMentionPickerVisible]);

  const handleEmojiToggle = useCallback(() => {
    Keyboard.dismiss();
    animatePanels();
    setAttachmentOpen(false);
    setMentionPickerVisible(false);
    setEmojiOpen((prev) => !prev);
  }, [animatePanels, setMentionPickerVisible]);

  // 在消息区下拉/滚动时收起底部面板与键盘（微信式：拖动列表即收回输入区叠层）。
  const closeInputPanels = useCallback(() => {
    animatePanels();
    setAttachmentOpen(false);
    setEmojiOpen(false);
    setMentionPickerVisible(false);
    Keyboard.dismiss();
  }, [animatePanels, setMentionPickerVisible]);

  // 附件面板下滑收回。面板里是一堆 Pressable 网格项，触摸落到子项上时子项会先抢
  // responder；必须用「捕获阶段」onMove...Capture 才能在明显向下滑时从子项手里截下手势。
  // 阈值要求纵向位移明显大于横向（*1.5），避免点击/斜滑误触发，普通点击（无位移）仍走子项。
  const attachmentPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_evt, gesture) =>
          gesture.dy > 10 && gesture.dy > Math.abs(gesture.dx) * 1.5,
        onPanResponderRelease: (_evt, gesture) => {
          if (gesture.dy > 40) {
            LayoutAnimation.configureNext(PANEL_LAYOUT_ANIM);
            setAttachmentOpen(false);
          }
        },
        onPanResponderTerminate: () => {},
      }),
    [],
  );

  return {
    attachmentOpen,
    setAttachmentOpen,
    attachmentPage,
    setAttachmentPage,
    attachmentPagerWidth,
    setAttachmentPagerWidth,
    emojiOpen,
    setEmojiOpen,
    handleAttachmentToggle,
    handleEmojiToggle,
    closeInputPanels,
    attachmentPanResponder,
  };
}
