import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography } from '@/theme';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';

export default function ChatInfoScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [pinChat, setPinChat] = useState(false);
  const [muteNotifications, setMuteNotifications] = useState(false);
  const [blacklist, setBlacklist] = useState(false);
  const handlePin = useCallback((v: boolean) => setPinChat(v), []);
  const handleMute = useCallback((v: boolean) => setMuteNotifications(v), []);
  const handleBlacklist = useCallback((v: boolean) => setBlacklist(v), []);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    membersRow: { flexDirection: 'row', paddingVertical: Spacing.md, paddingLeft: Spacing.lg, gap: Spacing.md },
    memberItem: { alignItems: 'center', width: 56 },
    memberAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    memberEmoji: { fontSize: 18 },
    memberName: { ...Typography.tinyRegular, color: colors.textSecondary, textAlign: 'center', marginTop: Spacing.xs, width: 56 },
    addBtn: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
    section: { backgroundColor: colors.surface, paddingHorizontal: Spacing.lg, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider },
    spacer: { height: Spacing.md },
  }), [colors]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <NavHeader title="聊天信息" />
      <ScrollView style={styles.scroll}>
        {/* Members */}
        <View style={styles.membersRow}>
          <View style={styles.memberItem}>
            <View style={styles.memberAvatar}>
              <Text style={styles.memberEmoji}>👤</Text>
            </View>
            <Text numberOfLines={1} style={styles.memberName}>上海 深圳玄...</Text>
          </View>
          <View style={styles.memberItem}>
            <Pressable style={styles.addBtn}>
              <Ionicons name="add" size={24} color={colors.textSecondary} />
            </Pressable>
            <Text style={styles.memberName}>创建群聊</Text>
          </View>
        </View>
        {/* Settings Group 1 */}
        <View style={styles.section}>
          <MenuRow icon="search" label="查找聊天记录" />
          <Divider />
          <MenuRow icon="create-outline" label="设置备注" />
          <Divider />
          <MenuRow icon="pricetag-outline" label="标签" />
          <Divider />
          <MenuRow icon="image-outline" label="聊天背景" rightText="未设置" />
          <Divider />
          <MenuRow icon="arrow-up-circle-outline" label="置顶聊天" hasToggle toggleValue={pinChat} onToggle={handlePin} showArrow={false} />
          <Divider />
          <MenuRow icon="notifications-off-outline" label="消息免打扰" hasToggle toggleValue={muteNotifications} onToggle={handleMute} showArrow={false} />
          <Divider />
          <MenuRow icon="flame-outline" label="好友消息自毁" rightText="关闭" showArrow={false} />
        </View>
        <View style={styles.spacer} />
        {/* Actions Group 2 */}
        <View style={styles.section}>
          <MenuRow icon="person-add-outline" label="把他推荐给朋友" />
          <Divider />
          <MenuRow icon="ban-outline" label="加入黑名单" hasToggle toggleValue={blacklist} onToggle={handleBlacklist} showArrow={false} />
          <Divider />
          <MenuRow icon="trash-outline" label="清空聊天记录" />
          <Divider />
          <MenuRow icon="remove-circle-outline" label="扣除信用值" destructive />
          <Divider />
          <MenuRow icon="warning-outline" label="投诉举报" />
        </View>
        <View style={{ height: insets.bottom + Spacing.xl }} />
      </ScrollView>
    </View>
  );
}
