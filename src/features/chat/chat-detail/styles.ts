import { StyleSheet } from 'react-native';
import { AVATAR_SIZE } from '@/features/chat/components/bubbles/shared';
import { Radius, Spacing, Typography } from '@/theme';

/** 聊天详情页的静态样式(随主题变化的那部分在 useChatDetailThemedStyles)。 */
export const chatDetailStyles = StyleSheet.create({
  // 群聊接收气泡上方的发送者名字（缩进对齐气泡起点 = 头像宽 + 间距）。
  // marginBottom 给名字与气泡之间留一点呼吸空间，避免名字贴着气泡显得拥挤。
  senderLabel: {
    ...Typography.small,
    marginLeft: AVATAR_SIZE + Spacing.sm,
    marginBottom: Spacing.xs + 2,
  },
  // 「隐藏聊天头像」把整列去掉，气泡贴边；名字要跟着回到 0，否则名字缩进、
  // 它自己的气泡贴边，两者对不上。合并头像不走这条 —— 那时占位还在。
  senderLabelWithoutAvatarColumn: { marginLeft: 0 },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    gap: 12,
  },
  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerMeta: { flex: 1, gap: 2 },
  headerName: { fontSize: 16, fontWeight: '600' },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  headerStatusText: { ...Typography.small },
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
  disappearingMessageNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  disappearingMessageNoticeText: {
    ...Typography.small,
    flex: 1,
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
  mentionPicker: {
    maxHeight: 220,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  mentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  mentionName: {
    ...Typography.bodyRegular,
    flex: 1,
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
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  circleBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  composerActionBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  composerShell: {
    flex: 1,
    height: 52,
    borderWidth: 1,
    borderRadius: Radius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: Spacing.xs,
  },
  composerInput: { flex: 1, ...Typography.bodyRegular, fontSize: 16, padding: 0 },
  voiceHoldBar: {
    flex: 1,
    height: 52,
    borderRadius: Radius.xl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceHoldText: { ...Typography.body, fontSize: 16, fontWeight: '600' },
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
