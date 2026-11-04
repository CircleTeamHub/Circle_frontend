import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { AuthInput } from '@/components/ui/auth-input';
import { NavHeader } from '@/components/ui/nav-header';
import { OptionPickerSheet } from '@/components/ui/option-picker-sheet';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { SecurityQuestionSlot } from '@/features/profile/components/SecurityQuestionSlot';
import {
  SECURITY_QUESTION_KEYS,
  type SecurityQuestionKey,
} from '@/features/auth/security-questions';
import { fetchSecurityQuestions, setSecurityQuestions } from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';
import { reportHandledFailure } from '@/observability/report-failure';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type Slot = { questionKey: SecurityQuestionKey | null; answer: string };

const EMPTY_SLOTS: readonly Slot[] = [
  { questionKey: null, answer: '' },
  { questionKey: null, answer: '' },
];

const s = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: Spacing.lg, gap: Spacing.lg },
  form: { gap: Spacing.lg },
  helper: { ...Typography.caption, lineHeight: 20 },
  error: { ...Typography.caption },
  footer: { marginTop: 'auto', paddingBottom: Spacing.lg },
  button: {
    height: 52,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { ...Typography.body, fontWeight: '600' },
});

/** 账号与安全 → 密保问题：选两道题并填写答案，替换原有设置需要当前密码。 */
export default function SecurityQuestionsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [slots, setSlots] = useState<readonly Slot[]>(EMPTY_SLOTS);
  const [alreadySet, setAlreadySet] = useState(false);
  const [password, setPassword] = useState('');
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  // 用户动过表单之后，晚到的状态不再覆盖已填的内容。
  const editedRef = useRef(false);

  const d = useMemo(
    () => ({
      page: { flex: 1, backgroundColor: colors.background, paddingTop: insets.top },
      content: { paddingBottom: insets.bottom + Spacing.lg },
      helper: { color: colors.textSecondary },
      error: { color: colors.error },
      button: { backgroundColor: colors.primary },
      buttonText: { color: colors.white },
    }),
    [colors, insets.bottom, insets.top],
  );

  // 已设置过就预选原来的问题（答案不回显，要重新填）。
  useEffect(() => {
    let cancelled = false;
    fetchSecurityQuestions().then(
      (keys) => {
        if (cancelled || keys.length === 0) return;
        setAlreadySet(true);
        if (!editedRef.current) {
          setSlots(keys.map((questionKey) => ({ questionKey, answer: '' })));
        }
      },
      (requestError: unknown) => {
        reportHandledFailure('securityQuestions', 'statusCheck', requestError);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const pickerOptions = useMemo(() => {
    const taken = slots
      .filter((_, index) => index !== pickingSlot)
      .map((slot) => slot.questionKey);
    return SECURITY_QUESTION_KEYS.filter((key) => !taken.includes(key)).map(
      (key) => ({ label: t(`securityQuestions.questions.${key}`), value: key }),
    );
  }, [pickingSlot, slots, t]);

  const updateSlot = (index: number, patch: Partial<Slot>) => {
    editedRef.current = true;
    setSlots((current) =>
      current.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)),
    );
  };

  async function handleSave() {
    if (inFlightRef.current) return;
    setError(null);
    const questions = slots.flatMap(({ questionKey, answer }) =>
      questionKey && answer.trim() ? [{ questionKey, answer: answer.trim() }] : [],
    );
    if (questions.length !== slots.length) {
      setError(t('securityQuestions.incomplete'));
      return;
    }
    if (!password) {
      setError(t('profile.currentPasswordPlaceholder'));
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    try {
      await setSecurityQuestions({ password, questions });
      router.back();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('securityQuestions.saveFailed')));
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingContainer style={d.page}>
      <NavHeader title={t('securityQuestions.title')} />
      <ScrollView
        contentContainerStyle={[s.container, d.content]}
        {...keyboardDismissOnDragProps}
      >
        <View style={s.form}>
          <Text style={[s.helper, d.helper]}>
            {t(alreadySet ? 'securityQuestions.introReplace' : 'securityQuestions.intro')}
          </Text>
          {slots.map((slot, index) => (
            <SecurityQuestionSlot
              key={index}
              index={index}
              questionKey={slot.questionKey}
              answer={slot.answer}
              onPickQuestion={setPickingSlot}
              onChangeAnswer={(i, answer) => updateSlot(i, { answer })}
            />
          ))}
          <AuthInput
            testID="security-questions-password"
            label={t('profile.currentPassword')}
            placeholder={t('profile.currentPasswordPlaceholder')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <Text style={[s.helper, d.helper]}>
            {t('securityQuestions.answerHint')}
          </Text>
          {error ? <Text style={[s.error, d.error]}>{error}</Text> : null}
        </View>

        <View style={s.footer}>
          <Pressable
            testID="security-questions-save"
            style={[s.button, d.button, submitting ? s.buttonDisabled : null]}
            onPress={handleSave}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={[s.buttonText, d.buttonText]}>
                {t('common.save')}
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>

      <OptionPickerSheet<SecurityQuestionKey | null>
        visible={pickingSlot !== null}
        title={t('securityQuestions.pickQuestion')}
        options={pickerOptions}
        selectedValue={pickingSlot !== null ? (slots[pickingSlot]?.questionKey ?? null) : null}
        onSelect={(questionKey) => {
          if (pickingSlot !== null) updateSlot(pickingSlot, { questionKey });
          setPickingSlot(null);
        }}
        onClose={() => setPickingSlot(null)}
      />
    </KeyboardAvoidingContainer>
  );
}
