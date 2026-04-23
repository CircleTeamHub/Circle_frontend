import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import {
  fetchCircleDetail,
  updateCircle,
} from '@/services/api/circles';
import { useCreateCircleFormStore } from '@/features/discover/store/use-create-circle-form-store';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import type { CircleDetail } from '@/types';

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
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function EditCircleScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const selectedCities = useCreateCircleFormStore((state) => state.selectedCities);
  const setSelectedCities = useCreateCircleFormStore((state) => state.setSelectedCities);
  const resetCreateCircleForm = useCreateCircleFormStore((state) => state.reset);
  const fetchMyCircles = useCirclesStore((state) => state.fetchMyCircles);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [circle, setCircle] = useState<CircleDetail | null>(null);
  const [name, setName] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [customCategoryInput, setCustomCategoryInput] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [pickedAvatarUri, setPickedAvatarUri] = useState<string | null>(null);
  const [rules, setRules] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [joinVipRestriction, setJoinVipRestriction] = useState<number | null>(null);
  const [joinCreditRestriction, setJoinCreditRestriction] = useState<number | null>(null);
  const [joinFancyRestriction, setJoinFancyRestriction] = useState(false);
  const [memberCanPost, setMemberCanPost] = useState(true);

  useEffect(() => () => resetCreateCircleForm(), [resetCreateCircleForm]);

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
      avatarHint: { color: colors.textSecondary },
    }),
    [colors],
  );

  const PRESET_CATEGORIES = PRESET_CATEGORY_KEYS.map((key) => ({
    label: t(`circle.categories.${key}`),
    value: key,
  }));

  const VIP_OPTIONS = VIP_OPTIONS_VALUES.map((value) => ({
    label: value === null ? t('common.noRestriction') : t(`vipOptions.vip${value}`),
    value,
  }));

  const CREDIT_OPTIONS = CREDIT_OPTIONS_VALUES.map((value) => ({
    label: value === null ? t('common.noRestriction') : t(`creditOptions.above${value}`),
    value,
  }));

  const loadCircle = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchCircleDetail(id);
      if (data.myRole !== 'OWNER' && data.myRole !== 'ADMIN') {
        Alert.alert(t('circle.error'), t('circle.loadError'));
        router.back();
        return;
      }

      setCircle(data);
      setName(data.name);
      setSelectedCategories(data.categories);
      setDescription(data.description);
      setAvatarUri(data.avatarUrl);
      setPickedAvatarUri(null);
      setRules(data.rules);
      setTags(data.tags);
      setJoinVipRestriction(data.joinVipRestriction);
      setJoinCreditRestriction(data.joinCreditRestriction);
      setJoinFancyRestriction(data.joinFancyRestriction);
      setMemberCanPost(data.memberCanPost);
      setSelectedCities(data.cities);
    } catch {
      Alert.alert(t('circle.error'), t('circle.loadError'));
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, setSelectedCities, t]);

  useEffect(() => {
    void loadCircle();
  }, [loadCircle]);

  const canSubmit = !loading && name.trim().length >= 2 && description.trim().length >= 10;

  const toggleCategory = (value: string) => {
    setSelectedCategories((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value],
    );
  };

  const handleAddCustomCategory = () => {
    const value = customCategoryInput.trim();
    if (!value || selectedCategories.includes(value)) return;
    setSelectedCategories((prev) => [...prev, value]);
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
      setPickedAvatarUri(result.assets[0].uri);
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
    setTags((prev) => [...prev, tag]);
    setTagInput('');
  };

  const handleRemoveTag = (index: number) => {
    setTags((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  };

  const cycleVip = useCallback(() => {
    setJoinVipRestriction((prev) => {
      const index = VIP_OPTIONS_VALUES.indexOf(prev as null | 1 | 2 | 3 | 5);
      return VIP_OPTIONS_VALUES[(index + 1) % VIP_OPTIONS_VALUES.length] ?? null;
    });
  }, []);

  const cycleCredit = useCallback(() => {
    setJoinCreditRestriction((prev) => {
      const index = CREDIT_OPTIONS_VALUES.indexOf(prev as null | 60 | 70 | 80 | 90);
      return CREDIT_OPTIONS_VALUES[(index + 1) % CREDIT_OPTIONS_VALUES.length] ?? null;
    });
  }, []);

  const vipLabel =
    VIP_OPTIONS.find((option) => option.value === joinVipRestriction)?.label ??
    t('common.noRestriction');
  const creditLabel =
    CREDIT_OPTIONS.find((option) => option.value === joinCreditRestriction)?.label ??
    t('common.noRestriction');

  const handleSubmit = async () => {
    if (!id || !circle || !canSubmit || submitting) return;

    setSubmitting(true);
    try {
      let uploadedAvatarUrl = avatarUri ?? undefined;
      if (pickedAvatarUri) {
        try {
          const fileName = pickedAvatarUri.split('/').pop() ?? 'avatar.jpg';
          const contentType =
            resolveUploadContentType({ fileName }) ?? 'image/jpeg';
          const presign = await requestUploadPresign({
            filename: sanitizeUploadFilename(fileName),
            contentType,
            folder: 'avatars',
          });
          await uploadLocalFileToPresignedUrl(
            presign.uploadUrl,
            contentType,
            pickedAvatarUri,
          );
          uploadedAvatarUrl = presign.fileUrl;
        } catch {
          // Avatar upload failed — keep previous avatar instead of blocking the full edit flow.
          uploadedAvatarUrl = circle.avatarUrl ?? undefined;
        }
      }

      await updateCircle(id, {
        name: name.trim(),
        categories: selectedCategories,
        description: description.trim(),
        avatarUrl: uploadedAvatarUrl,
        cities: selectedCities.length > 0 ? selectedCities : [],
        rules: rules.trim(),
        tags,
        joinVipRestriction,
        joinCreditRestriction,
        joinFancyRestriction,
        memberCanPost,
      });
      await fetchMyCircles();
      resetCreateCircleForm();
      router.back();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('common.errorOccurred');
      Alert.alert(t('circle.error'), message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title={t('circle.edit')} />
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('circle.edit')} />
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>
            {t('circle.create.basicInfo')}
          </Text>

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

          <Text
            style={[s.rowLabel, d.rowLabel, { marginBottom: Spacing.sm }]}
          >
            {t('circle.create.categoryLabel')}
          </Text>
          <View style={s.categoryRow}>
            {PRESET_CATEGORIES.map((option) => {
              const isActive = selectedCategories.includes(option.value);

              return (
                <Pressable
                  key={option.value}
                  onPress={() => toggleCategory(option.value)}
                  style={[
                    s.categoryPill,
                    {
                      backgroundColor: isActive ? colors.primary : colors.surface,
                      borderColor: isActive
                        ? colors.primary
                        : colors.surfaceBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      s.categoryText,
                      { color: isActive ? colors.white : colors.textSecondary },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
            {selectedCategories
              .filter((category) =>
                !PRESET_CATEGORIES.some((option) => option.value === category),
              )
              .map((category) => (
                <Pressable
                  key={category}
                  onPress={() => toggleCategory(category)}
                  style={[
                    s.categoryPill,
                    {
                      backgroundColor: colors.primary,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <Text style={[s.categoryText, { color: colors.white }]}>
                    {category}
                  </Text>
                </Pressable>
              ))}
          </View>

          <View style={s.tagInputRow}>
            <TextInput
              placeholder={t('circle.create.customCategoryPlaceholder')}
              placeholderTextColor={colors.textSecondary}
              value={customCategoryInput}
              onChangeText={setCustomCategoryInput}
              onSubmitEditing={handleAddCustomCategory}
              maxLength={10}
              style={[
                s.tagInput,
                {
                  borderColor: colors.surfaceBorder,
                  color: colors.text,
                  backgroundColor: colors.surface,
                },
              ]}
            />
            <Pressable
              onPress={handleAddCustomCategory}
              style={[s.addTagBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: colors.white, ...Typography.caption }}>
                {t('common.add')}
              </Text>
            </Pressable>
          </View>

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

        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>
            {t('circle.create.settingsSection')}
          </Text>

          <Text
            style={[s.rowLabel, d.rowLabel, { marginBottom: Spacing.sm }]}
          >
            {t('circle.create.avatarLabel')}
          </Text>
          <View style={s.avatarRow}>
            <Pressable onPress={handlePickAvatar}>
              {avatarUri ? (
                <Image
                  source={{ uri: avatarUri }}
                  style={s.avatarImage}
                  contentFit="cover"
                />
              ) : (
                <View
                  style={[
                    s.avatarPlaceholder,
                    { borderColor: colors.surfaceBorder },
                  ]}
                >
                  <Ionicons
                    name="camera-outline"
                    size={28}
                    color={colors.textSecondary}
                  />
                </View>
              )}
            </Pressable>
            <Text style={[s.avatarHint, d.avatarHint]}>
              {t('circle.create.avatarHint')}
            </Text>
          </View>

          <MenuRow
            icon="location-outline"
            label={t('circle.create.cityLabel')}
            rightText={
              selectedCities.length > 0
                ? t('circle.create.selectedCities', {
                    count: selectedCities.length,
                  })
                : t('circle.create.allCities')
            }
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
                  <Text
                    style={{ color: colors.primary, ...Typography.caption }}
                  >
                    {city}
                  </Text>
                  <Ionicons name="close" size={12} color={colors.primary} />
                </Pressable>
              ))}
            </View>
          ) : null}
          <Divider />

          <Text
            style={[
              s.rowLabel,
              d.rowLabel,
              { marginTop: Spacing.md, marginBottom: Spacing.sm },
            ]}
          >
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

          <Text
            style={[s.rowLabel, d.rowLabel, { marginBottom: Spacing.sm }]}
          >
            {t('circle.create.tagsLabel')}
          </Text>
          <View style={s.tagRow}>
            {tags.map((tag, index) => (
              <Pressable
                key={tag}
                onPress={() => handleRemoveTag(index)}
                style={[s.tagChip, { backgroundColor: colors.primaryLight }]}
              >
                <Text style={{ color: colors.primary, ...Typography.caption }}>
                  #{tag}
                </Text>
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
                style={[
                  s.tagInput,
                  {
                    borderColor: colors.surfaceBorder,
                    color: colors.text,
                    backgroundColor: colors.surface,
                  },
                ]}
              />
              <Pressable
                onPress={handleAddTag}
                style={[s.addTagBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={{ color: colors.white, ...Typography.caption }}>
                  {t('common.add')}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>
            {t('circle.create.restrictionsSection')}
          </Text>

          <MenuRow
            icon="diamond-outline"
            label={t('circle.joinVipRestriction')}
            rightText={vipLabel}
            onPress={cycleVip}
          />
          <Divider />
          <MenuRow
            icon="shield-checkmark-outline"
            label={t('circle.joinCreditRestriction')}
            rightText={creditLabel}
            onPress={cycleCredit}
          />
          <Divider />
          <View style={s.toggleRow}>
            <Text style={[s.rowLabel, d.rowLabel]}>
              {t('circle.create.fancyLabel')}
            </Text>
            <Switch
              value={joinFancyRestriction}
              onValueChange={setJoinFancyRestriction}
              trackColor={{ false: colors.surfaceBorder, true: colors.primary }}
              thumbColor={colors.white}
            />
          </View>
          <Divider />
          <View style={s.toggleRow}>
            <Text style={[s.rowLabel, d.rowLabel]}>
              {t('circle.create.memberPostLabel')}
            </Text>
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
          <Text
            style={{
              color: colors.textSecondary,
              ...Typography.caption,
              textAlign: 'center',
              marginBottom: Spacing.sm,
            }}
          >
            {name.trim().length < 2
              ? t('circle.create.nameRequired')
              : t('circle.create.descRequired')}
          </Text>
        ) : null}
        <Pressable
          style={[
            s.submitBtn,
            canSubmit && !submitting ? d.submitBtn : d.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit || submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={[s.submitText, d.submitText]}>{t('common.save')}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
