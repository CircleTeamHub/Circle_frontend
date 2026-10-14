import { launchImageLibraryFast } from './image-picker';

function makePicker() {
  return {
    launchImageLibraryAsync: jest.fn(),
    getMediaLibraryPermissionsAsync: jest.fn(),
    requestMediaLibraryPermissionsAsync: jest.fn(),
  };
}

const picked = { canceled: false, assets: [{ uri: 'file:///a.jpg' }] };

test('launches the picker directly without asking for permission first', async () => {
  const picker = makePicker();
  picker.launchImageLibraryAsync.mockResolvedValue(picked);

  const outcome = await launchImageLibraryFast(picker as never, { mediaTypes: ['images'] });

  expect(outcome).toEqual({ status: 'picked', result: picked });
  expect(picker.getMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  expect(picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
});

test('requests permission and retries once when launching failed without permission', async () => {
  const picker = makePicker();
  picker.launchImageLibraryAsync
    .mockRejectedValueOnce(new Error('no permission'))
    .mockResolvedValueOnce(picked);
  picker.getMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false });
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });

  const outcome = await launchImageLibraryFast(picker as never, {});

  expect(outcome).toEqual({ status: 'picked', result: picked });
  expect(picker.launchImageLibraryAsync).toHaveBeenCalledTimes(2);
});

test('reports denied with the permission response', async () => {
  const picker = makePicker();
  const denied = { granted: false, canAskAgain: false };
  picker.launchImageLibraryAsync.mockRejectedValue(new Error('no permission'));
  picker.getMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false });
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue(denied);

  await expect(launchImageLibraryFast(picker as never, {})).resolves.toEqual({
    status: 'denied',
    permission: denied,
  });
  expect(picker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
});

test('rethrows non-permission failures without reopening the picker', async () => {
  const picker = makePicker();
  const failure = new Error('transcode failed');
  picker.launchImageLibraryAsync.mockRejectedValue(failure);
  picker.getMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });

  await expect(launchImageLibraryFast(picker as never, {})).rejects.toBe(failure);
  expect(picker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
  expect(picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
});
