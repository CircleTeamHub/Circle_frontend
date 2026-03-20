import React, { useCallback, useMemo } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { IconCircle } from '@/components/ui/icon-circle';

interface AddMethod {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  subtitle: string;
}

const METHODS: AddMethod[] = [
  { icon: 'scan-outline', color: '#22C55E', title: '扫一扫', subtitle: '扫描二维码添加好友' },
  { icon: 'call-outline', color: '#6366F1', title: '手机联系人', subtitle: '从通讯录导入好友' },
  { icon: 'radio-outline', color: '#FF6B6B', title: '雷达加友', subtitle: '搜索附近的人' },
  { icon: 'share-outline', color: '#8B5CF6', title: '面对面建群', subtitle: '与身边的朋友建群' },
];

export default function AddFriendScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    content: { gap: Spacing.xl, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
    searchInput: { height: 48, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, borderRadius: Radius.xxl, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, gap: Spacing.sm },
    searchText: { flex: 1, ...Typography.bodyRegular, color: colors.text },
    myId: { textAlign: 'center', color: colors.textSecondary, ...Typography.caption },
    methodRow: { height: 60, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    methodInfo: { flex: 1 },
    methodTitle: { color: colors.text, ...Typography.body },
    methodSub: { color: colors.textSecondary, ...Typography.small, marginTop: 2 },
    qrSection: { backgroundColor: colors.surface, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.md },
    qrTitle: { color: colors.text, ...Typography.body, fontWeight: '600' },
    qrBox: { width: 160, height: 160, backgroundColor: colors.white, borderRadius: Radius.md },
    qrHint: { color: colors.textSecondary, ...Typography.small },
  }), [colors]);

  const renderMethod = useCallback((method: AddMethod, index: number) => (
    <View key={method.title}>
      {index > 0 && <Divider />}
      <Pressable style={styles.methodRow}>
        <IconCircle name={method.icon} size={40} iconSize={20} bgColor={method.color} />
        <View style={styles.methodInfo}>
          <Text style={styles.methodTitle}>{method.title}</Text>
          <Text style={styles.methodSub}>{method.subtitle}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  ), [styles, colors]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <NavHeader title="添加好友" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.searchInput}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput placeholder="输入手机号/ID" placeholderTextColor={colors.textSecondary} style={styles.searchText} />
        </View>
        <Text style={styles.myId}>我的ID: SocialChat_2024</Text>
        <View>{METHODS.map(renderMethod)}</View>
        <View style={styles.qrSection}>
          <Text style={styles.qrTitle}>我的二维码</Text>
          <View style={styles.qrBox} />
          <Text style={styles.qrHint}>扫一扫上面的二维码添加我</Text>
        </View>
      </ScrollView>
    </View>
  );
}
