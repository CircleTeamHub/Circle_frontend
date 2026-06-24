import { useMemo } from 'react';
import { Typography, useTheme } from '@/theme';

/**
 * Theme-derived (dynamic) styles for the onboarding profile flow. Kept separate
 * from the static StyleSheet so the screen and the city picker share one source
 * of truth for colors / typography and the screen body stays focused on layout.
 */
export function useOnboardingStyles() {
  const { colors } = useTheme();

  return useMemo(
    () => ({
      page: {
        backgroundColor: colors.background,
      },
      title: {
        color: colors.text,
        ...Typography.h1,
      },
      subtitle: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      label: {
        color: colors.text,
      },
      input: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
        color: colors.text,
        ...Typography.bodyRegular,
      },
      selectInput: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      selectText: {
        color: colors.text,
        ...Typography.bodyRegular,
      },
      selectPlaceholder: {
        color: colors.textSecondary,
      },
      avatarButton: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      avatarButtonText: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      optionChip: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      optionChipActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
      },
      optionText: {
        color: colors.text,
        ...Typography.small,
        fontWeight: '600' as const,
      },
      optionTextActive: {
        color: colors.white,
      },
      button: {
        backgroundColor: colors.primary,
      },
      buttonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '700' as const,
      },
      modalBackdrop: {
        backgroundColor: colors.overlay,
      },
      modalCard: {
        backgroundColor: colors.background,
      },
      modalTitle: {
        color: colors.text,
        ...Typography.h3,
      },
      pickerList: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      pickerItemText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      pickerItemTextActive: {
        color: colors.primary,
        fontWeight: '700' as const,
      },
      actionText: {
        color: colors.primary,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );
}

export type OnboardingStyles = ReturnType<typeof useOnboardingStyles>;
