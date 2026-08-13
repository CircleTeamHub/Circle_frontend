import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { OptionPickerSheet } from '@/components/ui/option-picker-sheet';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useCreateCircleFormStore } from '@/features/discover/store/use-create-circle-form-store';
import {
  CIRCLE_CREDIT_OPTIONS_VALUES,
  CIRCLE_PRESET_CATEGORY_KEYS,
  CIRCLE_VIP_OPTIONS_VALUES,
} from '@/features/discover/constants/circle-form';
import type { CircleFormApi } from '@/features/discover/hooks/use-circle-form';

interface CircleFormBodyProps {
  form: CircleFormApi;
}

const s = StyleSheet.create({
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
    // Fixed-height single-line input: zero vertical padding + center alignment
    // so the text/placeholder sits in the middle (Android defaults to top).
    paddingVertical: 0,
    textAlignVertical: 'center' as const,
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
  gateHint: { ...Typography.caption, marginBottom: Spacing.sm },
  // 允许换行:窄屏 + 长语言(西语的「需要几人验证」比中文长得多)+ SQL 手改
  // 出的第四个档位一起出现时,不换行的定宽行会把最后一个 chip 挤出屏幕。
  // 标签可压缩、chip 不可压缩,压缩发生在标签上。
  verifierCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  verifierCountLabel: { flexShrink: 1 },
  verifierChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
  verifierChip: {
    minWidth: 48,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
  },
});

// 入圈验证的三档担保票数。1 = 关闭(成员邀请即进),是宣传期的默认形态。
const VERIFIER_COUNT_OPTIONS = [2, 5, 10];

export const CircleFormBody: React.FC<CircleFormBodyProps> = ({ form }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();

  const selectedCities = useCreateCircleFormStore((st) => st.selectedCities);
  const setSelectedCities = useCreateCircleFormStore(
    (st) => st.setSelectedCities,
  );

  const d = useMemo(
    () => ({
      sectionTitle: { color: colors.text },
      inputBox: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      textInput: { color: colors.text },
      rowLabel: { color: colors.text },
      avatarHint: { color: colors.textSecondary },
    }),
    [colors],
  );

  const verificationGateOn = form.requiredVerifierCount > 1;
  // SQL 手改出的非 2/5/10 档位也要能显示并保持选中,保存时不被静默改掉。
  const verifierCountOptions = useMemo(
    () =>
      VERIFIER_COUNT_OPTIONS.includes(form.requiredVerifierCount) ||
      form.requiredVerifierCount <= 1
        ? VERIFIER_COUNT_OPTIONS
        : [...VERIFIER_COUNT_OPTIONS, form.requiredVerifierCount].sort(
            (a, b) => a - b,
          ),
    [form.requiredVerifierCount],
  );

  const PRESET_CATEGORIES = useMemo(
    () =>
      CIRCLE_PRESET_CATEGORY_KEYS.map((key) => ({
        label: t(`circle.categories.${key}`),
        value: key as string,
      })),
    [t],
  );

  const VIP_OPTIONS = useMemo(
    () =>
      CIRCLE_VIP_OPTIONS_VALUES.map((value) => ({
        // 语义：所选等级及以上可加入（与后端 vipLevel < restriction 拒绝一致）。
        label:
          value === null
            ? t('common.noRestriction')
            : t('circle.create.vipAtLeast', {
                level: value,
                defaultValue: `VIP ${value} 及以上`,
              }),
        value,
      })),
    [t],
  );

  // VIP/信用分限制的选择 sheet（点击行弹起，直选而非循环切换）。
  const [activeRestrictionSheet, setActiveRestrictionSheet] = useState<
    'vip' | 'credit' | null
  >(null);

  const CREDIT_OPTIONS = useMemo(
    () =>
      CIRCLE_CREDIT_OPTIONS_VALUES.map((value) => ({
        label:
          value === null
            ? t('common.noRestriction')
            : t(`creditOptions.above${value}`),
        value,
      })),
    [t],
  );

  const vipLabel =
    VIP_OPTIONS.find((option) => option.value === form.joinVipRestriction)
      ?.label ?? t('common.noRestriction');
  const creditLabel =
    CREDIT_OPTIONS.find((option) => option.value === form.joinCreditRestriction)
      ?.label ?? t('common.noRestriction');

  const handleSelectCities = useCallback(() => {
    router.push({
      pathname: '/(tabs)/discover/select-city',
      params: { multiSelect: 'true' },
    });
  }, [router]);

  const handleRemoveCity = useCallback(
    (city: string) => {
      setSelectedCities(selectedCities.filter((value) => value !== city));
    },
    [selectedCities, setSelectedCities],
  );

  return (
    <>
      {/* ── 基本信息 ── */}
      <View style={s.section}>
        <Text style={[s.sectionTitle, d.sectionTitle]}>
          {t('circle.create.basicInfo')}
        </Text>

        <View style={[s.inputBox, d.inputBox]}>
          <TextInput
            placeholder={t('circle.create.namePlaceholder')}
            placeholderTextColor={colors.textSecondary}
            value={form.name}
            onChangeText={form.setName}
            maxLength={20}
            style={[s.textInput, d.textInput]}
          />
        </View>

        <Text style={[s.rowLabel, d.rowLabel, { marginBottom: Spacing.sm }]}>
          {t('circle.create.categoryLabel')}
        </Text>
        <View style={s.categoryRow}>
          {PRESET_CATEGORIES.map((option) => {
            const isActive = form.selectedCategories.includes(option.value);
            return (
              <Pressable
                key={option.value}
                onPress={() => form.toggleCategory(option.value)}
                style={[
                  s.categoryPill,
                  {
                    backgroundColor: isActive
                      ? colors.primary
                      : colors.surface,
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
          {form.selectedCategories
            .filter(
              (category) =>
                !PRESET_CATEGORIES.some(
                  (option) => option.value === category,
                ),
            )
            .map((category) => (
              <Pressable
                key={category}
                onPress={() => form.toggleCategory(category)}
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
            value={form.customCategoryInput}
            onChangeText={form.setCustomCategoryInput}
            onSubmitEditing={form.handleAddCustomCategory}
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
            onPress={form.handleAddCustomCategory}
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
            value={form.description}
            onChangeText={form.setDescription}
            maxLength={500}
            style={[s.multilineInput, d.textInput]}
          />
        </View>
      </View>

      {/* ── 设定 ── */}
      <View style={s.section}>
        <Text style={[s.sectionTitle, d.sectionTitle]}>
          {t('circle.create.settingsSection')}
        </Text>

        <Text style={[s.rowLabel, d.rowLabel, { marginBottom: Spacing.sm }]}>
          {t('circle.create.avatarLabel')}
        </Text>
        <View style={s.avatarRow}>
          <Pressable onPress={form.handlePickAvatar}>
            {form.avatarUri ? (
              <Image
                source={{ uri: form.avatarUri }}
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
              ? t('circle.create.selectedCities', { count: selectedCities.length })
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
                style={[s.cityChip, { backgroundColor: colors.primary }]}
              >
                <Text style={{ color: colors.white, ...Typography.caption }}>
                  {city}
                </Text>
                <Ionicons name="close" size={12} color={colors.white} />
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
            value={form.rules}
            onChangeText={form.setRules}
            maxLength={1000}
            style={[s.multilineInput, d.textInput]}
          />
        </View>

      </View>

      {/* ── 权限与限制 ── */}
      <View style={s.section}>
        <Text style={[s.sectionTitle, d.sectionTitle]}>
          {t('circle.create.restrictionsSection')}
        </Text>

        <MenuRow
          icon="diamond-outline"
          label={t('circle.joinVipRestriction')}
          rightText={vipLabel}
          onPress={() => setActiveRestrictionSheet('vip')}
        />
        <Divider />
        <MenuRow
          icon="shield-checkmark-outline"
          label={t('circle.joinCreditRestriction')}
          rightText={creditLabel}
          onPress={() => setActiveRestrictionSheet('credit')}
        />
        <Divider />
        <View style={s.toggleRow}>
          <Text style={[s.rowLabel, d.rowLabel]}>
            {t('circle.create.fancyLabel')}
          </Text>
          <Switch
            value={form.joinFancyRestriction}
            onValueChange={form.setJoinFancyRestriction}
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
            value={form.memberCanPost}
            onValueChange={form.setMemberCanPost}
            trackColor={{ false: colors.surfaceBorder, true: colors.primary }}
            thumbColor={colors.white}
          />
        </View>
        <Divider />
        {/* 入圈验证:关 = requiredVerifierCount 1(拉人即进),开 = 2/5/10 档。 */}
        <View style={s.toggleRow}>
          <Text style={[s.rowLabel, d.rowLabel]}>
            {t('circle.create.verificationGateLabel')}
          </Text>
          <Switch
            value={verificationGateOn}
            onValueChange={(value) =>
              form.setRequiredVerifierCount(value ? 10 : 1)
            }
            trackColor={{ false: colors.surfaceBorder, true: colors.primary }}
            thumbColor={colors.white}
          />
        </View>
        {verificationGateOn ? (
          <>
            <View style={s.verifierCountRow}>
              <Text style={[s.rowLabel, s.verifierCountLabel, d.rowLabel]}>
                {t('circle.create.verifierCountLabel')}
              </Text>
              <View style={s.verifierChips}>
                {verifierCountOptions.map((count) => {
                  const selected = form.requiredVerifierCount === count;
                  return (
                    <Pressable
                      key={count}
                      onPress={() => form.setRequiredVerifierCount(count)}
                      style={[
                        s.verifierChip,
                        {
                          backgroundColor: selected
                            ? colors.primary
                            : colors.surface,
                          borderColor: selected
                            ? colors.primary
                            : colors.surfaceBorder,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: selected ? colors.white : colors.text,
                          ...Typography.bodyRegular,
                        }}
                      >
                        {count}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <Text style={[s.gateHint, { color: colors.textSecondary }]}>
              {t('circle.create.verificationGateOnHint', {
                count: form.requiredVerifierCount,
              })}
            </Text>
          </>
        ) : (
          <Text style={[s.gateHint, { color: colors.textSecondary }]}>
            {t('circle.create.verificationGateOffHint')}
          </Text>
        )}
      </View>

      {/* VIP / 信用分限制选择 sheet（所选等级及以上可加入） */}
      <OptionPickerSheet
        visible={activeRestrictionSheet === 'vip'}
        title={t('circle.joinVipRestriction')}
        options={VIP_OPTIONS}
        selectedValue={form.joinVipRestriction}
        onSelect={form.setJoinVipRestriction}
        onClose={() => setActiveRestrictionSheet(null)}
      />
      <OptionPickerSheet
        visible={activeRestrictionSheet === 'credit'}
        title={t('circle.joinCreditRestriction')}
        options={CREDIT_OPTIONS}
        selectedValue={form.joinCreditRestriction}
        onSelect={form.setJoinCreditRestriction}
        onClose={() => setActiveRestrictionSheet(null)}
      />
    </>
  );
};
