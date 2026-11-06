import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { ThemeColors } from '@/theme';

/**
 * 老板能设置的场地状态。「下架」(OFF_SHELF)和开工/打烊并列,只是一个标记,
 * 跟笔记本身的上下架(status=UNLISTED,别人看不到)没有关系。
 */
export const SET_NOTE_WORK_STATUSES = ['WORKING', 'CLOSED', 'OFF_SHELF'] as const;
export type SetNoteWorkStatus = (typeof SET_NOTE_WORK_STATUSES)[number];

export function isSetNoteWorkStatus(value: unknown): value is SetNoteWorkStatus {
  return (SET_NOTE_WORK_STATUSES as readonly unknown[]).includes(value);
}

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export const NOTE_WORK_STATUS_ICON: Record<SetNoteWorkStatus, IoniconName> = {
  WORKING: 'checkmark-circle-outline',
  CLOSED: 'moon-outline',
  OFF_SHELF: 'pause-circle-outline',
};

export function noteWorkStatusFill(status: SetNoteWorkStatus, colors: ThemeColors): string {
  switch (status) {
    case 'WORKING':
      return colors.workingFill;
    case 'CLOSED':
      return colors.closedFill;
    case 'OFF_SHELF':
      return colors.offShelfFill;
  }
}
