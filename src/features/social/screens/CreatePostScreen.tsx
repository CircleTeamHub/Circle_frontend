import { useState, useCallback, useMemo } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Switch, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';

const s = StyleSheet.create({
  scroll: { flex: 1, paddingHorizontal: Spacing.lg },
  inputBox: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md },
  contentInput: { ...Typography.bodyRegular, lineHeight: 21, textAlignVertical: 'top' as const },
  inputSpacer: { height: 60 },
  photoBtn: { width: 80, height: 80, borderWidth: 1, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  photoCount: { ...Typography.small },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  rowLabel: { ...Typography.bodyRegular },
  submitWrap: { paddingTop: Spacing.md, paddingHorizontal: Spacing.lg },
  submitBtn: { borderRadius: 25, height: 50, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 16, fontWeight: '600' as const },
});

export default function CreatePostScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [content, setContent] = useState('');
  const [hornEnabled, setHornEnabled] = useState(false);
  const [fancyNumberEnabled, setFancyNumberEnabled] = useState(false);
  const handleHorn = useCallback((v: boolean) => setHornEnabled(v), []);
  const handleFancy = useCallback((v: boolean) => setFancyNumberEnabled(v), []);

  const d = useMemo(() => ({
    container: { flex: 1, backgroundColor: colors.background },
    inputBox: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
    contentInput: { color: colors.text },
    photoBtn: { backgroundColor: colors.background, borderColor: colors.surfaceBorder },
    photoCount: { color: colors.textSecondary },
    rowLabel: { color: colors.text },
    submitBtn: { backgroundColor: colors.primary },
    submitText: { color: colors.white },
  }), [colors]);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="发布动态" rightIcon="information-circle-outline" />
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={[s.inputBox, d.inputBox]}>
          <TextInput
            placeholder="请输入详细内容"
            placeholderTextColor={colors.textSecondary}
            multiline
            value={content}
            onChangeText={setContent}
            style={[s.contentInput, d.contentInput]}
          />
          <View style={s.inputSpacer} />
          <Pressable style={[s.photoBtn, d.photoBtn]}>
            <Ionicons name="add" size={24} color={colors.textSecondary} />
            <Text style={[s.photoCount, d.photoCount]}>0 / 9 张</Text>
          </Pressable>
        </View>
        <View style={s.toggleRow}>
          <Text style={[s.rowLabel, d.rowLabel]}>喇叭动态</Text>
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
        <View style={s.toggleRow}>
          <Text style={[s.rowLabel, d.rowLabel]}>需要靓号</Text>
          <Switch value={fancyNumberEnabled} onValueChange={handleFancy} trackColor={{ false: colors.surfaceBorder, true: colors.primary }} thumbColor={colors.white} />
        </View>
      </ScrollView>
      <View style={[s.submitWrap, { paddingBottom: insets.bottom || 34 }]}>
        <Pressable style={[s.submitBtn, d.submitBtn]}>
          <Text style={[s.submitText, d.submitText]}>提交</Text>
        </Pressable>
      </View>
    </View>
  );
}
