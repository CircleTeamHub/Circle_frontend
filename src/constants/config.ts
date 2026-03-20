export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080';

export const APP_NAME = 'Circle IM';

export const LIMITS = {
  POST_MAX_LENGTH: 5000,
  POST_MAX_IMAGES: 9,
  POST_MAX_VIDEOS: 1,
  IMAGE_MAX_SIZE_MB: 50,
  VIDEO_MAX_SIZE_MB: 500,
  FILE_MAX_SIZE_MB: 2048,
  GROUP_MAX_MEMBERS: 500,
  MESSAGE_RECALL_SECONDS: 120,
} as const;
