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
const mockCropIfNeeded = jest.fn();
let mockInAppCrop = false;
jest.mock('@/features/profile/image-crop-step', () => ({
  useImageCropStep: () => ({ cropIfNeeded: mockCropIfNeeded, cropper: 'cropper-node' }),
  getCropLibraryPickerOptions: () => (mockInAppCrop ? {} : { allowsEditing: true, aspect: [1, 1] }),
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => mockAuthState },
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
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
};
const mockAuthState = { sessionEpoch: 1, user: { id: 'viewer' } };

const onFailure = jest.fn();
// 选图、裁剪、预签名是一串 await:等链路走到下一个挂起点,别数微任务个数。
const flushPromises = async () => {
  for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
};

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
  mockInAppCrop = false;
  mockCropIfNeeded.mockReset().mockImplementation((asset: unknown) => Promise.resolve(asset));
  mockAuthState.sessionEpoch = 1;
  mockAuthState.user = { id: 'viewer' };
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (loadImagePickerModule as jest.Mock).mockReturnValue(mockPicker);
  mockPicker.requestCameraPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  mockPicker.launchCameraAsync.mockReset().mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file://camera.jpg', fileName: 'camera.jpg', mimeType: 'image/jpeg' }],
  });
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
  // 已授权设备不应先等待权限桥接，再呈现系统选择器。
  expect(mockPicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  // 上传前让用户确认方形裁剪。
  expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledWith({
    quality: 0.8,
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
  });
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

test('camera capture requests permission and uses the shared square avatar upload', async () => {
  const submit = jest.fn().mockResolvedValue(undefined);
  const onChanged = jest.fn();
  const { result } = renderHook(() => useChangeAvatar(options(submit, onChanged)));

  await act(async () => {
    await result.current.changeAvatar('camera');
  });

  expect(mockPicker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(mockPicker.launchCameraAsync).toHaveBeenCalledWith({
    quality: 0.8,
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
  });
  expect(mockPicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  expect(mockPicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload', 'image/jpeg', 'file://camera.jpg', { 'If-None-Match': '*' },
  );
  expect(submit).toHaveBeenCalledWith('https://cdn/a.jpg');
  expect(onChanged).toHaveBeenCalledWith('https://cdn/a.jpg');
});

test('denied camera permission shows localized settings guidance without launching or uploading', async () => {
  mockPicker.requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: false });
  const submit = jest.fn();
  const { result } = renderHook(() => useChangeAvatar(options(submit)));

  await act(async () => {
    await result.current.changeAvatar('camera');
  });

  expect(Alert.alert).toHaveBeenCalledWith('permissions.insufficientTitle', 'permissions.camera');
  expect(mockPicker.launchCameraAsync).not.toHaveBeenCalled();
  expect(mockPicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  expect(requestUploadPresign).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  expect(onFailure).not.toHaveBeenCalled();
});

test('canceling the camera skips upload and permits a subsequent capture', async () => {
  mockPicker.launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: null });
  const submit = jest.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useChangeAvatar(options(submit)));

  await act(async () => {
    await result.current.changeAvatar('camera');
  });
  expect(requestUploadPresign).not.toHaveBeenCalled();
  expect(result.current.changing).toBe(false);

  await act(async () => {
    await result.current.changeAvatar('camera');
  });
  expect(mockPicker.launchCameraAsync).toHaveBeenCalledTimes(2);
  expect(submit).toHaveBeenCalledTimes(1);
});

test.each(['requestCameraPermissionsAsync', 'launchCameraAsync'] as const)(
  '%s failures use localized copy and report the original error',
  async (method) => {
    const error = new Error('private camera detail');
    mockPicker[method].mockRejectedValueOnce(error);
    const submit = jest.fn();
    const { result } = renderHook(() => useChangeAvatar(options(submit)));

    await act(async () => {
      await result.current.changeAvatar('camera');
    });

    expect(onFailure).toHaveBeenCalledWith(error);
    expect(Alert.alert).toHaveBeenCalledWith('chat.groupAvatarUpdateFailed', 'common.networkError');
    expect(requestUploadPresign).not.toHaveBeenCalled();
    expect(result.current.changing).toBe(false);
  },
);

test('camera permission waits keep rapid source changes within one operation', async () => {
  let grantPermission!: (permission: { granted: boolean }) => void;
  mockPicker.requestCameraPermissionsAsync.mockReturnValueOnce(new Promise((resolve) => {
    grantPermission = resolve;
  }));
  const submit = jest.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useChangeAvatar(options(submit)));

  await act(async () => {
    const pending = result.current.changeAvatar('camera');
    await result.current.changeAvatar('camera');
    await result.current.changeAvatar('library');
    expect(mockPicker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockPicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    grantPermission({ granted: true });
    await pending;
  });

  expect(mockPicker.launchCameraAsync).toHaveBeenCalledTimes(1);
  expect(requestUploadPresign).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledTimes(1);
});

test.each(['camera', 'library'] as const)(
  'switching accounts while the %s picker is open discards its result',
  async (source) => {
    let finishPicker!: (result: unknown) => void;
    const picker = source === 'camera' ? mockPicker.launchCameraAsync : mockPicker.launchImageLibraryAsync;
    picker.mockReturnValueOnce(new Promise((resolve) => { finishPicker = resolve; }));
    const submit = jest.fn();
    const onChanged = jest.fn();
    const { result } = renderHook(() => useChangeAvatar(options(submit, onChanged)));

    await act(async () => {
      const pending = result.current.changeAvatar(source);
      await Promise.resolve();
      mockAuthState.sessionEpoch += 1;
      mockAuthState.user = { id: 'other-viewer' };
      finishPicker({ canceled: false, assets: [{ uri: 'file://a.jpg', mimeType: 'image/jpeg' }] });
      await pending;
    });

    expect(requestUploadPresign).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  },
);

test('switching accounts during upload skips the avatar write', async () => {
  let finishUpload!: () => void;
  (uploadLocalFileToPresignedUrl as jest.Mock).mockImplementationOnce(() => new Promise<void>((resolve) => {
    finishUpload = resolve;
  }));
  const submit = jest.fn();
  const onChanged = jest.fn();
  const { result } = renderHook(() => useChangeAvatar(options(submit, onChanged)));

  await act(async () => {
    const pending = result.current.changeAvatar();
    await flushPromises();
    mockAuthState.sessionEpoch += 1;
    finishUpload();
    await pending;
  });

  expect(submit).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled();
  expect(onFailure).not.toHaveBeenCalled();
  expect(result.current.changing).toBe(false);
});

test('unmounting while the library picker is open discards its result', async () => {
  let finishPicker!: (result: unknown) => void;
  mockPicker.launchImageLibraryAsync.mockReturnValueOnce(new Promise((resolve) => { finishPicker = resolve; }));
  const submit = jest.fn();
  const { result, unmount } = renderHook(() => useChangeAvatar(options(submit)));
  let pending!: Promise<void>;

  act(() => { pending = result.current.changeAvatar(); });
  unmount();
  await act(async () => {
    finishPicker({ canceled: false, assets: [{ uri: 'file://a.jpg', mimeType: 'image/jpeg' }] });
    await pending;
  });

  expect(requestUploadPresign).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

test.each(['permission', 'camera', 'upload'] as const)(
  'an account switch during a failed %s operation suppresses obsolete errors',
  async (phase) => {
    const failAfterSwitch = async () => {
      mockAuthState.sessionEpoch += 1;
      throw new Error('obsolete private error');
    };
    if (phase === 'permission') mockPicker.requestCameraPermissionsAsync.mockImplementationOnce(failAfterSwitch);
    if (phase === 'camera') mockPicker.launchCameraAsync.mockImplementationOnce(failAfterSwitch);
    if (phase === 'upload') (uploadLocalFileToPresignedUrl as jest.Mock).mockImplementationOnce(failAfterSwitch);
    const submit = jest.fn();
    const { result } = renderHook(() => useChangeAvatar(options(submit)));

    await act(async () => {
      await result.current.changeAvatar('camera');
    });

    expect(onFailure).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.changing).toBe(false);
  },
);

test('switching accounts during submit skips the old screen completion callback', async () => {
  const submit = jest.fn(async () => { mockAuthState.sessionEpoch += 1; });
  const onChanged = jest.fn();
  const { result } = renderHook(() => useChangeAvatar(options(submit, onChanged)));

  await act(async () => {
    await result.current.changeAvatar();
  });

  expect(submit).toHaveBeenCalledTimes(1);
  expect(onChanged).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

describe('square crop on the fast library picker', () => {
  beforeEach(() => { mockInAppCrop = true; });

  test('the library opens without native editing so iOS keeps the instant picker', async () => {
    const { result } = renderHook(() => useChangeAvatar(options(jest.fn().mockResolvedValue(undefined))));
    await act(async () => { await result.current.changeAvatar('library'); });
    expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledWith({ quality: 0.8, mediaTypes: ['images'] });
  });

  test('the cropped image is what gets uploaded', async () => {
    mockCropIfNeeded.mockResolvedValueOnce({ uri: 'file://cropped.jpg', fileName: 'a.jpg', mimeType: 'image/jpeg' });
    const { result } = renderHook(() => useChangeAvatar(options(jest.fn().mockResolvedValue(undefined))));
    await act(async () => { await result.current.changeAvatar('library'); });
    expect(mockCropIfNeeded).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file://a.jpg' }));
    expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith('https://upload', 'image/jpeg', 'file://cropped.jpg', { 'If-None-Match': '*' });
  });

  test('canceling the crop uploads nothing and allows choosing again', async () => {
    mockCropIfNeeded.mockResolvedValueOnce(null);
    const submit = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useChangeAvatar(options(submit)));
    await act(async () => { await result.current.changeAvatar('library'); });
    expect(requestUploadPresign).not.toHaveBeenCalled();
    await act(async () => { await result.current.changeAvatar('library'); });
    expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  test('switching accounts during the crop discards the result', async () => {
    let finishCrop!: (asset: unknown) => void;
    mockCropIfNeeded.mockReturnValueOnce(new Promise((resolve) => { finishCrop = resolve; }));
    const { result } = renderHook(() => useChangeAvatar(options(jest.fn())));
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.changeAvatar('library'); await flushPromises(); });
    mockAuthState.sessionEpoch += 1;
    await act(async () => { finishCrop({ uri: 'file://cropped.jpg', mimeType: 'image/jpeg' }); await pending; });
    expect(requestUploadPresign).not.toHaveBeenCalled();
  });

  test('the camera keeps its native square editor and skips the in-app step', async () => {
    const { result } = renderHook(() => useChangeAvatar(options(jest.fn().mockResolvedValue(undefined))));
    await act(async () => { await result.current.changeAvatar('camera'); });
    expect(mockPicker.launchCameraAsync).toHaveBeenCalledWith({ quality: 0.8, mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1] });
    expect(mockCropIfNeeded).not.toHaveBeenCalled();
  });

  test('callers receive the crop step to render', () => {
    const { result } = renderHook(() => useChangeAvatar(options(jest.fn())));
    expect(result.current.cropper).toBe('cropper-node');
  });
});
