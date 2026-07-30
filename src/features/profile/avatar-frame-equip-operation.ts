import type { AuthSessionIdentity } from '@/stores/auth-session-identity';

type EquipOperation = {
  sessionEpoch: number;
  userId: string;
  sequence: number;
};

let nextSequence = 0;
let latestOperation: EquipOperation | null = null;
let equipQueue: Promise<void> | null = null;

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

export function isLatestAvatarFrameEquip(operation: EquipOperation): boolean {
  return (
    latestOperation?.sessionEpoch === operation.sessionEpoch &&
    latestOperation.userId === operation.userId &&
    latestOperation.sequence === operation.sequence
  );
}

export function serializeAvatarFrameEquip<T>(
  task: () => Promise<T>,
): Promise<T> {
  let result: Promise<T>;
  if (equipQueue) {
    result = equipQueue.then(task, task);
  } else {
    try {
      result = task();
    } catch (error) {
      result = Promise.reject(error);
    }
  }
  const queueTail = result.then(
    () => undefined,
    () => undefined,
  );
  equipQueue = queueTail;
  void queueTail.then(() => {
    if (equipQueue === queueTail) {
      equipQueue = null;
    }
  });
  return result;
}
