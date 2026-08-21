import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useCallback, useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import type { NoteSummary } from '@/features/notes/types';
import { buildNoteMeta } from '@/features/notes/utils/note-format';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { logClientDiagnostic } from '@/utils/client-diagnostics';

/** 来源 chip 的点击目标：发送者 → 私聊，来源群 → 群聊 */
export type NoteSourceTarget = 'sender' | 'group';

interface Props {
  note: NoteSummary;
  /** 回调统一携带 note，父层可用稳定的 useCallback，让 memo 生效 */
  onPress: (note: NoteSummary) => void;
  /** 点「⋯」打开动作菜单（置顶/多选/备注/编辑/分组/分享/删除/下架）——由父层承载菜单 */
  onMorePress?: (note: NoteSummary) => void;
  /** 长按进入多选（父层切 selectionMode） */
  onLongPress?: (note: NoteSummary) => void;
  /** 点来源 chip（发送者/群）→ 父层负责跳转进对应聊天 */
  onSourcePress?: (note: NoteSummary, target: NoteSourceTarget) => void;
  /** 多选模式：右侧 ⋯ 槽位换成选择圈，整卡点击由父层当作勾选处理 */
  selectionMode?: boolean;
  selected?: boolean;
  /** 定位跳转后的短暂高亮（「查看」从聊天跳进列表时用） */
  highlighted?: boolean;
  showActions?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: 'button';
}

function NoteCardInner({
  note,
  onPress,
  onMorePress,
  onLongPress,
  onSourcePress,
  selectionMode = false,
  selected = false,
  highlighted = false,
  showActions = true,
  accessibilityLabel,
  accessibilityRole = 'button',
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      title: { color: colors.text },
      preview: { color: colors.textSecondary },
      meta: { color: colors.textSecondary },
      placeholder: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      sourceChip: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
    }),
    [colors],
  );

  const meta = buildNoteMeta(
    {
      updatedAt: note.updatedAt,
      groupNames: note.groups.map((group) => group.name),
      imageCount: note.imageCount,
      videoCount: note.videoCount,
    },
    t,
  );

  // 收藏来的笔记在列表上亮出来源：发送者 chip（→私聊）+ 群 chip（→群聊）。
  // 快照缺关键字段（历史坏数据）时对应 chip 不渲染，避免点了跳不动。
  const sender = note.collectedFrom?.sender;
  const senderChip = sender?.id && sender.name ? sender : null;
  const group =
    note.collectedFrom?.conversationType === 'group'
      ? note.collectedFrom.group
      : null;
  const groupChip = group?.id && group.name ? group : null;

  const handlePress = useCallback(() => onPress(note), [note, onPress]);

  const handleLongPress = useCallback(
    () => onLongPress?.(note),
    [note, onLongPress],
  );

  const handleMore = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onMorePress?.(note);
    },
    [note, onMorePress],
  );

  const handleSenderPress = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSourcePress?.(note, 'sender');
    },
    [note, onSourcePress],
  );

  const handleGroupPress = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSourcePress?.(note, 'group');
    },
    [note, onSourcePress],
  );

  // 多选模式下 chip 不再跳聊天，避免和「点卡片=勾选」抢手势。
  const chipsEnabled = Boolean(onSourcePress) && !selectionMode;
  const canShowActions = showActions && Boolean(onMorePress) && !selectionMode;

  return (
    <Pressable
      style={[
        s.container,
        highlighted ? { backgroundColor: colors.primaryLight } : null,
      ]}
      onPress={handlePress}
      onLongPress={onLongPress ? handleLongPress : undefined}
      // Web:卡片内部还有 chip/更多等真按钮,外层再当 <button> 就是
      // button 套 button(非法 HTML,React DOM 告警+点击路由混乱)。
      // 桌面网页版外层降级为可点 div;原生保持按钮语义不变。
      accessibilityRole={Platform.OS === 'web' ? undefined : accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selectionMode ? { selected } : undefined}
    >
      <View style={s.topRow}>
      {note.cover ? (
        <Image
          source={{ uri: note.cover.url }}
          recyclingKey={note.cover.url}
          style={s.thumbnail}
          contentFit="cover"
          // 封面走 presign-on-read，签名过期会 403 变空白。列表本身有 focus/下拉刷新会
          // 自愈，这里只记一条诊断，用来观察 TTL 是否偏短。
          onError={() =>
            logClientDiagnostic('note_cover_load_failed', { noteId: note.id })
          }
        />
      ) : (
        <View style={[s.thumbnail, s.thumbnailFallback, d.placeholder]}>
          <Ionicons
            name="document-text-outline"
            size={22}
            color={colors.textSecondary}
          />
        </View>
      )}

      <View style={s.content}>
        <View style={s.titleRow}>
          {note.pinned ? (
            <Ionicons name="bookmark" size={13} color={colors.primary} />
          ) : null}
          <Text style={[s.title, d.title]} numberOfLines={1}>
            {note.title}
          </Text>
        </View>
        {note.remark ? (
          <Text
            style={[s.remark, { color: colors.primary }]}
            numberOfLines={1}
          >
            {t('notes.list.remark', {
              defaultValue: '备注：{{text}}',
              text: note.remark,
            })}
          </Text>
        ) : null}
        {note.contentPreview ? (
          <Text style={[s.preview, d.preview]} numberOfLines={2}>
            {note.contentPreview}
          </Text>
        ) : null}
        <Text style={[s.meta, d.meta]} numberOfLines={1}>
          {meta}
        </Text>
      </View>

      {selectionMode ? (
        <View style={s.moreBtn}>
          <Ionicons
            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={selected ? colors.primary : colors.textSecondary}
          />
        </View>
      ) : canShowActions ? (
        <Pressable
          onPress={handleMore}
          hitSlop={10}
          style={s.moreBtn}
          accessibilityRole="button"
          accessibilityLabel={t('notes.actions.more', { defaultValue: '更多' })}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
        </Pressable>
      ) : null}
      </View>

      {/* 来源双按钮通栏铺在卡片底部：左=分享人(→私聊)，右=来源群(→群聊定位原消息)。 */}
      {senderChip || groupChip ? (
        <View style={s.sourceRow}>
          {senderChip ? (
            <Pressable
              style={[s.sourceChip, d.sourceChip]}
              onPress={chipsEnabled ? handleSenderPress : undefined}
              disabled={!chipsEnabled}
              accessibilityRole="button"
              accessibilityLabel={t('notes.list.openSenderChat', {
                defaultValue: '和 {{name}} 私聊',
                name: senderChip.name,
              })}
            >
              <Avatar
                size={20}
                uri={senderChip.faceURL ?? undefined}
                name={senderChip.name}
              />
              <Text
                style={[s.sourceText, { color: colors.text }]}
                numberOfLines={1}
              >
                {senderChip.name}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={13}
                color={colors.textSecondary}
              />
            </Pressable>
          ) : null}
          {groupChip ? (
            <Pressable
              style={[s.sourceChip, d.sourceChip]}
              onPress={chipsEnabled ? handleGroupPress : undefined}
              disabled={!chipsEnabled}
              accessibilityRole="button"
              accessibilityLabel={t('notes.list.openGroupChat', {
                defaultValue: '进入群聊 {{name}}',
                name: groupChip.name,
              })}
            >
              {/* 群用群头像组件：无头像时回落成品牌渐变群组图，而不是
                  通用 Avatar 的灰色人形（那是「人」的语义）。 */}
              <GroupChatAvatar
                size={20}
                uri={groupChip.faceURL ?? null}
                name={groupChip.name}
              />
              <Text
                style={[s.sourceText, { color: colors.text }]}
                numberOfLines={1}
              >
                {groupChip.name}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={13}
                color={colors.textSecondary}
              />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

// 列表页搜索/刷新时高频重渲，note 数据没变的卡片直接跳过。
export const NoteCard = memo(NoteCardInner);

const s = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: Radius.md,
    flexShrink: 0,
  },
  thumbnailFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  title: {
    flexShrink: 1,
    ...Typography.body,
    fontWeight: '600',
  },
  preview: {
    ...Typography.caption,
    fontWeight: '400',
    lineHeight: 18,
  },
  remark: {
    ...Typography.small,
    fontWeight: '500',
  },
  meta: {
    ...Typography.small,
  },
  // 来源双按钮：通栏等分，名字占满剩余宽度，尾部 chevron 提示可点。
  sourceRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  sourceChip: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 4,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.sm + 4,
    height: 36,
  },
  sourceText: {
    flex: 1,
    ...Typography.small,
    fontWeight: '500',
  },
  moreBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -2,
  },
});
