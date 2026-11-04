import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { AuthInput } from '@/components/ui/auth-input';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import {
  SECURITY_ANSWER_MAX_LENGTH,
  type SecurityQuestionKey,
} from '@/features/auth/security-questions';

interface SecurityQuestionSlotProps {
  index: number;
  questionKey: SecurityQuestionKey | null;
  answer: string;
  onPickQuestion: (index: number) => void;
  onChangeAnswer: (index: number, answer: string) => void;
}

const s = StyleSheet.create({
  slot: { gap: Spacing.sm },
  label: { ...Typography.caption },
  picker: {
    minHeight: 52,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  pickerText: { ...Typography.body, flex: 1 },
});

/** 一道密保：选问题 + 填答案。 */
export function SecurityQuestionSlot({
  index,
  questionKey,
  answer,
  onPickQuestion,
  onChangeAnswer,
}: SecurityQuestionSlotProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const d = useMemo(
    () => ({
      label: { color: colors.textSecondary },
      picker: { backgroundColor: colors.surface },
      chosen: { color: colors.text },
      placeholder: { color: colors.textSecondary },
    }),
    [colors],
  );
  return (
    <View style={s.slot}>
      <Text style={[s.label, d.label]}>
        {t('securityQuestions.slotLabel', { number: index + 1 })}
      </Text>
      <Pressable
        testID={`security-question-picker-${index}`}
        accessibilityRole="button"
        style={[s.picker, d.picker]}
        onPress={() => onPickQuestion(index)}
      >
        <Text style={[s.pickerText, questionKey ? d.chosen : d.placeholder]}>
          {questionKey
            ? t(`securityQuestions.questions.${questionKey}`)
            : t('securityQuestions.pickQuestion')}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>
      <AuthInput
        testID={`security-question-answer-${index}`}
        placeholder={t('securityQuestions.answerPlaceholder')}
        value={answer}
        onChangeText={(next) =>
          onChangeAnswer(index, next.slice(0, SECURITY_ANSWER_MAX_LENGTH))
        }
        autoComplete="off"
      />
    </View>
  );
}
