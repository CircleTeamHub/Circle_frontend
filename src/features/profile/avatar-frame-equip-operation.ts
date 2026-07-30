import type { AuthSessionIdentity } from '@/stores/auth-session-identity';

type EquipOperation = {
  sessionEpoch: number;
  userId: string;
  sequence: number;
};

let nextSequence = 0;
let latestOperation: EquipOperation | null = null;

export function beginAvatarFrameEquip(
  owner: AuthSessionIdentity,
): EquipOperation {
  latestOperation = {
    sessionEpoch: owner.sessionEpoch,
    userId: owner.userId,
    sequence: ++nextSequence,
  };
  return latestOperation;
}

export function isLatestAvatarFrameEquip(
  operation: EquipOperation,
): boolean {
  return (
    latestOperation?.sessionEpoch === operation.sessionEpoch &&
    latestOperation.userId === operation.userId &&
    latestOperation.sequence === operation.sequence
  );
}
