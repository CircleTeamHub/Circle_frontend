import { Avatar } from "@/components/ui/avatar";
import { MemberName } from "@/components/ui/member-name";
import { Badge } from "@/components/ui/badge";
import { Divider } from "@/components/ui/divider";
import { FilterTabs } from "@/components/ui/filter-tabs";
import {
  clearChatConversationHistory,
  loadChatConversations,
  updateChatConversationPreferences,
} from "@/chat-core/api";
import { mapChatConversationToUI } from "@/chat-core/mappers";
import { markConversationRead } from "@/chat-core/socket-manager";
import { selectTotalUnread, type StoredChatMessage, useChatStore } from "@/chat-core/store";
import { hasFailedLatestMessage } from "@/features/messages/utils/failed-preview";
import { useMessageGroupsStore } from "@/features/messages/store/use-message-groups-store";
import { useLocalUnreadStore } from "@/features/messages/store/use-local-unread-store";
import {
  applyLocalUnreadOverrides,
  countLocalUnreadOverrides,
  type ConversationWithLocalUnread,
} from "@/features/messages/utils/local-unread";
import { getUserProfileHref } from "@/features/user/utils/routes";
import { getApiErrorMessage } from "@/services/api/errors";
import { useTabBadgeStore } from "@/stores/tabBadgeStore";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import type { Conversation } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Animated,
  FlatList,
  ListRenderItemInfo,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const isDev = typeof __DEV__ !== "undefined" && __DEV__;
const SWIPE_ACTION_WIDTH = 76;
const SWIPE_ACTIONS_WIDTH = SWIPE_ACTION_WIDTH * 3;
const SWIPE_OPEN_THRESHOLD = SWIPE_ACTION_WIDTH;

const BASE_FILTER_KEYS = [
  { id: "all", key: "messages.all" },
  { id: "unread", key: "messages.unread" },
  { id: "group", key: "messages.group" },
  { id: "private", key: "messages.private" },
] as const;

type MenuActionId =
  | "newGroup"
  | "addFriend"
  | "scan"
  | "seatManagement";

const MENU_ACTION_KEYS: {
  id: MenuActionId;
  icon: keyof typeof Ionicons.glyphMap;
  key: string;
}[] = [
  { id: "newGroup", icon: "people-outline", key: "messages.newGroup" },
  { id: "addFriend", icon: "person-add-outline", key: "messages.addFriend" },
  { id: "scan", icon: "scan-outline", key: "messages.scan" },
  { id: "seatManagement", icon: "call-outline", key: "messages.seatManagement" },
];

type PinnedGroupPosition = "single" | "first" | "middle" | "last" | "none";

function getPinnedGroupPosition(
  items: ConversationWithLocalUnread[],
  index: number,
): PinnedGroupPosition {
  const current = items[index];
  if (!current?.pinned) return "none";

  const previousPinned = Boolean(items[index - 1]?.pinned);
  const nextPinned = Boolean(items[index + 1]?.pinned);
  if (!previousPinned && !nextPinned) return "single";
  if (!previousPinned) return "first";
  if (!nextPinned) return "last";
  return "middle";
}

// 静态样式（不依赖主题色，提取到组件外避免每次渲染重建）
const s = StyleSheet.create({
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 100,
  },
  // 列表顶部 header 区域（标题行 + 筛选 Tab）
  headerSection: {
    gap: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  imBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  imBannerText: {
    ...Typography.small,
    fontWeight: "600",
  },
  // 标题行：左侧"消息"文字 + 右侧操作按钮组
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  // 右侧操作按钮组（已读、搜索、+）
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  actionButton: {
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  // 单条会话行外层：保留普通列表分隔线和行间距
  row: {
    marginHorizontal: -Spacing.sm,
    paddingVertical: Spacing.xs,
    overflow: "hidden",
  },
  pinnedRowFirst: {
    paddingTop: Spacing.xs,
    paddingBottom: 1,
  },
  pinnedRowMiddle: {
    paddingTop: 1,
    paddingBottom: 1,
  },
  pinnedRowLast: {
    paddingTop: 1,
    paddingBottom: Spacing.xs,
  },
  pinnedRowSingle: {
    paddingVertical: Spacing.xs,
  },
  swipeForeground: {
    zIndex: 1,
  },
  swipeActions: {
    position: "absolute",
    top: Spacing.xs,
    right: 0,
    bottom: Spacing.xs,
    width: SWIPE_ACTIONS_WIDTH,
    flexDirection: "row",
    justifyContent: "flex-end",
    borderRadius: Radius.lg,
    overflow: "hidden",
  },
  swipeAction: {
    width: SWIPE_ACTION_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  swipeActionLabel: {
    ...Typography.small,
    fontWeight: "600",
  },
  // 单条会话内容：头像 + 内容区
  rowSurface: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
  avatarWrap: {
    position: "relative",
  },
  tempAvatarBadge: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  // 置顶会话内层背景：连续置顶时按组收紧间距和圆角
  pinnedSurface: {
    marginHorizontal: Spacing.xs,
    borderRadius: Radius.lg,
    // backgroundColor 由主题动态注入
  },
  pinnedSurfaceFirst: {
    borderBottomLeftRadius: Radius.sm,
    borderBottomRightRadius: Radius.sm,
  },
  pinnedSurfaceMiddle: {
    borderRadius: Radius.sm,
  },
  pinnedSurfaceLast: {
    borderTopLeftRadius: Radius.sm,
    borderTopRightRadius: Radius.sm,
  },
  pinnedSurfaceSingle: {
    borderRadius: Radius.lg,
  },
  // 名称组合
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
    marginRight: Spacing.sm,
  },
  rowContent: {
    flex: 1,
    gap: Spacing.xs,
  },
  // 会话行上半：名称（左）+ 时间（右）
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowMeta: {
    alignItems: "flex-end",
    gap: 3,
    position: "relative",
  },
  mutedIndicator: {
    position: "absolute",
    top: 20,
    right: 0,
    minWidth: 18,
    minHeight: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  // 会话行下半：消息预览（左）+ 未读数角标（右）
  rowBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  // 弹出菜单的半透明蒙层（点击关闭菜单）
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  // 弹出菜单容器（定位在右上角 + 按钮下方）
  menu: {
    position: "absolute",
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    minWidth: 160,
    borderWidth: 1,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
});

type ConversationRowLabels = {
  markUnread: string;
  hide: string;
  delete: string;
};

type ConversationRowProps = {
  item: ConversationWithLocalUnread;
  pinnedGroupPosition: PinnedGroupPosition;
  labels: ConversationRowLabels;
  rowBackgroundColor: string;
  nameStyle: object;
  timeStyle: object;
  previewStyle: object;
  pinnedSurfaceStyle: object;
  onOpenConversation: (conversation: Conversation) => void;
  onOpenUserProfile: (conversation: Conversation) => void;
  onMarkUnread: (conversation: Conversation) => void;
  onHide: (conversation: Conversation) => void;
  onDelete: (conversation: Conversation) => void;
};

function ConversationRowImpl({
  item,
  pinnedGroupPosition,
  labels,
  rowBackgroundColor,
  nameStyle,
  timeStyle,
  previewStyle,
  pinnedSurfaceStyle,
  onOpenConversation,
  onOpenUserProfile,
  onMarkUnread,
  onHide,
  onDelete,
}: ConversationRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const translateX = useRef(new Animated.Value(0)).current;
  const currentXRef = useRef(0);

  const getPinnedRowStyle = (position: PinnedGroupPosition) => {
    switch (position) {
      case "single":
        return s.pinnedRowSingle;
      case "first":
        return s.pinnedRowFirst;
      case "middle":
        return s.pinnedRowMiddle;
      case "last":
        return s.pinnedRowLast;
      default:
        return null;
    }
  };

  const getPinnedSurfaceStyle = (position: PinnedGroupPosition) => {
    switch (position) {
      case "single":
        return s.pinnedSurfaceSingle;
      case "first":
        return s.pinnedSurfaceFirst;
      case "middle":
        return s.pinnedSurfaceMiddle;
      case "last":
        return s.pinnedSurfaceLast;
      default:
        return null;
    }
  };

  const animateTo = useCallback(
    (toValue: number) => {
      currentXRef.current = toValue;
      Animated.spring(translateX, {
        toValue,
        useNativeDriver: true,
        bounciness: 0,
        speed: 22,
      }).start();
    },
    [translateX],
  );

  const closeSwipe = useCallback(() => animateTo(0), [animateTo]);
  const openSwipe = useCallback(
    () => animateTo(-SWIPE_ACTIONS_WIDTH),
    [animateTo],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
        onPanResponderMove: (_, gesture) => {
          const nextX = Math.max(
            -SWIPE_ACTIONS_WIDTH,
            Math.min(0, currentXRef.current + gesture.dx),
          );
          translateX.setValue(nextX);
        },
        onPanResponderRelease: (_, gesture) => {
          const nextX = currentXRef.current + gesture.dx;
          if (nextX < -SWIPE_OPEN_THRESHOLD || gesture.vx < -0.5) {
            openSwipe();
          } else {
            closeSwipe();
          }
        },
        onPanResponderTerminate: closeSwipe,
      }),
    [closeSwipe, openSwipe, translateX],
  );

  const handleSwipeAction = useCallback(
    (action: (conversation: Conversation) => void) => {
      closeSwipe();
      action(item);
    },
    [closeSwipe, item],
  );

  const renderSwipeActions = () => (
    <View style={s.swipeActions}>
      <Pressable
        style={[s.swipeAction, { backgroundColor: colors.primary }]}
        onPress={() => handleSwipeAction(onMarkUnread)}
      >
        <Ionicons name="ellipse-outline" size={20} color={colors.white} />
        <Text style={[s.swipeActionLabel, { color: colors.white }]}>
          {labels.markUnread}
        </Text>
      </Pressable>
      <Pressable
        style={[s.swipeAction, { backgroundColor: colors.warning }]}
        onPress={() => handleSwipeAction(onHide)}
      >
        <Ionicons name="archive-outline" size={20} color={colors.white} />
        <Text style={[s.swipeActionLabel, { color: colors.white }]}>
          {labels.hide}
        </Text>
      </Pressable>
      <Pressable
        style={[s.swipeAction, { backgroundColor: colors.error }]}
        onPress={() => handleSwipeAction(onDelete)}
      >
        <Ionicons name="trash-outline" size={20} color={colors.white} />
        <Text style={[s.swipeActionLabel, { color: colors.white }]}>
          {labels.delete}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <View style={[s.row, getPinnedRowStyle(pinnedGroupPosition)]}>
      {renderSwipeActions()}
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          s.swipeForeground,
          { backgroundColor: rowBackgroundColor, transform: [{ translateX }] },
        ]}
      >
        <View
          style={[
            s.rowSurface,
            item.pinned
              ? [
                  s.pinnedSurface,
                  getPinnedSurfaceStyle(pinnedGroupPosition),
                  pinnedSurfaceStyle,
                ]
              : null,
          ]}
        >
          {item.conversationType === "private" ? (
            <Pressable onPress={() => onOpenUserProfile(item)}>
              <Avatar size={40} name={item.name} uri={item.avatarUrl} />
            </Pressable>
          ) : (
            <View style={s.avatarWrap}>
              <Avatar size={40} name={item.name} uri={item.avatarUrl} />
              {item.isTempChat ? (
                <View
                  style={[
                    s.tempAvatarBadge,
                    { backgroundColor: colors.primary, borderColor: rowBackgroundColor },
                  ]}
                >
                  <Ionicons name="time-outline" size={10} color={colors.white} />
                </View>
              ) : null}
            </View>
          )}
          <Pressable style={s.rowContent} onPress={() => onOpenConversation(item)}>
            <View style={s.rowTop}>
              <View style={s.nameRow}>
                <MemberName
                  name={item.name}
                  userId={
                    item.conversationType === 'private'
                      ? item.sourceID
                      : undefined
                  }
                  style={nameStyle}
                  numberOfLines={1}
                />
              </View>
              <View style={s.rowMeta}>
                <Text style={timeStyle}>{item.time}</Text>
                {item.muted ? (
                  <View style={s.mutedIndicator}>
                    <Ionicons
                      name="notifications-off-outline"
                      size={15}
                      color={colors.textSecondary}
                      accessibilityLabel={t("messages.mutedA11y", {
                        defaultValue: "消息免打扰",
                      })}
                    />
                  </View>
                ) : null}
              </View>
            </View>
            <View style={s.rowBottom}>
              <Text style={previewStyle} numberOfLines={1}>
                {item.message}
              </Text>
              <Badge count={item.unreadCount} />
            </View>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

// MessagesScreen：消息列表主页面
// 功能：
//   1. 展示所有会话，支持按标签筛选（全部/未读/群聊/私聊/自定义群组）
//   2. 头部操作栏：搜索、一键已读
//   3. 点击头像可进入用户主页（仅私聊），点击会话行进入聊天详情
// memo 化会话行：配合上游稳定的 item 引用，未变化的行跳过重渲染。
const ConversationRow = memo(ConversationRowImpl);

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, resolvedMode } = useTheme();
  const { t } = useTranslation();

  // useMemo 让 BASE_FILTERS / MENU_ACTIONS 在 `t` 不变时保持同一引用 ——
  // 否则它们每次 render 都是新数组，会让下游 useMemo (activeTab / ListHeader) 形同虚设。
  const BASE_FILTERS = useMemo(
    () => BASE_FILTER_KEYS.map((f) => ({ id: f.id, label: t(f.key) })),
    [t],
  );
  const MENU_ACTIONS = useMemo(
    () => MENU_ACTION_KEYS.map((a) => ({ id: a.id, icon: a.icon, label: t(a.key) })),
    [t],
  );
  const swipeLabels = useMemo(
    () => ({
      markUnread: t("messages.swipeMarkUnread", { defaultValue: "标记未读" }),
      hide: t("messages.swipeHide"),
      delete: t("messages.swipeDelete"),
    }),
    [t],
  );

  const rawConversations = useChatStore((state) => state.conversations);
  const connectionError = useChatStore((state) => state.error);
  const imConnected = useChatStore((state) => state.connected);
  const imConnecting = useChatStore((state) => state.connecting);
  const conversationGroups = useMessageGroupsStore((state) => state.groups);
  const localUnreadOverrides = useLocalUnreadStore((state) => state.overrides);
  const markLocalUnread = useLocalUnreadStore((state) => state.markUnread);
  const clearLocalUnread = useLocalUnreadStore((state) => state.clearUnread);
  const clearManyLocalUnread = useLocalUnreadStore((state) => state.clearMany);
  const [activeFilterId, setActiveFilterId] = useState("all"); // 当前激活的筛选标签 id
  const [menuVisible, setMenuVisible] = useState(false);        // 右上角弹出菜单的显隐
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // 每次回到消息页都重新拉 OpenIM 会话列表。
  // 群聊可能从群列表、圈子、临时群等入口创建/恢复；只在首次 mount 拉取会漏掉这些更新。
  // 注意：这里不再重置筛选标签。点会话进聊天详情会 push 新页、让本页失焦；返回时
  // 本页重新聚焦会再次触发本 effect——若在此重置 activeFilterId，用户从"私聊/群聊/未读"
  // 点进去再返回就会被强行拽回"全部"，丢失上一级筛选（见 messages-screen.test.js 回归）。
  useFocusEffect(
    useCallback(() => {
      loadChatConversations().catch((err) => {
        // 列表加载失败时保留已有会话,empty state 兜底显示。
        // dev 下额外打印，便于排查"为啥列表是空的"。
        if (isDev) {
          console.warn("[messages] focus loadConversationList failed", err);
        }
      });
    }, []),
  );

  const handleRefreshConversations = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await loadChatConversations();
    } catch (err) {
      if (isDev) {
        console.warn("[messages] pull refresh loadConversationList failed", err);
      }
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  const totalUnread = useChatStore(selectTotalUnread);
  const setMessagesUnread = useTabBadgeStore((state) => state.setMessagesUnread);

  // 依赖主题色的动态样式，colors 变化时重新计算
  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      title: {
        color: colors.text,
        ...Typography.title,
      },
      imBanner: {
        backgroundColor: colors.warning,
      },
      imBannerText: {
        color: colors.white,
      },
      name: {
        color: colors.text,
        fontSize: 15,
        fontWeight: "600" as const,
        flex: 1,
        marginRight: Spacing.sm,
      },
      preview: {
        color: colors.textSecondary,
        ...Typography.caption,
        flex: 1,
        marginRight: Spacing.sm,
      },
      time: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      emptyText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        textAlign: "center" as const,
        paddingTop: Spacing.xl,
      },
      menuBg: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      menuLabel: {
        color: colors.text,
        ...Typography.body,
      },
      // 置顶内容面：用 surface 色做轻微背景区分
      pinnedSurface: {
        backgroundColor: resolvedMode === "light" ? colors.surfaceBorder : colors.surface,
      },
    }),
    [colors, resolvedMode],
  );

  // 筛选标签列表 = 固定标签 + 用户自定义群组（动态追加）
  // 按源 ConversationItem 引用缓存映射结果：未变化的会话保持同一 UI 对象引用。
  // 配合 applyLocalUnreadOverrides 对未覆盖项的引用透传 + memo 化的 ConversationRow，
  // 新消息到达时只有变化的那几行重渲染，而非整列表。
  const convMapCacheRef = useRef<
    WeakMap<object, ReturnType<typeof mapChatConversationToUI>>
  >(new WeakMap());
  const rawMappedConversations = useMemo(() => {
    const cache = convMapCacheRef.current;
    return rawConversations.map((raw) => {
      let mapped = cache.get(raw);
      if (!mapped) {
        mapped = mapChatConversationToUI(raw);
        cache.set(raw, mapped);
      }
      return mapped;
    });
  }, [rawConversations]);

  const baseConversations = useMemo(
    () => applyLocalUnreadOverrides(rawMappedConversations, localUnreadOverrides),
    [localUnreadOverrides, rawMappedConversations],
  );

  // 最新一条发送失败的会话 id 集合,拼成排序串让引用比较退化成值比较:
  // 只在失败集合真变了才触发下游 useMemo,消息洪泛不抖动列表。
  const failedConversationKey = useChatStore((state) => {
    const ids: string[] = [];
    for (const [id, messages] of Object.entries(state.messagesByConversation)) {
      if (hasFailedLatestMessage(messages as StoredChatMessage[])) ids.push(id);
    }
    return ids.sort().join('\n');
  });

  // 会话预览的失败标记:最新那条没发出去时前缀提示,不然列表页只看得到文案,
  // 用户不知道刚发的那条其实没出去。判据见 hasFailedLatestMessage ——
  // 「会话里存在失败消息」是不行的,前缀会贴到一条明明发成功的消息上。
  const conversations = useMemo(() => {
    if (!failedConversationKey) return baseConversations;
    const failedIds = new Set(failedConversationKey.split('\n'));
    const prefix = t('im.preview.sendFailedPrefix', {
      defaultValue: '[发送失败]',
    });
    return baseConversations.map((conversation) =>
      failedIds.has(conversation.id)
        ? { ...conversation, message: `${prefix} ${conversation.message}` }
        : conversation,
    );
  }, [baseConversations, failedConversationKey, t]);

  useEffect(() => {
    setMessagesUnread(
      totalUnread + countLocalUnreadOverrides(rawMappedConversations, localUnreadOverrides),
    );
  }, [localUnreadOverrides, rawMappedConversations, setMessagesUnread, totalUnread]);

  // Filter 列表 = 基础 4 项 + 用户设置了 pinnedToTabs 的自定义分组。
  // 自定义分组的 id 形如 "custom:<uuid>"，避免和 base id 冲突；filter 逻辑里特判前缀。
  const filterItems = useMemo(() => {
    const customTabs = conversationGroups
      .filter((g) => g.pinnedToTabs)
      .map((g) => ({ id: `custom:${g.id}`, label: g.name }));
    return [...BASE_FILTERS, ...customTabs];
  }, [BASE_FILTERS, conversationGroups]);

  // 当前激活标签在 filterItems 中的下标，供 FilterTabs 高亮使用
  const activeTab = useMemo(
    () => Math.max(filterItems.findIndex((item) => item.id === activeFilterId), 0),
    [activeFilterId, filterItems],
  );

  // 根据当前激活标签过滤会话列表
  const visibleConversations = useMemo(() => {
    if (activeFilterId === "all") {
      return conversations;
    }

    if (activeFilterId === "unread") {
      return conversations.filter((conversation) => conversation.unreadCount > 0);
    }

    if (activeFilterId === "group") {
      return conversations.filter(
        (conversation) => conversation.conversationType === "group",
      );
    }

    if (activeFilterId === "private") {
      return conversations.filter(
        (conversation) => conversation.conversationType === "private",
      );
    }

    // 自定义分组：activeFilterId 形如 "custom:<groupId>"
    if (activeFilterId.startsWith("custom:")) {
      const groupId = activeFilterId.slice("custom:".length);
      const group = conversationGroups.find((g) => g.id === groupId);
      if (!group) return conversations; // group 被删但 filter 还指着 —— 回退到全部
      const memberSet = new Set(group.conversationIDs);
      return conversations.filter((c) => memberSet.has(c.id));
    }
    return conversations;
  }, [activeFilterId, conversationGroups, conversations]);

  // 点击会话行 → 进入聊天详情页（立即跳转，不等服务端 mark-read / refresh）
  const handleConversationPress = useCallback(
    (conversation: Conversation) => {
      clearLocalUnread(conversation.id);
      // Fire-and-forget：本地未读立即归零 + socket 上报已读水位（末条 height），
      // 不阻塞导航；详情页有自己的拉取逻辑。
      const dto = useChatStore
        .getState()
        .conversations.find((c) => c.id === conversation.id);
      markConversationRead(conversation.id, dto?.lastMessage?.height ?? 0);

      router.push({
        pathname: "/(tabs)/messages/chat-detail",
        params: {
          conversationID: conversation.id,
          sourceID: conversation.sourceID,
          title: conversation.name,
          conversationType: conversation.conversationType,
          conversationKind: dto?.type.toLowerCase(),
          avatarUrl: conversation.avatarUrl,
        },
      });
    },
    [clearLocalUnread, router],
  );

  const handleOpenUserProfile = useCallback(
    (conversation: Conversation) => {
      router.push(
        getUserProfileHref("messages", conversation.sourceID, conversation.name),
      );
    },
    [router],
  );

  const handleMarkConversationUnread = useCallback((conversation: Conversation) => {
    markLocalUnread(conversation.id);
  }, [markLocalUnread]);
  // Compatibility name for older source-level tests; the swipe action now marks
  // a local unread override instead of mutating OpenIM's read state.
  const handleMarkConversationRead = handleMarkConversationUnread;

  const handleHideConversation = useCallback((conversation: Conversation) => {
    clearLocalUnread(conversation.id);
    void updateChatConversationPreferences(conversation.id, { hidden: true }).catch(
      (err) => {
        if (isDev) {
          console.warn("[messages] swipe hide conversation failed", err);
        }
      },
    );
  }, [clearLocalUnread]);

  const handleConfirmDeleteConversation = useCallback(
    (conversation: Conversation) => {
      Alert.alert(
        t("messages.deleteChat"),
        t("messages.deleteChatConfirm", { name: conversation.name }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("common.delete"),
            style: "destructive",
            onPress: () => {
              clearLocalUnread(conversation.id);
              // G-14:删除会话 = 隐藏 + 清空本人历史水位(对齐旧栈
              // deleteConversationAndDeleteAllMsg 的本人侧语义)。对端与
              // 服务端数据不动;新消息到达时会话重新浮出,但旧历史不再可见。
              //
              // 两个请求必须串行且失败要出声。原来是并发 + 只在 __DEV__ 里
              // console.warn:清空失败时会话照样消失,而旧历史会随下一条新消息
              // 整段浮回来;隐藏失败时行还在、时间线却已经空了。两种都是静默的。
              // 先清后隐:清失败就不隐,列表保持原样,用户能看出没成功。
              void (async () => {
                try {
                  await clearChatConversationHistory(conversation.id);
                  await updateChatConversationPreferences(conversation.id, {
                    hidden: true,
                  });
                } catch (err) {
                  if (isDev) {
                    console.warn("[messages] swipe delete failed", err);
                  }
                  Alert.alert(
                    t("messages.deleteChat"),
                    getApiErrorMessage(err, t("common.networkError")),
                  );
                }
              })();
            },
          },
        ],
      );
    },
    [clearLocalUnread, t],
  );

  // 点击搜索图标 → 跳转搜索页
  const handleOpenFind = useCallback(() => {
    router.push("/(tabs)/messages/find");
  }, [router]);

  // 点击已读图标 → 将当前筛选标签下所有会话标记为已读
  // 自研栈:逐会话上报末条 height(pending 队列有断线重试),本地未读即时归零。
  const handleClearUnread = useCallback(() => {
    const dtoById = new Map(
      useChatStore.getState().conversations.map((c) => [c.id, c]),
    );
    for (const c of visibleConversations) {
      markConversationRead(c.id, dtoById.get(c.id)?.lastMessage?.height ?? 0);
    }
    clearManyLocalUnread(visibleConversations.map((c) => c.id));
  }, [clearManyLocalUnread, visibleConversations]);

  // 菜单项点击处理：关闭菜单并按 id 路由跳转
  const handleMenuAction = useCallback(
    (id: MenuActionId) => {
      setMenuVisible(false);
      // 自研栈无临时建群:建群=建圈子,直接进创建圈子页(挂在 discover 栈)。
      if (id === "newGroup") router.push("/(tabs)/discover/create-circle");
      else if (id === "addFriend") router.push("/(tabs)/messages/add-friend");
      else if (id === "seatManagement") router.push("/(tabs)/messages/temp-chats");
      else if (id === "scan") router.push("/(tabs)/messages/scan" as Href);
    },
    [router],
  );

  // 单条会话行渲染：头像（私聊可点击进主页）+ 名称/预览/时间/未读数
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ConversationWithLocalUnread>) => (
      <ConversationRow
        item={item}
        pinnedGroupPosition={getPinnedGroupPosition(visibleConversations, index)}
        labels={swipeLabels}
        rowBackgroundColor={colors.background}
        nameStyle={d.name}
        timeStyle={d.time}
        previewStyle={d.preview}
        pinnedSurfaceStyle={d.pinnedSurface}
        onOpenConversation={handleConversationPress}
        onOpenUserProfile={handleOpenUserProfile}
        onMarkUnread={handleMarkConversationRead}
        onHide={handleHideConversation}
        onDelete={handleConfirmDeleteConversation}
      />
    ),
    [
      colors.background,
      d,
      handleConfirmDeleteConversation,
      handleConversationPress,
      handleHideConversation,
      handleMarkConversationRead,
      handleOpenUserProfile,
      swipeLabels,
      visibleConversations,
    ],
  );

  const hiddenPinnedSeparatorIDs = useMemo(() => {
    const ids = new Set<string>();
    visibleConversations.forEach((conversation, index) => {
      if (conversation.pinned && visibleConversations[index + 1]?.pinned) {
        ids.add(conversation.id);
      }
    });
    return ids;
  }, [visibleConversations]);

  const renderSeparator = useCallback(
    ({
      leadingItem,
    }: {
      leadingItem?: ConversationWithLocalUnread;
    }) =>
      leadingItem && hiddenPinnedSeparatorIDs.has(leadingItem.id) ? null : <Divider />,
    [hiddenPinnedSeparatorIDs],
  );
  const keyExtractor = useCallback((item: Conversation) => item.id, []);

  // 列表 Header：标题行（含操作按钮）+ 筛选 Tab 栏
  const ListHeader = useMemo(() => (
    <View style={s.headerSection}>
      <View style={s.titleRow}>
        <Text style={d.title}>{t('messages.title')}</Text>
        <View style={s.actionRow}>
          {/* ✓✓：一键已读（按当前筛选范围） */}
          <Pressable style={s.actionButton} onPress={handleClearUnread}>
            <Ionicons
              name="checkmark-done-outline"
              size={24}
              color={colors.text}
            />
          </Pressable>
          {/* 搜索按钮：跳转到统一搜索页（会话 + 联系人） */}
          <Pressable style={s.actionButton} onPress={handleOpenFind}>
            <Ionicons name="search-outline" size={24} color={colors.text} />
          </Pressable>
          {/* 「+」按钮：展开快捷操作菜单 */}
          <Pressable onPress={() => setMenuVisible(true)}>
            <Ionicons name="add-circle-outline" size={24} color={colors.text} />
          </Pressable>
        </View>
      </View>
      <FilterTabs
        tabs={filterItems.map((item) => item.label)}
        activeIndex={activeTab}
        onTabPress={(index) => setActiveFilterId(filterItems[index]?.id ?? "all")}
        scrollable
      />
      {/* IM 未连接横幅：WS 没连上就显示（缓存的会话列表能看、但发消息会失败），
          一眼区分"没连上"和"消息丢了"。connecting 时给出"连接中"过渡文案。 */}
      {!imConnected ? (
        <View style={[s.imBanner, d.imBanner]}>
          <Ionicons
            name={imConnecting ? "sync-outline" : "cloud-offline-outline"}
            size={15}
            color={d.imBannerText.color}
          />
          <Text style={[s.imBannerText, d.imBannerText]}>
            {imConnecting
              ? t("messages.imConnecting")
              : t("messages.imNotConnected")}
          </Text>
        </View>
      ) : null}
    </View>
  ), [activeTab, colors, d, filterItems, handleClearUnread, handleOpenFind, imConnected, imConnecting, t]);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <FlatList
        data={visibleConversations}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={renderSeparator}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          <Text style={d.emptyText}>
            {connectionError
              ? t('messages.loadFailed', { error: connectionError })
              : t('messages.noConversations')}
          </Text>
        }
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={handleRefreshConversations}
      />

      {/* 右上角「+」弹出菜单（Modal 实现，点击蒙层关闭） */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable style={s.overlay} onPress={() => setMenuVisible(false)}>
          <View
            style={[
              s.menu,
              d.menuBg,
              { top: insets.top + 56, right: Spacing.lg }, // 状态栏高度 + header 高度下方
            ]}
          >
            {MENU_ACTIONS.map((action) => (
              <Pressable
                key={action.id}
                style={s.menuItem}
                onPress={() => handleMenuAction(action.id)}
              >
                <Ionicons name={action.icon} size={20} color={colors.text} />
                <Text style={d.menuLabel}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
