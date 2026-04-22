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
import { useTranslation } from 'react-i18next';
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

const PRESET_CATEGORY_KEYS = [
  'life', 'food', 'sports', 'social', 'gaming', 'photography', 'work', 'trade',
] as const;

const VIP_OPTIONS_VALUES = [null, 1, 2, 3, 5] as const;
const CREDIT_OPTIONS_VALUES = [null, 60, 70, 80, 90] as const;


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
  const { t } = useTranslation();
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

  const PRESET_CATEGORIES = PRESET_CATEGORY_KEYS.map((key) => ({
    label: t(`circle.categories.${key}`),
    value: key,
  }));

  const VIP_OPTIONS = VIP_OPTIONS_VALUES.map((v) => ({
    label: v === null ? t('common.noRestriction') : t(`vipOptions.vip${v}`),
    value: v,
  }));

  const CREDIT_OPTIONS = CREDIT_OPTIONS_VALUES.map((v) => ({
    label: v === null ? t('common.noRestriction') : t(`creditOptions.above${v}`),
    value: v,
  }));

  // VIP gate
  if (!user || user.vipLevel < 1) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title={t('circle.create.title')} />
        <View style={s.vipGate}>
          <Ionicons name="diamond" size={48} color={colors.warning} />
          <Text style={d.vipText}>{t('circle.create.vipRequired')}</Text>
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
      const idx = VIP_OPTIONS_VALUES.indexOf(prev as any);
      return VIP_OPTIONS_VALUES[(idx + 1) % VIP_OPTIONS_VALUES.length] ?? null;
    });
  }, []);

  const cycleCredit = useCallback(() => {
    setJoinCreditRestriction((prev) => {
      const idx = CREDIT_OPTIONS_VALUES.indexOf(prev as any);
      return CREDIT_OPTIONS_VALUES[(idx + 1) % CREDIT_OPTIONS_VALUES.length] ?? null;
    });
  }, []);

  const vipLabel = VIP_OPTIONS.find((o) => o.value === joinVipRestriction)?.label ?? t('common.noRestriction');
  const creditLabel = CREDIT_OPTIONS.find((o) => o.value === joinCreditRestriction)?.label ?? t('common.noRestriction');

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
      const message = error instanceof Error ? error.message : t('circle.create.failed');
      Alert.alert(t('circle.create.failed'), message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('circle.create.title')} />
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── 基本信息 ── */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>{t('circle.create.basicInfo')}</Text>

          {/* 圈子名称 */}
          <View style={[s.inputBox, d.inputBox]}>
            <TextInput
              placeholder={t('circle.create.namePlaceholder')}
              placeholderTextColor={colors.textSecondary}
              value={name}
              onChangeText={setName}
              maxLength={20}
              style={[s.textInput, d.textInput]}
            />
          </View>

          {/* 主题分类（多选 + 自定义） */}
          <Text style={[s.rowLabel, d.rowLabel, { marginBottom: Spacing.sm }]}>{t('circle.create.categoryLabel')}</Text>
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
              placeholder={t('circle.create.customCategoryPlaceholder')}
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
              <Text style={{ color: colors.white, ...Typography.caption }}>{t('common.add')}</Text>
            </Pressable>
          </View>

          {/* 圈子描述 */}
          <View style={[s.inputBox, d.inputBox]}>
            <TextInput
              placeholder={t('circle.create.descriptionPlaceholder')}
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
          <Text style={[s.sectionTitle, d.sectionTitle]}>{t('circle.create.settingsSection')}</Text>

          {/* 圈子头像 */}
          <Text style={[s.rowLabel, d.rowLabel, { marginBottom: Spacing.sm }]}>{t('circle.create.avatarLabel')}</Text>
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
              {t('circle.create.avatarHint')}
            </Text>
          </View>

          {/* 关联城市 */}
          <MenuRow
            icon="location-outline"
            label={t('circle.create.cityLabel')}
            rightText={selectedCities.length > 0 ? t('circle.create.selectedCities', { count: selectedCities.length }) : t('circle.create.allCities')}
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
            {t('circle.create.rulesLabel')}
          </Text>
          <View style={[s.inputBox, d.inputBox]}>
            <TextInput
              placeholder={t('circle.create.rulesPlaceholder')}
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
            {t('circle.create.tagsLabel')}
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
                placeholder={t('circle.create.tagPlaceholder')}
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
                <Text style={{ color: colors.white, ...Typography.caption }}>{t('common.add')}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* ── 权限与限制 ── */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>{t('circle.create.restrictionsSection')}</Text>

          <MenuRow icon="diamond-outline" label={t('circle.joinVipRestriction')} rightText={vipLabel} onPress={cycleVip} />
          <Divider />
          <MenuRow icon="shield-checkmark-outline" label={t('circle.joinCreditRestriction')} rightText={creditLabel} onPress={cycleCredit} />
          <Divider />
          <View style={s.toggleRow}>
            <Text style={[s.rowLabel, d.rowLabel]}>{t('circle.create.fancyLabel')}</Text>
            <Switch
              value={joinFancyRestriction}
              onValueChange={setJoinFancyRestriction}
              trackColor={{ false: colors.surfaceBorder, true: colors.primary }}
              thumbColor={colors.white}
            />
          </View>
          <Divider />
          <View style={s.toggleRow}>
            <Text style={[s.rowLabel, d.rowLabel]}>{t('circle.create.memberPostLabel')}</Text>
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
            {name.trim().length < 2 ? t('circle.create.nameRequired') : t('circle.create.descRequired')}
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
            <Text style={[s.submitText, d.submitText]}>{t('circle.create.submitButton')}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
