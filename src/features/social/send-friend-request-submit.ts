export type FriendRequestSubmitActivity = 'idle' | 'submitting' | 'uploading';

export function createSingleFlightRunner() {
  let running = false;

  return {
    isRunning: () => running,
    run<T>(task: () => Promise<T>): Promise<T> | null {
      if (running) return null;
      running = true;
      return (async () => {
        try {
          return await task();
        } finally {
          running = false;
        }
      })();
    },
  };
}

export function getFriendRequestSubmitState({
  hasProfile,
  isSubmitting,
  isUploadingPhoto,
}: {
  hasProfile: boolean;
  isSubmitting: boolean;
  isUploadingPhoto: boolean;
}): { disabled: boolean; activity: FriendRequestSubmitActivity } {
  const activity = isSubmitting
    ? 'submitting'
    : isUploadingPhoto
      ? 'uploading'
      : 'idle';

  return {
    disabled: !hasProfile || activity !== 'idle',
    activity,
  };
}
