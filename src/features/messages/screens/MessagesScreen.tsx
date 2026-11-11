import { Avatar } from "@/components/ui/avatar";
import { GroupChatAvatar } from "@/components/ui/group-chat-avatar";
import { MemberName } from "@/components/ui/member-name";
import { Badge } from "@/components/ui/badge";
import { FilterTabs } from "@/components/ui/filter-tabs";
import {
  canSkipConversationFocusReload,
  clearChatConversationHistory,
  loadChatConversations,
  updateChatConversationPreferences,
} from "@/chat-core/api";
import { mapChatConversationToUI } from "@/chat-core/mappers";
import { markConversationRead } from "@/chat-core/socket-manager";
import { selectTotalUnread, useChatStore } from "@/chat-core/store";
import { selectConversations } from "@/chat-core/conversation-selectors";
import ChatDetailScreen, {
  type EmbeddedChatParams,
} from "@/features/chat/screens/ChatDetailScreen";
import { selectFailedConversationKey } from "@/features/messages/utils/failed-preview";
import { ChatConnectionBanner } from "@/features/chat/components/ChatConnectionBanner";
import {
  parsePinnedLayoutKey,
  pinnedLayoutKeyOf,
} from "@/features/messages/utils/pinned-layout";
import { useComposerDraftStore } from "@/chat-core/composer-drafts";
import { draftPreviewText } from "@/chat-core/composer-draft-model";
import { useMessageGroupsStore } from "@/features/messages/store/use-message-groups-store";
import { orderMessageFilters } from "@/features/messages/utils/message-filter-order";
import { getUserProfileHref } from "@/features/user/utils/routes";
import { SplitPaneResizer } from "@/components/app/split-pane-resizer";
import { useDesktopSplitLayout } from "@/hooks/use-desktop-split-layout";
import { useScreenLive } from "@/hooks/use-screen-live";
import { useStoreWhileActive } from "@/hooks/use-store-while-active";
import { useConversationListSnapshot } from '@/features/messages/hooks/use-conversation-list-snapshot';
import { useFocusReloadGate } from '@/hooks/use-focus-reload-gate';
import { useSplitPaneStore } from "@/stores/splitPaneStore";
import { getApiErrorMessage } from "@/services/api/errors";
import { useTabBadgeStore } from "@/stores/tabBadgeStore";
import { useFriendRemarkStore } from '@/stores/friendRemarkStore';
import { fetchFriends, friendsMutatedSince } from '@/services/api/friends';
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import type { Conversation } from "@/types";
import { E2E_TEST_IDS } from "@/testing/e2e-test-ids";
import { Ionicons } from "@expo/vector-icons";
import { CheckCheck, Search } from 'lucide-react-native';
import { type Href, useFocusEffect, useNavigation, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  FlatList,
  ListRenderItemInfo,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { reportHandledFailure } from '@/observability/report-failure';
import { useAppSettingsStore } from '@/features/profile/store/use-app-settings-store';
import { AssistantAvatar } from '@/features/assistant/components/AssistantAvatar';

const SWIPE_ACTION_WIDTH = 76;
const SWIPE_ACTIONS_WIDTH = SWIPE_ACTION_WIDTH * 3;
const ROW_AVATAR_SIZE = 48;
const ROW_GAP = 12;
/** 会话文字列的起点：分隔线从这里开始画。 */
const ROW_TEXT_INSET = Spacing.lg + ROW_AVATAR_SIZE + ROW_GAP;
const SWIPE_OPEN_THRESHOLD = SWIPE_ACTION_WIDTH;
// 桌面分栏时 tabbar 统一居中到整个视口底部；右侧聊天区要留出这段空间，
// 否则 tabbar 会盖住 ChatComposerBar 的输入框。
const DESKTOP_TAB_BAR_RESERVED_HEIGHT = 64;
const selectFriendRemarks = (state: ReturnType<typeof useFriendRemarkStore.getState>) => state.remarks;

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

// 静态样式（不依赖主题色，提取到组件外避免每次渲染重建）
const s = StyleSheet.create({
  // —— 桌面网页版分栏（useDesktopSplitLayout 命中时启用）——
  splitRoot: {
    flex: 1,
    flexDirection: "row",
  },
  splitListPane: {
    // 宽度是用户可拖的（splitPaneStore），右侧描边交给 SplitPaneResizer，
    // 这里不再画边框，否则拖拽时会出现双线。
  },
  splitDetailPane: {
    flex: 1,
    paddingBottom: DESKTOP_TAB_BAR_RESERVED_HEIGHT,
  },
  splitEmptyPane: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  splitEmptyText: {
    ...Typography.body,
  },
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
  // 右侧操作按钮组（多选、搜索、+）
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  actionButton: {
    position: "relative",
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  quickAddIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickAddStroke: { position: 'absolute', width: 22, height: 4, borderRadius: 2 },
  selectionHeaderSection: { gap: Spacing.md, paddingTop: Spacing.sm },
  selectionTopRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  selectionHeaderAction: { width: 80, minHeight: 44, justifyContent: 'center' },
  selectionHeaderActionEnd: { alignItems: 'flex-end' },
  selectionHeading: { flex: 1, minWidth: 0, alignItems: 'center', gap: Spacing.xs },
  selectionHeaderLabel: { ...Typography.body },
  selectionTitle: { ...Typography.h3, textAlign: 'center' },
  selectionCount: { ...Typography.caption, textAlign: 'center' },
  selectionCheckbox: { minWidth: 28, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  selectionFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.md, paddingHorizontal: Spacing.lg },
  selectionFooterRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  selectionActionButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    borderRadius: Radius.lg,
    paddingHorizontal: 12,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  selectionActionLabel: { ...Typography.body, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  selectionActionDisabled: { opacity: 0.4 },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  filterTabsSlot: {
    flex: 1,
    minWidth: 0,
  },
  addGroupButton: {
    width: 32,
    height: 32,
    flexShrink: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  addGroupIcon: {
    fontSize: 22,
    lineHeight: 24,
    transform: [{ translateY: -2 }],
  },
  // 折叠箭头嵌在第 N 个置顶会话的右下角，不再单独占一行。
  pinnedFoldButton: {
    width: 24,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinnedFoldIcon: {
    // 让箭头更贴近卡片底部，按钮的触控范围仍保持原位置和大小。
    transform: [{ translateY: 6 }],
  },
  // 单条会话行外层：抵掉列表左右内边距，整行通栏（置顶底色、左滑操作都铺满屏宽）。
  row: {
    marginHorizontal: -Spacing.lg,
    overflow: "hidden",
  },
  swipeForeground: {
    zIndex: 1,
  },
  swipeActions: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: SWIPE_ACTIONS_WIDTH,
    flexDirection: "row",
    justifyContent: "flex-end",
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
  // 单条会话内容：头像 + 内容区。置顶行在这层铺底色（d.pinnedSurface），通栏、无圆角，
  // 头像和文字与普通行对齐在同一条竖线上。
  rowSurface: {
    flexDirection: "row",
    alignItems: "center",
    gap: ROW_GAP,
    paddingVertical: 12,
    paddingHorizontal: Spacing.lg,
  },
  // 分隔线从文字列起画，头像底下不画；连续置顶之间的那条垫在置顶底色上，色带不断开。
  rowSeparator: {
    marginHorizontal: -Spacing.lg,
    paddingLeft: ROW_TEXT_INSET,
  },
  rowSeparatorLine: {
    height: StyleSheet.hairlineWidth,
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
  },
  mutedIndicator: {
    width: 18,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  // 会话行下半：消息预览（左）+ 未读数角标（右）
  rowBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowBottomTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: Spacing.sm,
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
  draftPrefix: string;
  pin: string;
  unpin: string;
  mute: string;
  unmute: string;
  markRead: string;
  delete: string;
};

type ConversationRowProps = {
  item: Conversation;
  testID: string;
  labels: ConversationRowLabels;
  rowBackgroundColor: string;
  nameStyle: object;
  timeStyle: object;
  previewStyle: object;
  pinnedSurfaceStyle: object;
  /** 置顶行底色更深，时间/预览换用置顶专用次要色（见 d.pinnedTime / d.pinnedPreview）。 */
  pinnedTimeStyle: object;
  pinnedPreviewStyle: object;
  draftPrefixStyle: object;
  onOpenConversation: (conversation: Conversation) => void;
  onOpenUserProfile: (conversation: Conversation) => void;
  onTogglePinned: (conversation: Conversation) => void;
  onToggleMuted: (conversation: Conversation) => void;
  onMarkRead: (conversation: Conversation) => void;
  onDelete: (conversation: Conversation) => void;
  /** 只传给第 N 个置顶会话：箭头嵌在该卡片右下角。 */
  pinnedFoldExpanded?: boolean;
  pinnedFoldHiddenCount?: number;
  onTogglePinnedFold?: () => void;
  /** 桌面分栏下禁用：鼠标点击/框选的横向抖动会误触滑动，把操作条卡在半开。 */
  swipeEnabled: boolean;
  selectionMode: boolean;
  selected: boolean;
  selectionBusy: boolean;
  onToggleSelection: (conversation: Conversation) => void;
};

function ConversationRowImpl({
  item,
  testID,
  labels,
  rowBackgroundColor,
  nameStyle,
  timeStyle,
  previewStyle,
  pinnedSurfaceStyle,
  pinnedTimeStyle,
  pinnedPreviewStyle,
  draftPrefixStyle,
  onOpenConversation,
  onOpenUserProfile,
  onTogglePinned,
  onToggleMuted,
  onMarkRead,
  onDelete,
  pinnedFoldExpanded,
  pinnedFoldHiddenCount = 0,
  onTogglePinnedFold,
  swipeEnabled,
  selectionMode,
  selected,
  selectionBusy,
  onToggleSelection,
}: ConversationRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const translateX = useRef(new Animated.Value(0)).current;
  const currentXRef = useRef(0);

  useEffect(() => {
    if (selectionMode) {
      currentXRef.current = 0;
      translateX.setValue(0);
    }
  }, [selectionMode, translateX]);

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

  // 静止时（translateX = 0）整层透明：swipeForeground 带 borderRadius，圆角那
  // 一小块不上色，常驻在底下的操作层最右是 colors.error，红色会从缺口里透成
  // 两道月牙 —— 行背景越暗越扎眼。一开始滑就立刻实体化，不影响揭示动画。
  const swipeActionsOpacity = useMemo(
    () =>
      translateX.interpolate({
        inputRange: [-SWIPE_ACTIONS_WIDTH, -1, 0],
        outputRange: [1, 1, 0],
        extrapolate: 'clamp',
      }),
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

  // 长按会话打开操作菜单；桌面网页版同时支持右键。
  // 菜单走 Alert(三端都由 AppDialogHost 渲染),与全 app 其他菜单同一套。
  const showRowActionMenu = useCallback(() => {
    closeSwipe();
    Alert.alert('', '', [
      {
        text: labels.markRead,
        onPress: () => onMarkRead(item),
      },
      {
        text: item.pinned ? labels.unpin : labels.pin,
        onPress: () => onTogglePinned(item),
      },
      {
        text: item.muted ? labels.unmute : labels.mute,
        onPress: () => onToggleMuted(item),
      },
      {
        text: labels.delete,
        style: 'destructive',
        onPress: () => onDelete(item),
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }, [closeSwipe, item, labels, onDelete, onMarkRead, onToggleMuted, onTogglePinned, t]);

  // Web 的右键:RN 没有这个手势,直接给宿主节点挂 DOM 监听。
  const rowRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || swipeEnabled || selectionMode) return;
    const node = rowRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const onContextMenu = (event: Event) => {
      event.preventDefault();
      showRowActionMenu();
    };
    node.addEventListener('contextmenu', onContextMenu);
    return () => node.removeEventListener('contextmenu', onContextMenu);
  }, [selectionMode, showRowActionMenu, swipeEnabled]);

  const renderSwipeActions = () => (
    <Animated.View style={[s.swipeActions, { opacity: swipeActionsOpacity }]}>
      <Pressable
        style={[s.swipeAction, { backgroundColor: colors.primary }]}
        onPress={() => handleSwipeAction(onTogglePinned)}
      >
        <Ionicons name="pin-outline" size={20} color={colors.white} />
        <Text style={[s.swipeActionLabel, { color: colors.white }]}>
          {item.pinned ? labels.unpin : labels.pin}
        </Text>
      </Pressable>
      <Pressable
        style={[s.swipeAction, { backgroundColor: colors.warning }]}
        onPress={() => handleSwipeAction(onToggleMuted)}
      >
        <Ionicons
          name={item.muted ? "notifications-outline" : "notifications-off-outline"}
          size={20}
          color={colors.white}
        />
        <Text style={[s.swipeActionLabel, { color: colors.white }]}>
          {item.muted ? labels.unmute : labels.mute}
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
    </Animated.View>
  );

  // 置顶行铺了浅灰 pinnedSurface：次要文字/免打扰图标换成置顶专用色保证对比度；
  // 临时群时钟角标的外圈也要融入置顶底色，而不是列表底色（浅色下会露一圈光环）。
  const metaTextStyle = item.pinned ? pinnedTimeStyle : timeStyle;
  const messageStyle = item.pinned ? pinnedPreviewStyle : previewStyle;
  const mutedIconColor = item.pinned
    ? colors.pinnedTextSecondary
    : colors.textSecondary;
  const badgeBorderColor = item.pinned ? colors.pinnedSurface : rowBackgroundColor;
  const pinnedFoldLabel = onTogglePinnedFold
    ? pinnedFoldExpanded
      ? t('settingsDetails.appearance.collapsePinned', {
          defaultValue: '收起置顶会话',
        })
      : t('settingsDetails.appearance.showCollapsedPinned', {
          defaultValue: '展开另外 {{count}} 个置顶会话',
          count: pinnedFoldHiddenCount,
        })
    : undefined;

  return (
    <View ref={rowRef} style={s.row}>
      {/* 桌面分栏：选中高亮是半透明色，垫在下面的操作层会透出来；
          手势也已禁用，这层不渲染。 */}
      {swipeEnabled ? renderSwipeActions() : null}
      <Animated.View
        {...(swipeEnabled ? panResponder.panHandlers : null)}
        style={[
          s.swipeForeground,
          { backgroundColor: rowBackgroundColor, transform: [{ translateX }] },
        ]}
      >
        <View style={[s.rowSurface, item.pinned ? pinnedSurfaceStyle : null]}>
          {selectionMode ? (
            <Pressable
              style={s.selectionCheckbox}
              accessibilityRole="checkbox"
              accessibilityLabel={item.name}
              accessibilityState={{ checked: selected, disabled: selectionBusy }}
              disabled={selectionBusy}
              onPress={() => onToggleSelection(item)}
              hitSlop={8}
            >
              <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={25} color={selected ? colors.primary : colors.textSecondary} />
            </Pressable>
          ) : null}
          {item.isAssistant ? (
            <Pressable disabled={selectionMode && selectionBusy} onPress={() => selectionMode ? onToggleSelection(item) : onOpenConversation(item)}>
              <AssistantAvatar size={ROW_AVATAR_SIZE} />
            </Pressable>
          ) : item.conversationType === "private" ? (
            <Pressable disabled={selectionMode && selectionBusy} onPress={() => selectionMode ? onToggleSelection(item) : onOpenUserProfile(item)}>
              <Avatar size={ROW_AVATAR_SIZE} name={item.name} uri={item.avatarUrl} />
            </Pressable>
          ) : (
            <Pressable disabled={!selectionMode || selectionBusy} onPress={() => onToggleSelection(item)}>
            <GroupChatAvatar
              size={ROW_AVATAR_SIZE}
              name={item.name}
              uri={item.avatarUrl}
              temporary={item.isTempChat}
              badgeBorderColor={badgeBorderColor}
            />
            </Pressable>
          )}
          <Pressable
            testID={testID}
            style={s.rowContent}
            disabled={selectionMode && selectionBusy}
            onPress={() => selectionMode ? onToggleSelection(item) : onOpenConversation(item)}
            onLongPress={selectionMode ? undefined : showRowActionMenu}
          >
            <View style={s.rowTop}>
              <View style={s.nameRow}>
                <MemberName
                  name={item.name}
                  userId={
                    item.conversationType === 'private' && !item.isAssistant
                      ? item.sourceID
                      : undefined
                  }
                  style={nameStyle}
                  numberOfLines={1}
                />
              </View>
              <View style={s.rowMeta}>
                <Text style={metaTextStyle}>{item.time}</Text>
              </View>
            </View>
            <View style={s.rowBottom}>
              <Text style={messageStyle} numberOfLines={1}>
                {item.draftPreview !== undefined ? (
                  <>
                    <Text style={draftPrefixStyle}>{labels.draftPrefix}</Text>
                    {item.draftPreview ? ` ${item.draftPreview}` : null}
                  </>
                ) : (
                  item.message
                )}
              </Text>
              <View style={s.rowBottomTrailing}>
                <Badge count={item.unreadCount} />
                {item.muted ? (
                  <View style={s.mutedIndicator}>
                    <Ionicons
                      name="notifications-off-outline"
                      size={15}
                      color={mutedIconColor}
                      accessibilityLabel={t("messages.mutedA11y", {
                        defaultValue: "消息免打扰",
                      })}
                    />
                  </View>
                ) : null}
                {onTogglePinnedFold ? (
                  <Pressable
                    style={s.pinnedFoldButton}
                    onPress={(event) => {
                      event.stopPropagation();
                      onTogglePinnedFold();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={pinnedFoldLabel}
                    hitSlop={12}
                  >
                    <Ionicons
                      style={s.pinnedFoldIcon}
                      name={pinnedFoldExpanded ? 'chevron-up' : 'chevron-down'}
                      size={10}
                      color={colors.pinnedTextSecondary}
                    />
                  </Pressable>
                ) : null}
              </View>
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
//   2. 头部操作栏：多选、搜索；长按会话可标记已读、删除或修改偏好
//   3. 点击头像可进入用户主页（仅私聊），点击会话行进入聊天详情
// memo 化会话行：配合上游稳定的 item 引用，未变化的行跳过重渲染。
const ConversationRow = memo(ConversationRowImpl);

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();
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
      draftPrefix: t("im.preview.draftPrefix", { defaultValue: "[草稿]" }),
      pin: t("messages.swipePin", { defaultValue: "置顶" }),
      unpin: t("messages.swipeUnpin", { defaultValue: "取消置顶" }),
      mute: t("messages.swipeMute", { defaultValue: "静音" }),
      unmute: t("messages.swipeUnmute", { defaultValue: "取消静音" }),
      markRead: t("messages.swipeMarkRead", { defaultValue: "标记已读" }),
      delete: t("messages.swipeDelete"),
    }),
    [t],
  );

  // 页面不在前台(切到别的 tab,或聊天页压在上面)时不再跟着聊天 store 走:原生栈
  // 为了右滑返回不会冻结紧挨在当前页下面的这一页,不停订阅的话每条消息都整表重算。
  // 右滑返回一开始就恢复(useScreenLive),露出来的是最新列表;focus effect 也会重拉一遍会话。
  const isLive = useScreenLive();
  const rawConversations = useStoreWhileActive(
    useChatStore,
    selectConversations,
    isLive,
  );
  const currentUserID = useChatStore((state) => state.currentUserId);
  const friendRemarks = useStoreWhileActive(useFriendRemarkStore, selectFriendRemarks, isLive);
  const remarkReloadGate = useFocusReloadGate({ key: currentUserID, mutatedSince: friendsMutatedSince });
  const connectionError = useChatStore((state) => state.error);
  const imConnected = useChatStore((state) => state.connected);
  const conversationsSnapshotLoaded = useChatStore(
    (state) => state.conversationsSnapshotLoaded,
  );
  const conversationGroups = useMessageGroupsStore((state) => state.groups);
  const filterOrder = useMessageGroupsStore((state) => state.filterOrder);
  const [activeFilterId, setActiveFilterId] = useState("all"); // 当前激活的筛选标签 id
  const [menuVisible, setMenuVisible] = useState(false);        // 右上角弹出菜单的显隐
  const [quickAddExpanded, setQuickAddExpanded] = useState(false);
  const quickAddProgress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(quickAddProgress, {
      toValue: quickAddExpanded ? 1 : 0,
      duration: 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [quickAddExpanded, quickAddProgress]);
  const handleOpenMenu = useCallback(() => {
    setQuickAddExpanded(true);
    setMenuVisible(true);
  }, []);
  const handleCloseMenu = useCallback(() => {
    setMenuVisible(false);
    setQuickAddExpanded(false);
  }, []);
  // 进入菜单里的页面时保留 ×，返回首页时再复原。
  useEffect(() => { if (isLive) setQuickAddExpanded(false); }, [isLive]);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllPinned, setShowAllPinned] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string> | null>(null);
  const selecting = selectedConversationIds !== null;
  const [batchDeleting, setBatchDeleting] = useState(false);
  const batchDeleteInFlightRef = useRef(false);
  const pinnedFoldCount = useAppSettingsStore((state) => state.pinnedFoldCount);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);
  const wasConnectedRef = useRef(imConnected);
  const preferenceWriteInFlightRef = useRef(new Set<string>());

  useEffect(() => {
    setSelectedConversationIds(null);
    handleCloseMenu();
  }, [currentUserID, handleCloseMenu]);

  useLayoutEffect(() => {
    const tabs = navigation.getParent();
    tabs?.setOptions({ tabBarStyle: selecting ? { display: 'none' } : undefined });
    return () => tabs?.setOptions({ tabBarStyle: undefined });
  }, [navigation, selecting]);

  const handleStartSelection = useCallback(() => {
    if (batchDeleteInFlightRef.current) return;
    handleCloseMenu();
    setSelectedConversationIds(new Set());
  }, [handleCloseMenu]);
  const handleExitSelection = useCallback(() => {
    if (!batchDeleteInFlightRef.current) setSelectedConversationIds(null);
  }, []);
  const handleToggleSelection = useCallback((conversation: Conversation) => {
    if (batchDeleteInFlightRef.current) return;
    setSelectedConversationIds((current) => {
      if (!current) return current;
      const next = new Set(current);
      if (next.has(conversation.id)) next.delete(conversation.id);
      else next.add(conversation.id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!selecting || !isLive) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleExitSelection();
      return true;
    });
    return () => subscription.remove();
  }, [handleExitSelection, isLive, selecting]);

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
      // The unmatched-route fallback can mount this screen while auth/session
      // bootstrap is still restoring the current user. Wait for the scoped
      // chat session, then rerun the focus effect when it becomes available.
      if (!currentUserID) return;
      // 连接正常、刚拉过完整快照就不重拉(30 秒窗口):进出聊天页来回切,原来每次都重拉
      // 最多 500 个会话。会话变化靠实时会话事件推送,建群会就地写 store。
      if (canSkipConversationFocusReload()) return;

      loadChatConversations().catch((err) => {
        // 列表加载失败时保留已有会话,empty state 兜底显示。
        // dev 下额外打印，便于排查"为啥列表是空的"。
        reportHandledFailure("messages", "focusLoadConversations", err);
      });
    }, [currentUserID]),
  );

  useFocusEffect(useCallback(() => {
    if (!currentUserID || remarkReloadGate.shouldSkip()) return;
    let cancelled = false;
    const startedAt = Date.now();
    const snapshot = useFriendRemarkStore.getState().remarks;
    fetchFriends().then((friends) => {
      if (cancelled || useChatStore.getState().currentUserId !== currentUserID) return;
      useFriendRemarkStore.getState().syncServerRemarks(friends, snapshot);
      remarkReloadGate.markLoaded(startedAt);
    }).catch((error) => {
      if (!cancelled) reportHandledFailure('messages', 'syncFriendRemarks', error);
    });
    return () => { cancelled = true; };
  }, [currentUserID, remarkReloadGate]));

  // 首次进消息页时 REST 可能正好撞上后端重启，且 socket 恢复后页面仍保持焦点，
  // 原来的 focus effect 不会再跑一次，结果只能等用户点进某个会话才看到内容。
  // 连接从断开恢复时补拉一次；已有完整快照则跳过，避免冷启动重复请求。
  useEffect(() => {
    const wasConnected = wasConnectedRef.current;
    wasConnectedRef.current = imConnected;
    if (
      !currentUserID ||
      !imConnected ||
      wasConnected ||
      conversationsSnapshotLoaded
    ) {
      return;
    }

    loadChatConversations().catch((err) => {
      // focus effect 已经有一次失败记录；这里仅记录连接恢复后的补拉失败，
      // 下一次连接恢复仍会重试，不覆盖现有本地快照。
      reportHandledFailure("messages", "connectionRefreshConversations", err);
    });
  }, [currentUserID, imConnected, conversationsSnapshotLoaded]);

  const handleRefreshConversations = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await loadChatConversations();
    } catch (err) {
      reportHandledFailure("messages", "refreshConversations", err);
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  // tab 角标不靠这里:chat-core/app-badge 在根上独立同步,本页冻结或失焦都不影响。
  const totalUnread = useStoreWhileActive(useChatStore, selectTotalUnread, isLive);
  const setMessagesUnread = useTabBadgeStore((state) => state.setMessagesUnread);

  // 依赖主题色的动态样式，colors 变化时重新计算
  const d = useMemo(() => {
    // 名字 16/500、预览 14/常规：两行拉开主次，列表不再一片发重。
    const preview = {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: "400" as const,
      flex: 1,
      marginRight: Spacing.sm,
    };
    const time = {
      color: colors.textSecondary,
      ...Typography.small,
    };
    return {
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
        fontSize: 16,
        fontWeight: "500" as const,
        flex: 1,
        marginRight: Spacing.sm,
      },
      preview,
      time,
      // 置顶行铺了浅灰 pinnedSurface，次要文字换成置顶专用色保证对比度（深色主题两者相同）。
      pinnedPreview: { ...preview, color: colors.pinnedTextSecondary },
      pinnedTime: { ...time, color: colors.pinnedTextSecondary },
      draftPrefix: { color: colors.error },
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
      // 所有置顶行使用同一底色；浅色主题用微信风格的浅灰与普通会话区分。
      pinnedSurface: {
        backgroundColor: colors.pinnedSurface,
      },
      separatorLine: { backgroundColor: colors.divider },
    };
  }, [colors]);

  // 筛选标签列表 = 固定标签 + 用户自定义群组（动态追加）
  // 会话和有效备注都未变化时，沿用同一列表项引用。
  // 配合 memo 化的 ConversationRow，新消息到达时只有变化的那几行重渲染，而非整列表。
  const convMapCacheRef = useRef<
    WeakMap<object, { mapped: ReturnType<typeof mapChatConversationToUI>; name: string | undefined }>
  >(new WeakMap());
  const liveMappedConversations = useMemo(() => {
    const cache = convMapCacheRef.current;
    return rawConversations.reduce<ReturnType<typeof mapChatConversationToUI>[]>(
      (items, raw) => {
        const remark = raw.type === 'DIRECT' && raw.peer ? friendRemarks[raw.peer.id] : undefined;
        const name = remark ? remark.remark ?? remark.fallbackName : undefined;
        const cached = cache.get(raw);
        let mapped = cached?.mapped;
        if (!mapped || cached?.name !== name) {
          mapped = mapChatConversationToUI(raw);
          if (name !== undefined) mapped = { ...mapped, name };
          cache.set(raw, { mapped, name });
        }
        // AI 小助手是独立入口，不混入普通消息列表或消息 tab 未读口径。
        if (!mapped.isAssistant) items.push(mapped);
        return items;
      },
      [],
    );
  }, [friendRemarks, rawConversations]);
  const { conversations: rawMappedConversations, snapshotKnown: cachedListKnown } =
    useConversationListSnapshot(liveMappedConversations, conversationsSnapshotLoaded);

  // 最新一条发送失败的会话 id 集合,拼成排序串让引用比较退化成值比较:
  // 只在失败集合真变了才触发下游 useMemo,消息洪泛不抖动列表。选择器按会话缓存判定,
  // 每次 store 写入只重扫消息数组真换了的会话。
  const failedConversationKey = useStoreWhileActive(
    useChatStore,
    selectFailedConversationKey,
    isLive,
  );

  // 输入框草稿(按账号持久化,见 chat-core/composer-drafts)。正开着的那个会话不显示:
  // 桌面分栏下人正在右边打字,左边跟着闪「[草稿]」没有意义。
  // 在聊天页里打字会逐字写草稿;压在下面的本页没必要跟着每个按键重渲染。
  const selectComposerDrafts = useCallback(
    (state: ReturnType<typeof useComposerDraftStore.getState>) =>
      currentUserID ? state.draftsByUser[currentUserID] : undefined,
    [currentUserID],
  );
  const composerDrafts = useStoreWhileActive(
    useComposerDraftStore,
    selectComposerDrafts,
    isLive,
  );
  const activeConversationId = useChatStore(
    (state) => state.activeConversationId,
  );

  // 会话预览的失败标记:最新那条没发出去时前缀提示,不然列表页只看得到文案,
  // 用户不知道刚发的那条其实没出去。判据见 hasFailedLatestMessage ——
  // 「会话里存在失败消息」是不行的,前缀会贴到一条明明发成功的消息上。
  // 草稿优先于失败标记(微信同款):人回到列表最该看到的是自己还有话没发完。
  const conversations = useMemo(() => {
    const hasDrafts = composerDrafts && Object.keys(composerDrafts).length > 0;
    if (!failedConversationKey && !hasDrafts) return rawMappedConversations;
    const failedIds = new Set(
      failedConversationKey ? failedConversationKey.split('\n') : [],
    );
    const prefix = t('im.preview.sendFailedPrefix', {
      defaultValue: '[发送失败]',
    });
    return rawMappedConversations.map((conversation) => {
      const draft =
        conversation.id === activeConversationId
          ? undefined
          : composerDrafts?.[conversation.id];
      if (draft) {
        return { ...conversation, draftPreview: draftPreviewText(draft) };
      }
      return failedIds.has(conversation.id)
        ? { ...conversation, message: `${prefix} ${conversation.message}` }
        : conversation;
    });
  }, [
    activeConversationId,
    composerDrafts,
    failedConversationKey,
    rawMappedConversations,
    t,
  ]);

  useEffect(() => {
    setMessagesUnread(totalUnread);
  }, [setMessagesUnread, totalUnread]);

  // Filter 列表 = 基础 4 项 + 用户设置了 pinnedToTabs 的自定义分组，
  // 再应用用户保存的统一顺序（固定项和自定义项可以互相穿插）。
  // 自定义分组的 id 形如 "custom:<uuid>"，避免和 base id 冲突；filter 逻辑里特判前缀。
  const filterItems = useMemo(() => {
    const customTabs = conversationGroups
      .filter((g) => g.pinnedToTabs)
      .map((g) => ({ id: `custom:${g.id}`, label: g.name }));
    return orderMessageFilters([...BASE_FILTERS, ...customTabs], filterOrder);
  }, [BASE_FILTERS, conversationGroups, filterOrder]);

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

  const selectedConversations = useMemo(
    () => visibleConversations.filter((conversation) => selectedConversationIds?.has(conversation.id)),
    [selectedConversationIds, visibleConversations],
  );
  const allSelected = visibleConversations.length > 0 && selectedConversations.length === visibleConversations.length;
  const handleToggleAll = useCallback(() => {
    if (batchDeleteInFlightRef.current) return;
    setSelectedConversationIds(allSelected ? new Set() : new Set(visibleConversations.map((conversation) => conversation.id)));
  }, [allSelected, visibleConversations]);

  const visiblePinnedCount = useMemo(
    () => visibleConversations.filter((conversation) => conversation.pinned).length,
    [visibleConversations],
  );

  // 折叠开关只在「置顶数真的超过阈值」时存在，且和展开与否无关 ——
  // 判据里掺进 showAllPinned 的话，一展开开关就跟着消失，再也收不回去。
  const pinnedFoldEnabled =
    pinnedFoldCount > 0 && visiblePinnedCount > pinnedFoldCount;

  const collapsedPinnedCount =
    pinnedFoldEnabled && !showAllPinned ? visiblePinnedCount - pinnedFoldCount : 0;

  const displayedConversations = useMemo(() => {
    if (selecting || !pinnedFoldEnabled || showAllPinned) return visibleConversations;
    let visiblePinned = 0;
    return visibleConversations.filter((conversation) => {
      if (!conversation.pinned) return true;
      visiblePinned += 1;
      return visiblePinned <= pinnedFoldCount;
    });
  }, [pinnedFoldCount, pinnedFoldEnabled, selecting, showAllPinned, visibleConversations]);

  // 箭头嵌在第 pinnedFoldCount 条置顶会话的右下角，收起/展开都不挪窝。
  const pinnedFoldAnchorIndex = useMemo(() => {
    if (!pinnedFoldEnabled) return -1;
    let seenPinned = 0;
    for (let i = 0; i < displayedConversations.length; i += 1) {
      if (!displayedConversations[i].pinned) continue;
      seenPinned += 1;
      if (seenPinned === pinnedFoldCount) return i;
    }
    return -1;
  }, [displayedConversations, pinnedFoldCount, pinnedFoldEnabled]);

  const handleTogglePinnedFold = useCallback(
    () => setShowAllPinned((previous) => !previous),
    [],
  );

  useEffect(() => {
    setShowAllPinned(false);
  }, [activeFilterId, pinnedFoldCount]);

  // 桌面网页版（宽视口）分栏状态：右栏当前内嵌的会话。窄窗/原生恒为 null。
  const isSplitLayout = useDesktopSplitLayout();
  const listPaneWidth = useSplitPaneStore((state) => state.listPaneWidth);
  const [embeddedChat, setEmbeddedChat] = useState<EmbeddedChatParams | null>(
    null,
  );

  // 点击会话行 → 进入聊天详情页（立即跳转，不等服务端 mark-read / refresh）
  const handleConversationPress = useCallback(
    (conversation: Conversation) => {
      // Fire-and-forget：本地未读立即归零 + socket 上报已读水位（末条 height），
      // 不阻塞导航；详情页有自己的拉取逻辑。
      const dto = useChatStore
        .getState()
        .conversations.find((c) => c.id === conversation.id);
      const currentUserID = useChatStore.getState().currentUserId;
      // 入口参数必须保存“点击前”的最高已读水位。会话 DTO 可能还是旧快照，
      // 但本机已读回执已经写进内存（或上一轮冷启动从本地恢复）；只取 DTO
      // 会把这些已读消息重新判成未读，下一次进会话时又出现在未读起点之前。
      const localReadHeight =
        currentUserID && dto
          ? (useChatStore.getState().readWatermarks[dto.id]?.[currentUserID] ?? 0)
          : 0;
      const initialReadHeight = Math.max(
        dto?.readHeight ?? 0,
        localReadHeight,
      );
      markConversationRead(conversation.id, dto?.lastMessage?.height ?? 0);

      const detailParams: EmbeddedChatParams = {
        conversationID: conversation.id,
        sourceID: conversation.sourceID,
        title: conversation.name,
        conversationType: conversation.conversationType,
        conversationKind: dto?.type.toLowerCase() as
          | EmbeddedChatParams["conversationKind"],
        ...(conversation.isAssistant ? { assistantKey: 'windnote-assistant' } : {}),
        avatarUrl: conversation.avatarUrl,
        ...(conversation.unreadCount > 0
          ? { initialUnreadCount: String(conversation.unreadCount) }
          : {}),
        ...(Number.isSafeInteger(initialReadHeight) && initialReadHeight >= 0
          ? { initialReadHeight: String(initialReadHeight) }
          : {}),
      };

      // 分栏模式：右栏内嵌详情，不做路由跳转（窄窗仍走原页栈，行为不变）。
      if (isSplitLayout) {
        setEmbeddedChat(detailParams);
        return;
      }

      router.push({
        pathname: "/(tabs)/messages/chat-detail",
        params: detailParams,
      });
    },
    [isSplitLayout, router],
  );

  const handleOpenUserProfile = useCallback(
    (conversation: Conversation) => {
      router.navigate(
        getUserProfileHref("messages", conversation.sourceID, conversation.name),
      );
    },
    [router],
  );

  const updateConversationPreference = useCallback(
    async (
      conversation: Conversation,
      preference: { pinned: boolean } | { muted: boolean },
    ) => {
      if (preferenceWriteInFlightRef.current.has(conversation.id)) return;
      preferenceWriteInFlightRef.current.add(conversation.id);
      try {
        await updateChatConversationPreferences(conversation.id, preference);
      } catch (err) {
        reportHandledFailure("messages", "swipePreferenceUpdate", err);
        Alert.alert(
          t("messages.swipeActionFailed", { defaultValue: "操作失败" }),
          getApiErrorMessage(err, t("common.networkError")),
        );
      } finally {
        preferenceWriteInFlightRef.current.delete(conversation.id);
      }
    },
    [t],
  );

  const handleToggleConversationPinned = useCallback(
    (conversation: Conversation) => {
      void updateConversationPreference(conversation, {
        pinned: !conversation.pinned,
      });
    },
    [updateConversationPreference],
  );

  const handleToggleConversationMuted = useCallback(
    (conversation: Conversation) => {
      void updateConversationPreference(conversation, {
        muted: !conversation.muted,
      });
    },
    [updateConversationPreference],
  );

  const canClearGroupForEveryone = useCallback(
    (conversation: Conversation) => {
      // 临时房仍沿用原有清空语义;只有持久 GROUP 会话需要群主授权。
      if (conversation.conversationType !== 'group' || conversation.isTempChat) {
        return true;
      }
      // 点删除时才读 store:依赖整张会话数组的话,这个回调每来一条消息就换引用,
      // 经 onDelete 传给每一行,行的 memo 全部失效。
      const raw = useChatStore
        .getState()
        .conversations.find((item) => item.id === conversation.id);
      // myRole 是服务端按当前用户实时计算的角色;ownerId 兜底兼容旧会话 DTO。
      return raw?.myRole === 'OWNER' || raw?.ownerId === currentUserID;
    },
    [currentUserID],
  );

  const handleConfirmDeleteConversation = useCallback(
    (conversation: Conversation) => {
      const deleteConversation = (deleteForEveryone: boolean) => {
        void (async () => {
          try {
            await clearChatConversationHistory(conversation.id, {
              forEveryone: deleteForEveryone,
            });
            await updateChatConversationPreferences(conversation.id, {
              hidden: true,
            });
            setEmbeddedChat((current) =>
              current?.conversationID === conversation.id ? null : current,
            );
          } catch (err) {
            reportHandledFailure("messages", "swipeDelete", err);
            Alert.alert(
              t("messages.deleteChat"),
              getApiErrorMessage(err, t("common.networkError")),
            );
          }
        })();
      };

      Alert.alert(
        t("messages.deleteChat"),
        conversation.conversationType === "private"
          ? t("messages.deleteChatConfirmDirect", {
              name: conversation.name,
              // Fast Refresh 不一定重建已初始化的 i18next resource bundle；
              // 新增词条还没进当前内存时也不能把裸 key 展示给用户。
              defaultValue:
                "删除「{{name}}」的聊天记录？只删除你这边的记录，对方的不受影响。",
            })
          : t("messages.deleteChatConfirm", { name: conversation.name }),
        conversation.conversationType === "group"
          ? [
              { text: t("common.cancel"), style: "cancel" as const },
              {
                text: t("chat.clearHistoryForMe", { defaultValue: "仅删除我的记录" }),
                onPress: () => deleteConversation(false),
              },
              ...(canClearGroupForEveryone(conversation)
                ? [
                    {
                      text: t("chat.clearHistoryForEveryone", { defaultValue: "删除所有人的记录" }),
                      style: "destructive" as const,
                      onPress: () => deleteConversation(true),
                    },
                  ]
                : []),
            ]
          : [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("common.delete"),
            style: "destructive",
            // 私聊左滑只删自己这边;要清对方的记录走聊天信息页的「双向清空」申请,对方同意才清。
            onPress: () => deleteConversation(false),
          },
        ],
      );
    },
    [canClearGroupForEveryone, t],
  );

  // 点击搜索图标 → 跳转搜索页
  const handleOpenFind = useCallback(() => {
    router.push("/(tabs)/messages/find");
  }, [router]);

  const handleFilterPress = useCallback(
    (index: number) => {
      if (batchDeleteInFlightRef.current) return;
      const filter = filterItems[index];
      if (!filter) return;
      setActiveFilterId(filter.id);
      setSelectedConversationIds((current) => current ? new Set() : null);
    },
    [filterItems],
  );

  const handleOpenGroups = useCallback(() => {
    router.push("/(tabs)/messages/groups");
  }, [router]);

  const handleMarkConversationRead = useCallback((conversation: Conversation) => {
    const latest = useChatStore.getState().conversations.find((item) => item.id === conversation.id);
    markConversationRead(conversation.id, latest?.lastMessage?.height ?? 0);
  }, []);

  const handleMarkSelectedRead = useCallback(() => {
    if (batchDeleteInFlightRef.current || useChatStore.getState().currentUserId !== currentUserID) return;
    selectedConversations.forEach(handleMarkConversationRead);
    setSelectedConversationIds(null);
  }, [currentUserID, handleMarkConversationRead, selectedConversations]);

  const handleDeleteSelected = useCallback(() => {
    if (!currentUserID || selectedConversations.length === 0 || batchDeleteInFlightRef.current) return;
    const ids = selectedConversations.map((conversation) => conversation.id);
    const sameUser = () => mountedRef.current && useChatStore.getState().currentUserId === currentUserID;
    const deleteSelected = async () => {
      if (batchDeleteInFlightRef.current || !sameUser()) return;
      batchDeleteInFlightRef.current = true;
      setBatchDeleting(true);
      const failed: string[] = [];
      try {
        // ponytail: sequential writes bound load; use limited concurrency if large selections become slow.
        for (const id of ids) {
          if (!sameUser()) return;
          try {
            await clearChatConversationHistory(id, { forEveryone: false });
            if (!sameUser()) return;
            await updateChatConversationPreferences(id, { hidden: true });
            if (!sameUser()) return;
            setEmbeddedChat((current) => current?.conversationID === id ? null : current);
          } catch (error) {
            if (!sameUser()) return;
            failed.push(id);
            reportHandledFailure('messages', 'batchDelete', error);
          }
        }
        setSelectedConversationIds(failed.length ? new Set(failed) : null);
        if (failed.length) Alert.alert(t('messages.batchDeleteFailedTitle'), t('messages.batchDeleteFailedMessage', { count: failed.length }));
      } finally {
        batchDeleteInFlightRef.current = false;
        if (mountedRef.current) setBatchDeleting(false);
      }
    };
    Alert.alert(t('messages.deleteChat'), t('messages.batchDeleteConfirm', { count: ids.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void deleteSelected() },
    ]);
  }, [currentUserID, selectedConversations, t]);

  // 菜单项点击处理：关闭菜单并按 id 路由跳转
  const handleMenuAction = useCallback(
    (id: MenuActionId) => {
      setMenuVisible(false);
      // 独立群聊(微信群):好友多选建群,不必先建圈子。圈子群仍由建圈自动派生。
      if (id === "newGroup") router.push("/(tabs)/messages/new-group");
      else if (id === "addFriend") router.push("/(tabs)/messages/add-friend");
      else if (id === "seatManagement") router.push("/(tabs)/messages/temp-chats");
      else if (id === "scan") router.push("/(tabs)/messages/scan" as Href);
    },
    [router],
  );

  // 置顶分组的形状只随置顶/筛选/折叠变化;新消息只会挪动非置顶行。用签名串当依赖,
  // renderItem 与分隔线才不会每来一条消息都换引用(换了 FlatList 会把可见行全过一遍)。
  const pinnedLayoutKey = useMemo(
    () => pinnedLayoutKeyOf(displayedConversations),
    [displayedConversations],
  );
  const pinnedLayout = useMemo(
    () => parsePinnedLayoutKey(pinnedLayoutKey),
    [pinnedLayoutKey],
  );

  // 单条会话行渲染：头像（私聊可点击进主页）+ 名称/预览/时间/未读数
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Conversation>) => (
      <ConversationRow
        item={item}
        testID={E2E_TEST_IDS.messagesConversation(item.id)}
        labels={swipeLabels}
        rowBackgroundColor={
          isSplitLayout && embeddedChat?.conversationID === item.id
            ? colors.primaryLight
            : colors.background
        }
        nameStyle={d.name}
        timeStyle={d.time}
        previewStyle={d.preview}
        pinnedSurfaceStyle={d.pinnedSurface}
        pinnedTimeStyle={d.pinnedTime}
        pinnedPreviewStyle={d.pinnedPreview}
        draftPrefixStyle={d.draftPrefix}
        onOpenConversation={handleConversationPress}
        onOpenUserProfile={handleOpenUserProfile}
        onTogglePinned={handleToggleConversationPinned}
        onToggleMuted={handleToggleConversationMuted}
        onMarkRead={handleMarkConversationRead}
        onDelete={handleConfirmDeleteConversation}
        pinnedFoldExpanded={
          index === pinnedFoldAnchorIndex ? showAllPinned : undefined
        }
        pinnedFoldHiddenCount={
          index === pinnedFoldAnchorIndex ? collapsedPinnedCount : undefined
        }
        onTogglePinnedFold={
          !selecting && index === pinnedFoldAnchorIndex ? handleTogglePinnedFold : undefined
        }
        swipeEnabled={!isSplitLayout && !selecting}
        selectionMode={selecting}
        selected={selectedConversationIds?.has(item.id) ?? false}
        selectionBusy={batchDeleting}
        onToggleSelection={handleToggleSelection}
      />
    ),
    [
      collapsedPinnedCount,
      batchDeleting,
      colors.background,
      colors.primaryLight,
      d,
      embeddedChat?.conversationID,
      handleConfirmDeleteConversation,
      handleConversationPress,
      handleMarkConversationRead,
      handleToggleConversationMuted,
      handleToggleConversationPinned,
      handleOpenUserProfile,
      handleTogglePinnedFold,
      handleToggleSelection,
      isSplitLayout,
      pinnedFoldAnchorIndex,
      showAllPinned,
      selecting,
      selectedConversationIds,
      swipeLabels,
    ],
  );

  const renderSeparator = useCallback(
    ({
      leadingItem,
    }: {
      leadingItem?: Conversation;
    }) =>
      leadingItem && pinnedLayout.hiddenSeparatorIds.has(leadingItem.id) ? null : (
        <View
          style={[
            s.rowSeparator,
            leadingItem && pinnedLayout.pinnedSeparatorIds.has(leadingItem.id) ? d.pinnedSurface : null,
          ]}
        >
          <View style={[s.rowSeparatorLine, d.separatorLine]} />
        </View>
      ),
    [d, pinnedLayout],
  );
  const keyExtractor = useCallback((item: Conversation) => item.id, []);

  // 列表 Header：标题行（含操作按钮）+ 筛选 Tab 栏
  const ListHeader = useMemo(() => (
    <View style={[s.headerSection, selecting && s.selectionHeaderSection, { backgroundColor: colors.background }]}>
      {selecting ? <View style={s.selectionTopRow}>
        <Pressable
          style={[s.selectionHeaderAction, batchDeleting && s.selectionActionDisabled]}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
          disabled={batchDeleting}
          onPress={handleExitSelection}
        >
          <Text style={[s.selectionHeaderLabel, { color: colors.text }]}>{t('common.cancel')}</Text>
        </Pressable>
        <View style={s.selectionHeading}>
          <Text style={[s.selectionTitle, { color: colors.text }]}>{t('messages.selectChats')}</Text>
          <Text style={[s.selectionCount, { color: colors.textSecondary }]}>{t('messages.selectedCount', { count: selectedConversations.length })}</Text>
        </View>
        <Pressable
          style={[s.selectionHeaderAction, s.selectionHeaderActionEnd, (batchDeleting || visibleConversations.length === 0) && s.selectionActionDisabled]}
          accessibilityRole="button"
          accessibilityLabel={t(allSelected ? 'messages.deselectAll' : 'messages.selectAll')}
          disabled={batchDeleting || visibleConversations.length === 0}
          onPress={handleToggleAll}
        >
          <Text style={[s.selectionHeaderLabel, { color: colors.link }]}>{t(allSelected ? 'messages.deselectAll' : 'messages.selectAll')}</Text>
        </Pressable>
      </View> : <View style={s.titleRow}>
        <Text style={d.title}>{t('messages.title')}</Text>
        <View style={s.actionRow}>
          <Pressable style={s.actionButton} accessibilityRole="button" accessibilityLabel={t('messages.selectChats')} hitSlop={10} onPress={handleStartSelection}>
            <CheckCheck size={22} strokeWidth={4} absoluteStrokeWidth color={colors.text} />
          </Pressable>
          {/* 搜索按钮：跳转到统一搜索页（会话 + 联系人） */}
          <Pressable style={s.actionButton} accessibilityRole="button" accessibilityLabel={t('common.search')} hitSlop={10} onPress={handleOpenFind}>
            <Search size={24} strokeWidth={4} color={colors.text} />
          </Pressable>
          {/* 「+」按钮：展开快捷操作菜单 */}
          <Pressable
            style={s.actionButton}
            accessibilityRole="button"
            accessibilityLabel={t('common.add')}
            accessibilityState={{ expanded: quickAddExpanded }}
            hitSlop={10}
            onPress={handleOpenMenu}
          >
            <Animated.View pointerEvents="none" style={[s.quickAddIcon, { transform: [{ rotate: quickAddProgress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) }] }]}>
              <View style={[s.quickAddStroke, { backgroundColor: colors.text }]} />
              <View style={[s.quickAddStroke, { backgroundColor: colors.text, transform: [{ rotate: '90deg' }] }]} />
            </Animated.View>
          </Pressable>
        </View>
      </View>}
      <View style={s.filterRow}>
        <View style={s.filterTabsSlot}>
          <FilterTabs
            tabs={filterItems.map((item) => item.label)}
            activeIndex={activeTab}
            onTabPress={handleFilterPress}
            scrollable
            compact
          />
        </View>
        {!selecting ? <Pressable
          style={[s.addGroupButton, { backgroundColor: colors.background }]}
          onPress={handleOpenGroups}
          accessibilityRole="button"
          accessibilityLabel={t('messages.groups.title', { defaultValue: '自定义分组' })}
          hitSlop={6}
        >
          <Text style={[s.addGroupIcon, { color: colors.textSecondary }]}>＋</Text>
        </Pressable> : null}
      </View>
      <ChatConnectionBanner />
    </View>
  ), [
    activeTab,
    allSelected,
    batchDeleting,
    colors,
    d,
    filterItems,
    handleFilterPress,
    handleOpenFind,
    handleOpenGroups,
    handleOpenMenu,
    handleStartSelection,
    handleExitSelection,
    handleToggleAll,
    selectedConversations.length,
    selecting,
    quickAddExpanded,
    quickAddProgress,
    visibleConversations.length,
    t,
  ]);

  const listPane = (
    <View
      testID={E2E_TEST_IDS.messagesScreen}
      style={[d.container, { paddingTop: insets.top }]}
    >
      {selecting ? <View style={{ paddingHorizontal: Spacing.lg }}>{ListHeader}</View> : null}
      <FlatList
        testID={E2E_TEST_IDS.messagesList}
        data={displayedConversations}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={renderSeparator}
        ListHeaderComponent={selecting ? null : ListHeader}
        ListEmptyComponent={
          !conversationsSnapshotLoaded && !cachedListKnown && !connectionError && conversations.length === 0 ? (
            <ActivityIndicator testID="conversations-loading" accessibilityLabel={t('common.loading')} color={colors.primary} />
          ) : <Text style={d.emptyText}>
            {connectionError
              ? t('messages.loadFailed')
              : t('messages.noConversations')}
          </Text>
        }
        contentContainerStyle={[s.listContent, selecting && { paddingBottom: Spacing.md }]}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={handleRefreshConversations}
        // 默认窗口是 21 屏,100 个会话基本全部挂着;收窄到和笔记/聊天列表同一档。
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={11}
      />

      {selecting ? <View style={[s.selectionFooter, {
        backgroundColor: colors.background,
        borderTopColor: colors.divider,
        paddingBottom: insets.bottom + Spacing.md,
      }]}>
        <View style={s.selectionFooterRow}>
          <Pressable
            style={({ pressed }) => [s.selectionActionButton, { backgroundColor: colors.primaryDeep, opacity: pressed ? 0.8 : 1 }, (batchDeleting || selectedConversations.length === 0) && s.selectionActionDisabled]}
            accessibilityRole="button"
            accessibilityLabel={t('messages.swipeMarkRead')}
            disabled={batchDeleting || selectedConversations.length === 0}
            onPress={handleMarkSelectedRead}
          >
            <Ionicons name="checkmark-done-outline" size={21} color={colors.white} />
            <Text style={[s.selectionActionLabel, { color: colors.white }]}>{t('messages.swipeMarkRead')}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.selectionActionButton, { backgroundColor: colors.dangerFill, opacity: pressed ? 0.8 : 1 }, selectedConversations.length === 0 && s.selectionActionDisabled]}
            accessibilityRole="button"
            accessibilityLabel={t('messages.swipeDelete')}
            accessibilityState={{ busy: batchDeleting }}
            disabled={batchDeleting || selectedConversations.length === 0}
            onPress={handleDeleteSelected}
          >
            {batchDeleting ? <ActivityIndicator size="small" color={colors.white} /> : <Ionicons name="trash-outline" size={20} color={colors.white} />}
            <Text style={[s.selectionActionLabel, { color: colors.white }]}>{t('messages.swipeDelete')}</Text>
          </Pressable>
        </View>
      </View> : null}

      {/* 右上角「+」弹出菜单（Modal 实现，点击蒙层关闭） */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseMenu}
      >
        <Pressable style={s.overlay} onPress={handleCloseMenu}>
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

  if (!isSplitLayout) {
    return listPane;
  }

  // 桌面网页版分栏：左栏放会话列表（宽度用户可拖），右栏内嵌聊天详情。
  // key 用会话 ID：切换会话时详情整树重挂，各会话内部状态互不串扰。
  return (
    <View style={s.splitRoot}>
      <View style={[s.splitListPane, { width: listPaneWidth }]}>{listPane}</View>
      <SplitPaneResizer paneWidth={listPaneWidth} />
      <View style={s.splitDetailPane}>
        {embeddedChat ? (
          <ChatDetailScreen
            key={embeddedChat.conversationID}
            embedded={embeddedChat}
          />
        ) : (
          <View style={s.splitEmptyPane}>
            <Ionicons
              name="chatbubbles-outline"
              size={44}
              color={colors.textSecondary}
            />
            <Text style={[s.splitEmptyText, { color: colors.textSecondary }]}>
              {t("messages.desktopEmptyDetail", {
                defaultValue: "选择一个会话开始聊天",
              })}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
