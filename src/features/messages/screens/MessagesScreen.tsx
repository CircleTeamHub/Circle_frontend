import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Divider } from "@/components/ui/divider";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { getUnreadDiscoverAlertCount } from "@/features/messages/data/discover-alerts";
import { useMessageGroupsStore } from "@/features/messages/store/use-message-groups-store";
import { getUserProfileIdByName } from "@/features/user/data/profiles";
import { getUserProfileHref } from "@/features/user/utils/routes";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import type { Conversation } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
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

const BASE_FILTERS = [
  { id: "all", label: "全部" },
  { id: "unread", label: "未读" },
  { id: "group", label: "群聊" },
  { id: "private", label: "私聊" },
];

const MENU_ACTIONS: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}[] = [
  { icon: "people-outline", label: "新建群聊" },
  { icon: "person-add-outline", label: "添加好友" },
  { icon: "scan-outline", label: "扫一扫" },
  { icon: "call-outline", label: "坐席管理" },
  { icon: "people-circle-outline", label: "群组管理" },
];

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const conversations = useMessageGroupsStore((state) => state.conversations);
  const customGroups = useMessageGroupsStore((state) => state.customGroups);
  const clearUnreadByFilter = useMessageGroupsStore(
    (state) => state.clearUnreadByFilter,
  );
  const [activeFilterId, setActiveFilterId] = useState("all");
  const [menuVisible, setMenuVisible] = useState(false);
  const unreadNotificationCount = getUnreadDiscoverAlertCount();

  const filterItems = useMemo(
    () => [
      ...BASE_FILTERS,
      ...customGroups.map((group) => ({ id: group.id, label: group.name })),
    ],
    [customGroups],
  );

  const activeTab = useMemo(
    () => Math.max(filterItems.findIndex((item) => item.id === activeFilterId), 0),
    [activeFilterId, filterItems],
  );

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

    return conversations.filter(
      (conversation) =>
        conversation.conversationType === "group" &&
        (conversation.customGroupIds ?? []).includes(activeFilterId),
    );
  }, [activeFilterId, conversations]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        listContent: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: 100,
        },
        headerSection: {
          gap: Spacing.lg,
          paddingTop: Spacing.md,
          paddingBottom: Spacing.sm,
        },
        titleRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
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
        actionBadge: {
          position: "absolute",
          top: -8,
          right: -12,
        },
        title: {
          color: colors.text,
          ...Typography.title,
        },
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
        rowTop: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        rowBottom: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        name: {
          color: colors.text,
          fontSize: 15,
          fontWeight: "600",
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
          textAlign: "center",
          paddingTop: Spacing.xl,
        },
        overlay: {
          flex: 1,
          backgroundColor: "rgba(0, 0, 0, 0.4)",
        },
        menu: {
          position: "absolute",
          backgroundColor: colors.surface,
          borderRadius: Radius.md,
          paddingVertical: Spacing.sm,
          minWidth: 160,
          borderWidth: 1,
          borderColor: colors.surfaceBorder,
        },
        menuItem: {
          flexDirection: "row",
          alignItems: "center",
          gap: Spacing.md,
          paddingVertical: Spacing.md,
          paddingHorizontal: Spacing.lg,
        },
        menuLabel: {
          color: colors.text,
          ...Typography.body,
        },
      }),
    [colors],
  );

  const handleConversationPress = useCallback(() => {
    router.push("/(tabs)/messages/chat-detail");
  }, [router]);

  const handleOpenUserProfile = useCallback(
    (name: string) => {
      router.push(
        getUserProfileHref("messages", getUserProfileIdByName(name), name),
      );
    },
    [router],
  );

  const handleOpenNotifications = useCallback(() => {
    router.push("/(tabs)/discover");
  }, [router]);

  const handleOpenFind = useCallback(() => {
    router.push("/(tabs)/messages/find");
  }, [router]);

  const handleClearUnread = useCallback(() => {
    clearUnreadByFilter(activeFilterId);
  }, [activeFilterId, clearUnreadByFilter]);

  const handleMenuAction = useCallback(
    (label: string) => {
      setMenuVisible(false);
      if (label === "添加好友") router.push("/(tabs)/messages/add-friend");
      if (label === "群组管理") router.push("/(tabs)/messages/groups");
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Conversation>) => (
      <View style={styles.row}>
        {item.conversationType === "private" ? (
          <Pressable onPress={() => handleOpenUserProfile(item.name)}>
            <Avatar size={40} name={item.name} uri={item.avatarUrl} />
          </Pressable>
        ) : (
          <Avatar size={40} name={item.name} uri={item.avatarUrl} />
        )}
        <Pressable style={styles.rowContent} onPress={handleConversationPress}>
          <View style={styles.rowTop}>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.time}>{item.time}</Text>
          </View>
          <View style={styles.rowBottom}>
            <Text style={styles.preview} numberOfLines={1}>
              {item.message}
            </Text>
            <Badge count={item.unreadCount} />
          </View>
        </Pressable>
      </View>
    ),
    [handleConversationPress, handleOpenUserProfile, styles],
  );

  const renderSeparator = useCallback(() => <Divider />, []);
  const keyExtractor = useCallback((item: Conversation) => item.id, []);

  const ListHeader = (
    <View style={styles.headerSection}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>消息</Text>
        <View style={styles.actionRow}>
          <Pressable
            style={styles.actionButton}
            onPress={handleOpenNotifications}
          >
            <Ionicons
              name="notifications-outline"
              size={24}
              color={colors.text}
            />
            <View style={styles.actionBadge}>
              <Badge count={unreadNotificationCount} />
            </View>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={handleClearUnread}>
            <Ionicons
              name="checkmark-done-outline"
              size={24}
              color={colors.text}
            />
          </Pressable>
          <Pressable style={styles.actionButton} onPress={handleOpenFind}>
            <Ionicons name="search-outline" size={24} color={colors.text} />
          </Pressable>
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
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <FlatList
        data={visibleConversations}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={renderSeparator}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={<Text style={styles.emptyText}>暂无会话</Text>}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setMenuVisible(false)}>
          <View
            style={[
              styles.menu,
              { top: insets.top + 56, right: Spacing.lg },
            ]}
          >
            {MENU_ACTIONS.map((action) => (
              <Pressable
                key={action.label}
                style={styles.menuItem}
                onPress={() => handleMenuAction(action.label)}
              >
                <Ionicons name={action.icon} size={20} color={colors.text} />
                <Text style={styles.menuLabel}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
