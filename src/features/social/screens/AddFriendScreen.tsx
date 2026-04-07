import { useCallback, useMemo } from 'react';
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

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: { gap: Spacing.xl, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
  searchInput: { height: 48, borderWidth: 1, borderRadius: Radius.xxl, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, gap: Spacing.sm },
  searchText: { flex: 1, ...Typography.bodyRegular },
  myId: { textAlign: 'center', ...Typography.caption },
  methodRow: { height: 60, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  methodInfo: { flex: 1 },
  methodTitle: { ...Typography.body },
  methodSub: { ...Typography.small, marginTop: 2 },
  qrSection: { borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.md },
  qrTitle: { ...Typography.body, fontWeight: '600' as const },
  qrBox: { width: 160, height: 160, borderRadius: Radius.md },
  qrHint: { ...Typography.small },
});

export default function AddFriendScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const d = useMemo(() => ({
    container: { flex: 1, backgroundColor: colors.background },
    searchInput: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
    searchText: { color: colors.text },
    myId: { color: colors.textSecondary },
    methodTitle: { color: colors.text },
    methodSub: { color: colors.textSecondary },
    qrSection: { backgroundColor: colors.surface },
    qrTitle: { color: colors.text },
    qrBox: { backgroundColor: colors.white },
    qrHint: { color: colors.textSecondary },
  }), [colors]);

  const renderMethod = useCallback((method: AddMethod, index: number) => (
    <View key={method.title}>
      {index > 0 && <Divider />}
      <Pressable style={s.methodRow}>
        <IconCircle name={method.icon} size={40} iconSize={20} bgColor={method.color} />
        <View style={s.methodInfo}>
          <Text style={[s.methodTitle, d.methodTitle]}>{method.title}</Text>
          <Text style={[s.methodSub, d.methodSub]}>{method.subtitle}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  ), [d, colors]);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="添加好友" />
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={[s.searchInput, d.searchInput]}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput placeholder="输入手机号/ID" placeholderTextColor={colors.textSecondary} style={[s.searchText, d.searchText]} />
        </View>
        <Text style={[s.myId, d.myId]}>我的ID: SocialChat_2024</Text>
        <View>{METHODS.map(renderMethod)}</View>
        <View style={[s.qrSection, d.qrSection]}>
          <Text style={[s.qrTitle, d.qrTitle]}>我的二维码</Text>
          <View style={[s.qrBox, d.qrBox]} />
          <Text style={[s.qrHint, d.qrHint]}>扫一扫上面的二维码添加我</Text>
        </View>
      </ScrollView>
    </View>
  );
}
