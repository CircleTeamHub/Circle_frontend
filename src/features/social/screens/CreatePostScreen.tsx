import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Switch, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';

export default function CreatePostScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [content, setContent] = useState('');
  const [hornEnabled, setHornEnabled] = useState(false);
  const [fancyNumberEnabled, setFancyNumberEnabled] = useState(false);
  const handleHorn = useCallback((v: boolean) => setHornEnabled(v), []);
  const handleFancy = useCallback((v: boolean) => setFancyNumberEnabled(v), []);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1, paddingHorizontal: Spacing.lg },
    inputBox: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md },
    contentInput: { ...Typography.bodyRegular, lineHeight: 21, color: colors.text, textAlignVertical: 'top' },
    inputSpacer: { height: 60 },
    photoBtn: { width: 80, height: 80, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.surfaceBorder, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
    photoCount: { color: colors.textSecondary, ...Typography.small },
    toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
    rowLabel: { color: colors.text, ...Typography.bodyRegular },
    submitWrap: { paddingTop: Spacing.md, paddingHorizontal: Spacing.lg },
    submitBtn: { backgroundColor: colors.primary, borderRadius: 25, height: 50, alignItems: 'center', justifyContent: 'center' },
    submitText: { color: colors.white, fontSize: 16, fontWeight: '600' },
  }), [colors]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <NavHeader title="发布动态" rightIcon="information-circle-outline" />
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.inputBox}>
          <TextInput
            placeholder="请输入详细内容"
            placeholderTextColor={colors.textSecondary}
            multiline
            value={content}
            onChangeText={setContent}
            style={styles.contentInput}
          />
          <View style={styles.inputSpacer} />
          <Pressable style={styles.photoBtn}>
            <Ionicons name="add" size={24} color={colors.textSecondary} />
            <Text style={styles.photoCount}>0 / 9 张</Text>
          </Pressable>
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.rowLabel}>喇叭动态</Text>
          <Switch value={hornEnabled} onValueChange={handleHorn} trackColor={{ false: colors.surfaceBorder, true: colors.primary }} thumbColor={colors.white} />
        </View>
        <Divider />
        <MenuRow icon="globe-outline" label="🌐 选择圈子" />
        <Divider />
        <MenuRow icon="location-outline" label="📍 请选择城市" />
        <Divider />
        <MenuRow icon="document-text-outline" label="📝 选择笔记" />
        <Divider />
        <MenuRow icon="diamond-outline" label="VIP限制" rightText="不限制" />
        <Divider />
        <MenuRow icon="shield-checkmark-outline" label="信用值限制" rightText="不限制" />
        <Divider />
        <View style={styles.toggleRow}>
          <Text style={styles.rowLabel}>需要靓号</Text>
          <Switch value={fancyNumberEnabled} onValueChange={handleFancy} trackColor={{ false: colors.surfaceBorder, true: colors.primary }} thumbColor={colors.white} />
        </View>
      </ScrollView>
      <View style={[styles.submitWrap, { paddingBottom: insets.bottom || 34 }]}>
        <Pressable style={styles.submitBtn}>
          <Text style={styles.submitText}>提交</Text>
        </Pressable>
      </View>
    </View>
  );
}
