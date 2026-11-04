/**
 * 密保问题：陌生设备登录时受信任设备都不在身边的兜底验证。
 *
 * key 与后端 circle_be/src/auth/security-questions.service.ts 的
 * SECURITY_QUESTION_KEYS 逐项镜像（test/security-questions-contract.test.js 守住），
 * 文案在 i18n `securityQuestions.questions.<key>`。
 */
export const SECURITY_QUESTION_KEYS = [
  'bestFriendName',
  'primarySchool',
  'firstTeacher',
  'childhoodNickname',
  'birthCity',
  'firstPetName',
  'motherName',
  'fatherName',
] as const;

export type SecurityQuestionKey = (typeof SECURITY_QUESTION_KEYS)[number];

/** 每个账号设置的密保问题数量。 */
export const SECURITY_QUESTION_COUNT = 2;
export const SECURITY_ANSWER_MAX_LENGTH = 64;

export function isSecurityQuestionKey(value: unknown): value is SecurityQuestionKey {
  return (SECURITY_QUESTION_KEYS as readonly unknown[]).includes(value);
}
