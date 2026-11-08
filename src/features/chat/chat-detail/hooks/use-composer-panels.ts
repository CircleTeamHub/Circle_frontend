import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { Keyboard, LayoutAnimation, PanResponder } from 'react-native';
import { PANEL_LAYOUT_ANIM } from '@/features/chat/chat-detail/constants';

export interface ComposerPanelsParams {
  mentionPickerVisible: boolean;
  setMentionPickerVisible: Dispatch<SetStateAction<boolean>>;
  /** 半屏聊天:外层半屏容器负责避让键盘,面板开着时要撤掉它的键盘留白。 */
  onPanelOpenChange?: (open: boolean) => void;
}

/**
 * 输入栏下方的「+」工具面板与表情面板:展开/收起(带布局过渡)、互斥,拖动列表时一并收起。
 */
export function useComposerPanels({
  mentionPickerVisible,
  setMentionPickerVisible,
  onPanelOpenChange,
}: ComposerPanelsParams) {
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [attachmentPage, setAttachmentPage] = useState(0);
  const [attachmentPagerWidth, setAttachmentPagerWidth] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // 面板展开/收起前调一次，让这次布局变化（面板高度 + 消息区缩放）平滑过渡。
  const animatePanels = useCallback(() => {
    LayoutAnimation.configureNext(PANEL_LAYOUT_ANIM);
  }, []);

  // 这里不收键盘:键盘收起在原生侧立刻开始,面板却要等这次渲染提交。先收的话键盘滑走后
  // 输入栏下面空一截,面板几帧后才补上(点表情 / 「+」时闪的那一下)。收键盘放到下面的
  // layout effect 里,面板提交之后再做。
  // 半屏外层的留白要和面板落在同一次渲染里,所以打开时在点击里同步通知(同一事件里的
  // setState 会合并成一次提交);关闭的路径多,统一由下面的 effect 补发。
  const handleAttachmentToggle = useCallback(() => {
    animatePanels();
    setEmojiOpen(false);
    setMentionPickerVisible(false);
    setAttachmentPage(0);
    setAttachmentOpen(!attachmentOpen);
    onPanelOpenChange?.(!attachmentOpen);
  }, [animatePanels, attachmentOpen, onPanelOpenChange, setMentionPickerVisible]);

  const handleEmojiToggle = useCallback(() => {
    animatePanels();
    setAttachmentOpen(false);
    setMentionPickerVisible(false);
    setEmojiOpen(!emojiOpen);
    onPanelOpenChange?.(!emojiOpen);
  }, [animatePanels, emojiOpen, onPanelOpenChange, setMentionPickerVisible]);

  const panelOpen = attachmentOpen || emojiOpen;
  useLayoutEffect(() => {
    if (panelOpen) Keyboard.dismiss();
  }, [panelOpen]);
  useLayoutEffect(() => {
    onPanelOpenChange?.(panelOpen);
  }, [onPanelOpenChange, panelOpen]);

  // 在消息区下拉/滚动时收起底部面板与键盘（微信式：拖动列表即收回输入区叠层）。
  const closeInputPanels = useCallback((dismissKeyboard = true) => {
    if (attachmentOpen || emojiOpen || mentionPickerVisible) animatePanels();
    setAttachmentOpen(false);
    setEmojiOpen(false);
    setMentionPickerVisible(false);
    if (dismissKeyboard) Keyboard.dismiss();
  }, [animatePanels, attachmentOpen, emojiOpen, mentionPickerVisible, setMentionPickerVisible]);

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
