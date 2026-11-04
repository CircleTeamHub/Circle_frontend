import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AuthInput } from '@/components/ui/auth-input';
import { Spacing } from '@/theme';
import {
  SECURITY_ANSWER_MAX_LENGTH,
  type SecurityQuestionKey,
} from '@/features/auth/security-questions';

interface SecurityAnswerFieldsProps {
  questionKeys: readonly SecurityQuestionKey[];
  answers: readonly string[];
  onChangeAnswer: (index: number, answer: string) => void;
}

const s = StyleSheet.create({
  list: { gap: Spacing.md },
});

/** 按设置顺序列出密保问题，每题一个答案输入框。 */
export function SecurityAnswerFields({
  questionKeys,
  answers,
  onChangeAnswer,
}: SecurityAnswerFieldsProps) {
  const { t } = useTranslation();
  return (
    <View style={s.list}>
      {questionKeys.map((questionKey, index) => (
        <AuthInput
          key={questionKey}
          testID={`security-answer-${index}`}
          label={t(`securityQuestions.questions.${questionKey}`)}
          placeholder={t('securityQuestions.answerPlaceholder')}
          value={answers[index] ?? ''}
          onChangeText={(answer) =>
            onChangeAnswer(index, answer.slice(0, SECURITY_ANSWER_MAX_LENGTH))
          }
          autoComplete="off"
        />
      ))}
    </View>
  );
}
