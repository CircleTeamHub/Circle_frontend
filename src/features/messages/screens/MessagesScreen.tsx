import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Divider } from "@/components/ui/divider";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { loadConversationList, markConversationAsRead } from "@/im/client";
import { mapConversationItemToUI } from "@/im/mappers";
import { getUnreadDiscoverAlertCount } from "@/features/messages/data/discover-alerts";
import { getUserProfileHref } from "@/features/user/utils/routes";
import { useIMStore } from "@/stores/imStore";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import type { Conversation } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  ListRenderItemInfo,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BASE_FILTER_KEYS = [
  { id: "all", key: "messages.all" },
  { id: "unread", key: "messages.unread" },
  { id: "group", key: "messages.group" },
  { id: "private", key: "messages.private" },
] as const;

const MENU_ACTION_KEYS: {
  icon: keyof typeof Ionicons.glyphMap;
  key: string;
}[] = [
  { icon: "people-outline", key: "messages.newGroup" },
  { icon: "person-add-outline", key: "messages.addFriend" },
  { icon: "scan-outline", key: "messages.scan" },
  { icon: "call-outline", key: "messages.seatManagement" },
  { icon: "people-circle-outline", key: "messages.groupManagement" },
];

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
  // 标题行：左侧"消息"文字 + 右侧操作按钮组
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  // 右侧操作按钮组（通知、已读、搜索、+）
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
  // 通知图标右上角的未读角标
  actionBadge: {
    position: "absolute",
    top: -8,
    right: -12,
  },
  // 单条会话行：头像 + 内容区
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.md,
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

// MessagesScreen：消息列表主页面
// 功能：
//   1. 展示所有会话，支持按标签筛选（全部/未读/群聊/私聊/自定义群组）
//   2. 头部操作栏：通知跳转、一键已读、搜索、快捷功能菜单
//   3. 点击头像可进入用户主页（仅私聊），点击会话行进入聊天详情
export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const BASE_FILTERS = BASE_FILTER_KEYS.map((f) => ({ id: f.id, label: t(f.key) }));
  const MENU_ACTIONS = MENU_ACTION_KEYS.map((a) => ({ icon: a.icon, label: t(a.key) }));

  const rawConversations = useIMStore((state) => state.conversations);
  const totalUnread = useIMStore((state) => state.totalUnread);
  const connectionError = useIMStore((state) => state.error);

  const [activeFilterId, setActiveFilterId] = useState("all"); // 当前激活的筛选标签 id
  const [menuVisible, setMenuVisible] = useState(false);        // 右上角弹出菜单的显隐

  // 发现页未读通知数，用于通知图标角标
  const unreadNotificationCount = getUnreadDiscoverAlertCount();

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
    }),
    [colors],
  );

  // 筛选标签列表 = 固定标签 + 用户自定义群组（动态追加）
  const conversations = useMemo(
    () => rawConversations.map(mapConversationItemToUI),
    [rawConversations],
  );

  const filterItems = BASE_FILTERS;

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
    return conversations;
  }, [activeFilterId, conversations]);

  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (hasFetchedRef.current) {
      return;
    }
    hasFetchedRef.current = true;
    loadConversationList().catch(() => {
      // Surface connection issues through IM store error state.
    });
  }, []);

  // 点击会话行 → 进入聊天详情页
  const handleConversationPress = useCallback(
    async (conversation: Conversation) => {
      try {
        await markConversationAsRead(conversation.id);
        await loadConversationList();
      } catch {
        // Keep navigation responsive even when marking read fails.
      }

      router.push({
        pathname: "/(tabs)/messages/chat-detail",
        params: {
          conversationID: conversation.id,
          sourceID: conversation.sourceID,
          title: conversation.name,
          conversationType: conversation.conversationType,
          avatarUrl: conversation.avatarUrl,
        },
      });
    },
    [router],
  );

  const handleOpenUserProfile = useCallback(
    (conversation: Conversation) => {
      router.push(
        getUserProfileHref("messages", conversation.sourceID, conversation.name),
      );
    },
    [router],
  );

  const handleOpenNotifications = useCallback(() => {
    router.push("/(tabs)/discover");
  }, [router]);

  // 点击搜索图标 → 跳转搜索页
  const handleOpenFind = useCallback(() => {
    router.push("/(tabs)/messages/find");
  }, [router]);

  // 点击已读图标 → 将当前筛选标签下所有会话标记为已读
  const handleClearUnread = useCallback(() => {
    Promise.all(visibleConversations.map((conversation) => markConversationAsRead(conversation.id)))
      .then(() => loadConversationList())
      .catch(() => {
        // Ignore partial failures and leave the current list intact.
      });
  }, [visibleConversations]);

  // 菜单项点击处理：关闭菜单并按 label 路由跳转
  const handleMenuAction = useCallback(
    (label: string) => {
      setMenuVisible(false);
      if (label === "添加好友") router.push("/(tabs)/messages/add-friend");
      if (label === "群组管理") router.push("/(tabs)/messages/groups");
    },
    [router],
  );

  // 单条会话行渲染：头像（私聊可点击进主页）+ 名称/预览/时间/未读数
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Conversation>) => (
      <View style={s.row}>
        {item.conversationType === "private" ? (
          <Pressable onPress={() => handleOpenUserProfile(item)}>
            <Avatar size={40} name={item.name} uri={item.avatarUrl} />
          </Pressable>
        ) : (
          <Avatar size={40} name={item.name} uri={item.avatarUrl} />
        )}
        <Pressable style={s.rowContent} onPress={() => handleConversationPress(item)}>
          <View style={s.rowTop}>
            <Text style={d.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={d.time}>{item.time}</Text>
          </View>
          <View style={s.rowBottom}>
            <Text style={d.preview} numberOfLines={1}>
              {item.message}
            </Text>
            <Badge count={item.unreadCount} />
          </View>
        </Pressable>
      </View>
    ),
    [handleConversationPress, handleOpenUserProfile, d],
  );

  const renderSeparator = useCallback(() => <Divider />, []);
  const keyExtractor = useCallback((item: Conversation) => item.id, []);

  // 列表 Header：标题行（含操作按钮）+ 筛选 Tab 栏
  const ListHeader = useMemo(() => (
    <View style={s.headerSection}>
      <View style={s.titleRow}>
        <Text style={d.title}>{t('messages.title')}</Text>
        <View style={s.actionRow}>
          {/* 通知按钮：右上角显示未读角标 */}
          <Pressable
            style={s.actionButton}
            onPress={handleOpenNotifications}
          >
            <Ionicons
              name="notifications-outline"
              size={24}
              color={colors.text}
            />
            <View style={s.actionBadge}>
              <Badge count={Math.max(unreadNotificationCount, totalUnread)} />
            </View>
          </Pressable>
          {/* 一键已读：将当前标签下所有会话标记为已读 */}
          <Pressable style={s.actionButton} onPress={handleClearUnread}>
            <Ionicons
              name="checkmark-done-outline"
              size={24}
              color={colors.text}
            />
          </Pressable>
          {/* 搜索按钮 */}
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
    </View>
  ), [activeTab, colors, d, filterItems, handleClearUnread, handleOpenFind, handleOpenNotifications, totalUnread, unreadNotificationCount]);

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
            {connectionError ? t('messages.loadFailed', { error: connectionError }) : t('messages.noConversations')}
          </Text>
        }
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
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
              { top: insets.top + 56, right: Spacing.lg }, // 定位在状态栏高度 + header 高度下方
            ]}
          >
            {MENU_ACTIONS.map((action) => (
              <Pressable
                key={action.label}
                style={s.menuItem}
                onPress={() => handleMenuAction(action.label)}
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
