import { StyleSheet } from 'react-native';
import { AVATAR_COLUMN_SIZE } from '@/features/chat/components/bubbles/shared';
import { Radius, Spacing, Typography } from '@/theme';

/** 聊天详情页的静态样式(随主题变化的那部分在 useChatDetailThemedStyles)。 */
export const chatDetailStyles = StyleSheet.create({
  // 群聊接收气泡上方的发送者名字（缩进对齐气泡起点 = 头像宽 + 间距）。
  // marginBottom 给名字与气泡之间留一点呼吸空间，避免名字贴着气泡显得拥挤。
  senderLabel: {
    ...Typography.small,
    marginLeft: AVATAR_COLUMN_SIZE + Spacing.sm,
    marginBottom: Spacing.xs + 2,
  },
  // 「隐藏聊天头像」把整列去掉，气泡贴边；名字要跟着回到 0，否则名字缩进、
  // 它自己的气泡贴边，两者对不上。合并头像不走这条 —— 那时占位还在。
  senderLabelWithoutAvatarColumn: { marginLeft: 0 },
  chatBody: { flex: 1 },
  // 顶栏和横幅悬浮在消息上(与底部 composerDock 对称),消息从它们后面滑过。
  topDock: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3 },
  composerDock: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 3 },
  messageArea: {
    flex: 1,
    overflow: 'hidden',
  },
  messageAreaBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  messageAreaOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  messageListSurface: {
    flex: 1,
  },
  messageList: { padding: Spacing.md, gap: 14 },
  messageListContent: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  messageListInset: {
    paddingHorizontal: 2,
  },
  unreadJumpButton: {
    position: 'absolute',
    bottom: Spacing.md,
    right: Spacing.md,
    minHeight: 40,
    maxWidth: '78%',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.xl,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 2,
  },
  unreadJumpText: {
    ...Typography.small,
    fontWeight: '600',
  },
  connectionBanner: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
  },
  // 悬浮在顶栏下的玻璃小胶囊,按文字收缩居中;过长时在两侧留白内换行。
  disappearingMessageNotice: {
    alignSelf: 'center',
    marginTop: Spacing.xs,
    marginHorizontal: Spacing.md,
  },
  disappearingMessageNoticePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderCurve: 'continuous',
  },
  disappearingMessageNoticeText: {
    ...Typography.small,
    flexShrink: 1,
  },
  targetMessageHighlight: {
    borderRadius: Radius.lg,
  },
  previewNotice: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
    textAlign: 'center',
  },
  sendError: { textAlign: 'center', paddingVertical: 4 },
  historyWindowFullNotice: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    textAlign: 'center',
  },
  quoteComposerBar: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  quoteComposerText: {
    flex: 1,
    ...Typography.small,
  },
  silencedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  silencedBarText: {
    ...Typography.small,
    flex: 1,
  },
  inputBar: {
    paddingTop: 10,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
  },
  circleBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  // 玻璃卡片：上面一行输入框 + 发送，下面一行快捷键。
  composerShell: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 28,
    paddingHorizontal: 8,
    paddingTop: 6,
    overflow: 'hidden',
  },
  composerSheen: { ...StyleSheet.absoluteFillObject, borderRadius: 27, borderTopWidth: 1 },
  composerInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // 多行时发送键沉底，右上角留给展开按钮；行高至少放得下两个按钮不重叠。
  composerInputRowMultiline: { alignItems: 'flex-end', minHeight: 84 },
  composerInput: {
    flex: 1,
    minWidth: 0,
    ...Typography.bodyRegular,
    fontSize: 18,
    padding: 0,
    paddingHorizontal: 10,
    includeFontPadding: false,
  },
  composerSendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  // 输入区与快捷键之间的刻线，上方留一点呼吸，左右比卡片内边距再收进一些。
  composerDivider: { marginTop: 6, marginHorizontal: 12 },
  composerDividerLine: { height: StyleSheet.hairlineWidth },
  composerToolbar: { flexDirection: 'row', alignItems: 'center' },
  composerToolbarBtn: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' },
  expandComposerButton: { position: 'absolute', top: 0, right: 4, width: 36, height: 36, borderRadius: 18 },
  expandedComposer: { flex: 1 },
  expandedComposerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
  },
  expandedComposerTitle: { flex: 1, ...Typography.h3 },
  expandedComposerInput: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: Spacing.lg,
    ...Typography.bodyRegular,
    fontSize: 18,
    padding: 0,
    textAlignVertical: 'top',
  },
  expandedComposerFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  voiceHoldBar: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceHoldText: { ...Typography.body, fontSize: 16, fontWeight: '600' },
  // 表情 / 「+」面板画在消息区和输入栏下面。面板是新挂上的,直接出现在最终位置,而上面的
  // 聊天区还在随布局动画往上收;画在上面的话输入栏会先被盖住、再从面板后面钻出来。
  composerPanelLayer: { zIndex: -1 },
  // 负 zIndex 要配这个:聊天页容器只有背景色、不构成层叠上下文时,Fabric 会把它的子视图拍平到
  // 外层,面板排序后落到容器背景下面,整块被盖住、看着是黑的。
  composerPanelStack: { isolation: 'isolate' },
  attachmentPanel: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
  },
  attachmentDragHandle: {
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  attachmentDragBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  attachmentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  attachmentItem: {
    width: '25%',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.xs,
  },
  attachmentIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentLabel: {
    ...Typography.small,
  },
  attachmentDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  attachmentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  voiceStatus: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
    textAlign: 'center',
  },
});
