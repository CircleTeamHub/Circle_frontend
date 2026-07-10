export type FriendRequestSubmitActivity = 'idle' | 'submitting' | 'uploading';

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
