import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { createCircle } from '@/services/api/circles';
import { useCreateCircleFormStore } from '@/features/discover/store/use-create-circle-form-store';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import { useAuthStore } from '@/stores/authStore';

const PRESET_CATEGORIES: { label: string; value: string }[] = [
  { label: '生活', value: '生活' },
  { label: '美食', value: '美食' },
  { label: '运动', value: '运动' },
  { label: '交友', value: '交友' },
  { label: '游戏', value: '游戏' },
  { label: '摄影', value: '摄影' },
  { label: '职场', value: '职场' },
  { label: '二手交易', value: '二手交易' },
];

const VIP_OPTIONS = [
  { label: '不限制', value: null },
  { label: 'VIP 1', value: 1 },
  { label: 'VIP 2', value: 2 },
  { label: 'VIP 3', value: 3 },
  { label: 'VIP 5', value: 5 },
];

const CREDIT_OPTIONS = [
  { label: '不限制', value: null },
  { label: '60分以上', value: 60 },
  { label: '70分以上', value: 70 },
  { label: '80分以上', value: 80 },
  { label: '90分以上', value: 90 },
];


const s = StyleSheet.create({
  scroll: { flex: 1, paddingHorizontal: Spacing.lg },
  section: { marginTop: Spacing.lg },
  sectionTitle: { ...Typography.h3, marginBottom: Spacing.sm },
  inputBox: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  textInput: { ...Typography.bodyRegular, lineHeight: 21 },
  multilineInput: {
    ...Typography.bodyRegular,
    lineHeight: 21,
    textAlignVertical: 'top' as const,
    minHeight: 80,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  categoryPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  categoryText: { ...Typography.caption, fontWeight: '600' as const },
  customCategoryInput: {
    ...Typography.bodyRegular,
    height: 40,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 72,
    height: 72,
    borderRadius: Radius.lg,
  },
  avatarHint: {
    ...Typography.caption,
    flex: 1,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  tagInputRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  tagInput: {
    ...Typography.bodyRegular,
    flex: 1,
    height: 36,
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
  },
  addTagBtn: {
    height: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedCitiesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  cityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
  },
  rowLabel: { ...Typography.bodyRegular },
  submitWrap: { paddingTop: Spacing.md, paddingHorizontal: Spacing.lg },
  submitBtn: {
    borderRadius: 25,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { fontSize: 16, fontWeight: '600' as const },
  vipGate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
  },
});

export default function CreateCircleScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const fetchMyCircles = useCirclesStore((s) => s.fetchMyCircles);
  const selectedCities = useCreateCircleFormStore((s) => s.selectedCities);
  const setSelectedCities = useCreateCircleFormStore((s) => s.setSelectedCities);
  const resetCreateCircleForm = useCreateCircleFormStore((s) => s.reset);

  // Basic info
  const [name, setName] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [customCategoryInput, setCustomCategoryInput] = useState('');
  const [description, setDescription] = useState('');

  // Settings
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [rules, setRules] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // Restrictions
  const [joinVipRestriction, setJoinVipRestriction] = useState<number | null>(null);
  const [joinCreditRestriction, setJoinCreditRestriction] = useState<number | null>(null);
  const [joinFancyRestriction, setJoinFancyRestriction] = useState(false);
  const [memberCanPost, setMemberCanPost] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      sectionTitle: { color: colors.text },
      inputBox: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
      textInput: { color: colors.text },
      rowLabel: { color: colors.text },
      submitBtn: { backgroundColor: colors.primary },
      submitBtnDisabled: { backgroundColor: colors.surfaceBorder },
      submitText: { color: colors.white },
      vipText: { color: colors.textSecondary, ...Typography.body, textAlign: 'center' as const },
      avatarHint: { color: colors.textSecondary },
    }),
    [colors],
  );

  // VIP gate
  if (!user || user.vipLevel < 1) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title="创建圈子" />
        <View style={s.vipGate}>
          <Ionicons name="diamond" size={48} color={colors.warning} />
          <Text style={d.vipText}>需要成为VIP用户才能创建圈子</Text>
        </View>
      </View>
    );
  }

  const canSubmit = name.trim().length >= 2 && description.trim().length >= 10;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const toggleCategory = (value: string) => {
    setSelectedCategories((prev) =>
      prev.includes(value)
        ? prev.filter((c) => c !== value)
        : [...prev, value],
    );
  };

  const handleAddCustomCategory = () => {
    const val = customCategoryInput.trim();
    if (!val || selectedCategories.includes(val)) return;
    setSelectedCategories((prev) => [...prev, val]);
    setCustomCategoryInput('');
  };

  const handlePickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  const handleSelectCities = () => {
    router.push({
      pathname: '/(tabs)/discover/select-city',
      params: { multiSelect: 'true' },
    });
  };

  const handleRemoveCity = (city: string) => {
    setSelectedCities(selectedCities.filter((value) => value !== city));
  };

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (!tag || tags.length >= 3 || tags.includes(tag)) return;
    setTags([...tags, tag]);
    setTagInput('');
  };

  const handleRemoveTag = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const cycleVip = useCallback(() => {
    setJoinVipRestriction((prev) => {
      const idx = VIP_OPTIONS.findIndex((o) => o.value === prev);
      return VIP_OPTIONS[(idx + 1) % VIP_OPTIONS.length].value;
    });
  }, []);

  const cycleCredit = useCallback(() => {
    setJoinCreditRestriction((prev) => {
      const idx = CREDIT_OPTIONS.findIndex((o) => o.value === prev);
      return CREDIT_OPTIONS[(idx + 1) % CREDIT_OPTIONS.length].value;
    });
  }, []);

  const vipLabel = VIP_OPTIONS.find((o) => o.value === joinVipRestriction)?.label ?? '不限制';
  const creditLabel = CREDIT_OPTIONS.find((o) => o.value === joinCreditRestriction)?.label ?? '不限制';

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      // Upload avatar if selected (non-blocking — avatar is optional)
      let uploadedAvatarUrl: string | undefined;
      if (avatarUri) {
        try {
          const fileName = avatarUri.split('/').pop() ?? 'avatar.jpg';
          const contentType = resolveUploadContentType({ fileName }) ?? 'image/jpeg';
          const presign = await requestUploadPresign({
            filename: sanitizeUploadFilename(fileName),
            contentType,
            folder: 'avatars',
          });
          await uploadLocalFileToPresignedUrl(presign.uploadUrl, contentType, avatarUri);
          uploadedAvatarUrl = presign.fileUrl;
        } catch {
          // Avatar upload failed — proceed without avatar
        }
      }

      await createCircle({
        name: name.trim(),
        categories: selectedCategories,
        description: description.trim(),
        avatarUrl: uploadedAvatarUrl,
        cities: selectedCities.length > 0 ? selectedCities : undefined,
        rules: rules.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        joinVipRestriction,
        joinCreditRestriction,
        joinFancyRestriction: joinFancyRestriction || undefined,
        memberCanPost,
      });
      await fetchMyCircles();
      resetCreateCircleForm();
      router.back();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '创建失败，请重试';
      Alert.alert('创建失败', message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="创建圈子" />
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── 基本信息 ── */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>基本信息</Text>

          {/* 圈子名称 */}
          <View style={[s.inputBox, d.inputBox]}>
            <TextInput
              placeholder="圈子名称（2-20字）"
              placeholderTextColor={colors.textSecondary}
              value={name}
              onChangeText={setName}
              maxLength={20}
              style={[s.textInput, d.textInput]}
            />
          </View>

          {/* 主题分类（多选 + 自定义） */}
          <Text style={[s.rowLabel, d.rowLabel, { marginBottom: Spacing.sm }]}>主题分类（可多选）</Text>
          <View style={s.categoryRow}>
            {/* Preset categories */}
            {PRESET_CATEGORIES.map((opt) => {
              const isActive = selectedCategories.includes(opt.value);
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => toggleCategory(opt.value)}
                  style={[
                    s.categoryPill,
                    {
                      backgroundColor: isActive ? colors.primary : colors.surface,
                      borderColor: isActive ? colors.primary : colors.surfaceBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      s.categoryText,
                      { color: isActive ? colors.white : colors.textSecondary },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
            {/* Custom categories (user-added) */}
            {selectedCategories
              .filter((c) => !PRESET_CATEGORIES.some((p) => p.value === c))
              .map((c) => (
                <Pressable
                  key={c}
                  onPress={() => toggleCategory(c)}
                  style={[
                    s.categoryPill,
                    {
                      backgroundColor: colors.primary,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <Text style={[s.categoryText, { color: colors.white }]}>
                    {c}
                  </Text>
                </Pressable>
              ))}
          </View>

          {/* 自定义分类输入 */}
          <View style={s.tagInputRow}>
            <TextInput
              placeholder="输入自定义分类"
              placeholderTextColor={colors.textSecondary}
              value={customCategoryInput}
              onChangeText={setCustomCategoryInput}
              onSubmitEditing={handleAddCustomCategory}
              maxLength={10}
              style={[s.tagInput, { borderColor: colors.surfaceBorder, color: colors.text, backgroundColor: colors.surface }]}
            />
            <Pressable
              onPress={handleAddCustomCategory}
              style={[s.addTagBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: colors.white, ...Typography.caption }}>添加</Text>
            </Pressable>
          </View>

          {/* 圈子描述 */}
          <View style={[s.inputBox, d.inputBox]}>
            <TextInput
              placeholder="圈子描述（10-500字）"
              placeholderTextColor={colors.textSecondary}
              multiline
              value={description}
              onChangeText={setDescription}
              maxLength={500}
              style={[s.multilineInput, d.textInput]}
            />
          </View>
        </View>

        {/* ── 设定 ── */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>设定</Text>

          {/* 圈子头像 */}
          <Text style={[s.rowLabel, d.rowLabel, { marginBottom: Spacing.sm }]}>圈子头像</Text>
          <View style={s.avatarRow}>
            <Pressable onPress={handlePickAvatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={s.avatarImage} contentFit="cover" />
              ) : (
                <View style={[s.avatarPlaceholder, { borderColor: colors.surfaceBorder }]}>
                  <Ionicons name="camera-outline" size={28} color={colors.textSecondary} />
                </View>
              )}
            </Pressable>
            <Text style={[s.avatarHint, d.avatarHint]}>
              点击上传圈子头像（选填）
            </Text>
          </View>

          {/* 关联城市 */}
          <MenuRow
            icon="location-outline"
            label="关联城市"
            rightText={selectedCities.length > 0 ? `已选${selectedCities.length}个` : '全国（不限）'}
            onPress={handleSelectCities}
          />
          {selectedCities.length > 0 ? (
            <View style={s.selectedCitiesRow}>
              {selectedCities.map((city) => (
                <Pressable
                  key={city}
                  onPress={() => handleRemoveCity(city)}
                  style={[s.cityChip, { backgroundColor: colors.primaryLight }]}
                >
                  <Text style={{ color: colors.primary, ...Typography.caption }}>{city}</Text>
                  <Ionicons name="close" size={12} color={colors.primary} />
                </Pressable>
              ))}
            </View>
          ) : null}
          <Divider />

          {/* 圈子公告/规则 */}
          <Text style={[s.rowLabel, d.rowLabel, { marginTop: Spacing.md, marginBottom: Spacing.sm }]}>
            圈子公告与规则
          </Text>
          <View style={[s.inputBox, d.inputBox]}>
            <TextInput
              placeholder="在此输入圈子公告或规则（选填）"
              placeholderTextColor={colors.textSecondary}
              multiline
              value={rules}
              onChangeText={setRules}
              maxLength={1000}
              style={[s.multilineInput, d.textInput]}
            />
          </View>

          {/* 标签 */}
          <Text style={[s.rowLabel, d.rowLabel, { marginBottom: Spacing.sm }]}>
            标签（最多3个，方便搜索发现）
          </Text>
          <View style={s.tagRow}>
            {tags.map((tag, i) => (
              <Pressable
                key={tag}
                onPress={() => handleRemoveTag(i)}
                style={[s.tagChip, { backgroundColor: colors.primaryLight }]}
              >
                <Text style={{ color: colors.primary, ...Typography.caption }}>#{tag}</Text>
                <Ionicons name="close" size={12} color={colors.primary} />
              </Pressable>
            ))}
          </View>
          {tags.length < 3 ? (
            <View style={s.tagInputRow}>
              <TextInput
                placeholder="输入标签"
                placeholderTextColor={colors.textSecondary}
                value={tagInput}
                onChangeText={setTagInput}
                onSubmitEditing={handleAddTag}
                maxLength={10}
                style={[s.tagInput, { borderColor: colors.surfaceBorder, color: colors.text, backgroundColor: colors.surface }]}
              />
              <Pressable
                onPress={handleAddTag}
                style={[s.addTagBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={{ color: colors.white, ...Typography.caption }}>添加</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* ── 权限与限制 ── */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>权限与限制</Text>

          <MenuRow icon="diamond-outline" label="加入VIP限制" rightText={vipLabel} onPress={cycleVip} />
          <Divider />
          <MenuRow icon="shield-checkmark-outline" label="加入信用值限制" rightText={creditLabel} onPress={cycleCredit} />
          <Divider />
          <View style={s.toggleRow}>
            <Text style={[s.rowLabel, d.rowLabel]}>需要靓号</Text>
            <Switch
              value={joinFancyRestriction}
              onValueChange={setJoinFancyRestriction}
              trackColor={{ false: colors.surfaceBorder, true: colors.primary }}
              thumbColor={colors.white}
            />
          </View>
          <Divider />
          <View style={s.toggleRow}>
            <Text style={[s.rowLabel, d.rowLabel]}>成员可发帖</Text>
            <Switch
              value={memberCanPost}
              onValueChange={setMemberCanPost}
              trackColor={{ false: colors.surfaceBorder, true: colors.primary }}
              thumbColor={colors.white}
            />
          </View>
        </View>

        <View style={{ height: Spacing.xl }} />
      </ScrollView>

      <View style={[s.submitWrap, { paddingBottom: insets.bottom || 34 }]}>
        {!canSubmit ? (
          <Text style={{ color: colors.textSecondary, ...Typography.caption, textAlign: 'center', marginBottom: Spacing.sm }}>
            {name.trim().length < 2 ? '请填写圈子名称（至少2字）' : '请填写圈子描述（至少10字）'}
          </Text>
        ) : null}
        <Pressable
          style={[s.submitBtn, canSubmit && !submitting ? d.submitBtn : d.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit || submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={[s.submitText, d.submitText]}>创建圈子</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
