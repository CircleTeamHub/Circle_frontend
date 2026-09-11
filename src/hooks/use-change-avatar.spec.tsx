import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useChangeAvatar } from './use-change-avatar';
import { loadImagePickerModule } from '@/features/profile/image-picker';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';

jest.mock('@/features/profile/image-picker', () => ({
  loadImagePickerModule: jest.fn(),
}));
jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: jest.fn(),
  resolveUploadContentType: jest.fn(),
  sanitizeUploadFilename: jest.fn(),
  uploadLocalFileToPresignedUrl: jest.fn(),
}));
jest.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
// 与 api-error-localization 覆盖的真实漏斗同语义:认识的码出本地化文案,
// 其余回落 fallback,原始 Error.message 永不透出。
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (error: unknown, fallback: string) => {
    const code = (error as { errorCode?: string } | null)?.errorCode;
    return code ? `serverErrors.${code}` : fallback;
  },
}));

const mockPicker = {
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
};

const onFailure = jest.fn();

function options(submit: (fileUrl: string) => Promise<void>, onChanged = jest.fn()) {
  return {
    submit,
    onChanged,
    failureTitle: 'chat.groupAvatarUpdateFailed',
    onFailure,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (loadImagePickerModule as jest.Mock).mockReturnValue(mockPicker);
  mockPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
    granted: true,
  });
  mockPicker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'file://a.jpg', fileName: 'a.jpg', mimeType: 'image/jpeg' },
    ],
  });
  (resolveUploadContentType as jest.Mock).mockReturnValue('image/jpeg');
  (sanitizeUploadFilename as jest.Mock).mockReturnValue('a.jpg');
  (requestUploadPresign as jest.Mock).mockResolvedValue({
    uploadUrl: 'https://upload',
    fileUrl: 'https://cdn/a.jpg',
    requiredHeaders: { 'If-None-Match': '*' },
  });
  (uploadLocalFileToPresignedUrl as jest.Mock).mockResolvedValue(undefined);
});

test('the presign required headers are forwarded verbatim to the upload', async () => {
  // SDK 把所有头都签进了签名里:少转发一个 If-None-Match,MinIO 就 400。
  const submit = jest.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useChangeAvatar(options(submit)));

  await act(async () => {
    await result.current.changeAvatar();
  });

  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload',
    'image/jpeg',
    'file://a.jpg',
    { 'If-None-Match': '*' },
  );
  expect(submit).toHaveBeenCalledWith('https://cdn/a.jpg');
});

test('a rejected write shows the reason the server gave, not a blanket network error', async () => {
  // 原来这里无条件 alert common.networkError,于是 CHAT_GROUP_AVATAR_URL_INVALID /
  // CHAT_GROUP_MANAGER_ONLY 这些说清楚了原因的拒绝永远到不了用户。
  const denied = Object.assign(
    new Error('403 https://api.internal/chat/conversations/x/avatar'),
    { name: 'ApiError', errorCode: 'CHAT_GROUP_AVATAR_URL_INVALID' },
  );
  const submit = jest.fn().mockRejectedValue(denied);
  const onChanged = jest.fn();
  const { result } = renderHook(() => useChangeAvatar(options(submit, onChanged)));

  await act(async () => {
    await result.current.changeAvatar();
  });

  expect(Alert.alert).toHaveBeenCalledWith(
    'chat.groupAvatarUpdateFailed',
    'serverErrors.CHAT_GROUP_AVATAR_URL_INVALID',
  );
  expect(onChanged).not.toHaveBeenCalled();
  // 诊断上报留在调用点(fingerprint 要字面量 tag),但失败必须带给它。
  expect(onFailure).toHaveBeenCalledWith(denied);
});

test('an error without a known code still falls back to the generic copy', async () => {
  const submit = jest
    .fn()
    .mockRejectedValue(new Error('socket hang up https://api.internal'));
  const { result } = renderHook(() => useChangeAvatar(options(submit)));

  await act(async () => {
    await result.current.changeAvatar();
  });

  expect(Alert.alert).toHaveBeenCalledWith(
    'chat.groupAvatarUpdateFailed',
    'common.networkError',
  );
  expect(JSON.stringify(jest.mocked(Alert.alert).mock.calls)).not.toContain(
    'api.internal',
  );
});

test('concurrent taps open one picker and fire one upload', async () => {
  const submit = jest.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useChangeAvatar(options(submit)));

  await act(async () => {
    await Promise.all([
      result.current.changeAvatar(),
      result.current.changeAvatar(),
    ]);
  });

  expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
  expect(requestUploadPresign).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledTimes(1);
});
