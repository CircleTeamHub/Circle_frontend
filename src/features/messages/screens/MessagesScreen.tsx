import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  Modal,
  StyleSheet,
  ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { SearchBar } from '@/components/ui/search-bar';
import { FilterTabs } from '@/components/ui/filter-tabs';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Divider } from '@/components/ui/divider';
import type { Conversation } from '@/types';

const FILTER_TABS = ['全部', '未读', '群聊', '私聊'];

const MENU_ACTIONS: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}[] = [
  { icon: 'people-outline', label: '新建群聊' },
  { icon: 'person-add-outline', label: '添加好友' },
  { icon: 'scan-outline', label: '扫一扫' },
  { icon: 'card-outline', label: '收付款' },
];

const MOCK_CONVERSATIONS: Conversation[] = [
  { id: '1', name: '陈思琪', message: '嘿！今晚还是一起吃饭吗？', time: '下午 3:34', unreadCount: 3 },
  { id: '2', name: '张明远', message: '昨日文件已经上传了 :)', time: '下午 1:15', unreadCount: 0 },
  { id: '3', name: '李晓婷', message: '你觉得这个设计怎么样？', time: '中午 12:02', unreadCount: 1 },
  { id: '4', name: '王浩然', message: '好的，健身房见！', time: '上午 11:20', unreadCount: 0 },
  { id: '5', name: '刘雨欣', message: '会议改到下午3点了', time: '上午 10:45', unreadCount: 5 },
  { id: '6', name: '赵天宇', message: '哈哈太搞笑了', time: '昨天', unreadCount: 0 },
  { id: '7', name: '林美琪', message: '有空的时候帮我打个电话', time: '昨天', unreadCount: 0 },
  { id: '8', name: '周子涵', message: '周末一起去爬山吗？', time: '昨天', unreadCount: 2 },
  { id: '9', name: '吴佳怡', message: '收到，我马上处理', time: '周三', unreadCount: 0 },
  { id: '10', name: '孙伟', message: '项目进展如何？', time: '周三', unreadCount: 0 },
  { id: '11', name: '郑小雨', message: '生日快乐！', time: '周二', unreadCount: 0 },
  { id: '12', name: '黄丽华', message: '明天的会议记得参加', time: '周二', unreadCount: 1 },
  { id: '13', name: '何志强', message: '文档已经发到你邮箱了', time: '周一', unreadCount: 0 },
  { id: '14', name: '罗敏', message: '好的没问题', time: '周一', unreadCount: 0 },
  { id: '15', name: '谢欣然', message: '[图片]', time: '上周', unreadCount: 0 },
];

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState(0);
  const [menuVisible, setMenuVisible] = useState(false);

  const styles = useMemo(() => StyleSheet.create({
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
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    title: {
      color: colors.text,
      ...Typography.title,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.md,
    },
    rowContent: {
      flex: 1,
      gap: Spacing.xs,
    },
    rowTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    rowBottom: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    name: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
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
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
    },
    menu: {
      position: 'absolute',
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      paddingVertical: Spacing.sm,
      minWidth: 160,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
    },
    menuLabel: {
      color: colors.text,
      ...Typography.body,
    },
  }), [colors]);

  const handleConversationPress = useCallback(() => {
    router.push('/chat-detail');
  }, [router]);

  const handleMenuAction = useCallback(
    (label: string) => {
      setMenuVisible(false);
      if (label === '添加好友') router.push('/add-friend');
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Conversation>) => (
      <Pressable style={styles.row} onPress={handleConversationPress}>
        <Avatar size={40} name={item.name} uri={item.avatarUrl} />
        <View style={styles.rowContent}>
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
        </View>
      </Pressable>
    ),
    [handleConversationPress, styles],
  );

  const renderSeparator = useCallback(() => <Divider />, []);
  const keyExtractor = useCallback((item: Conversation) => item.id, []);

  const ListHeader = (
    <View style={styles.headerSection}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>消息</Text>
        <Pressable onPress={() => setMenuVisible(true)}>
          <Ionicons name="add-circle-outline" size={24} color={colors.text} />
        </Pressable>
      </View>
      <SearchBar placeholder="搜索对话..." />
      <FilterTabs
        tabs={FILTER_TABS}
        activeIndex={activeTab}
        onTabPress={setActiveTab}
      />
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <FlatList
        data={MOCK_CONVERSATIONS}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={renderSeparator}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* Dropdown menu */}
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
