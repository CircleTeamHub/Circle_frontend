import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { ThemeColors } from '@/theme';

/**
 * 场地状态的三种显示：开工 / 打烊 / 下架。「下架」现在只有一种含义 = 笔记 status=UNLISTED：
 * 进主人的已下架列表、60 天后自动删除,别人照样能看到笔记,只是状态显示为下架。
 * OFF_SHELF 只剩老数据和老版本客户端还在用,服务端收到会转成 UNLISTED。
 */
export const SET_NOTE_WORK_STATUSES = ['WORKING', 'CLOSED', 'OFF_SHELF'] as const;
export type SetNoteWorkStatus = (typeof SET_NOTE_WORK_STATUSES)[number];

export function isSetNoteWorkStatus(value: unknown): value is SetNoteWorkStatus {
  return (SET_NOTE_WORK_STATUSES as readonly unknown[]).includes(value);
}

/** 显示用的场地状态：下架（status=UNLISTED，或老数据的 OFF_SHELF）压过开工/打烊。 */
export function displayedNoteWorkStatus(
  workStatus: unknown,
  status: unknown,
): SetNoteWorkStatus | null {
  if (status === 'UNLISTED' || workStatus === 'OFF_SHELF') return 'OFF_SHELF';
  return workStatus === 'WORKING' || workStatus === 'CLOSED' ? workStatus : null;
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
