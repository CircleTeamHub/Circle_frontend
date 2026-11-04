import React from 'react';
import { Alert, Modal } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AvatarPhotoViewer } from './avatar-photo-viewer';
import { saveImageToLibrary } from '@/utils/save-image';

jest.mock('@/components/ui/zoomable-image', () => {
  const { View } = jest.requireActual('react-native');
  return { ZoomableImage: (props: Record<string, unknown>) => <View testID="avatar-full-image" {...props} /> };
});
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/utils/save-image', () => ({ saveImageToLibrary: jest.fn() }));
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: jest.requireActual('@/theme/colors').lightColors }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const onChange = jest.fn();
const onClose = jest.fn();
const props = { uri: 'https://example.test/current.jpg', name: 'Avatar', visible: true, onChange, onClose };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(saveImageToLibrary).mockResolvedValue('saved');
});
afterEach(() => jest.restoreAllMocks());

function openMenu() { fireEvent.press(screen.getByLabelText('avatarPhoto.actions')); }

test('opening shows the current full image without launching a picker', () => {
  render(<AvatarPhotoViewer {...props} />);
  expect(screen.getByTestId('avatar-full-image').props.uri).toBe(props.uri);
  expect(screen.queryByText('avatarPhoto.takePhoto')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  expect(saveImageToLibrary).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('common.back'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('the three-dot menu opens three actions and cancel inside the same native modal', () => {
  render(<AvatarPhotoViewer {...props} />);
  openMenu();
  expect(screen.getByText('avatarPhoto.takePhoto')).toBeTruthy();
  expect(screen.getByText('avatarPhoto.chooseFromPhotos')).toBeTruthy();
  expect(screen.getByText('media.saveImage')).toBeTruthy();
  expect(screen.UNSAFE_getAllByType(Modal)).toHaveLength(1);
  expect(screen.getByTestId('avatar-photo-content', { includeHiddenElements: true }).props.importantForAccessibility).toBe('no-hide-descendants');
  fireEvent.press(screen.getByText('common.cancel'));
  expect(screen.queryByTestId('avatar-photo-actions')).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});

test.each([['avatarPhoto.takePhoto', 'camera'], ['avatarPhoto.chooseFromPhotos', 'library']])('selecting %s starts only the requested source', (label, source) => {
  render(<AvatarPhotoViewer {...props} />);
  openMenu();
  fireEvent.press(screen.getByText(label));
  expect(onChange).toHaveBeenCalledWith(source);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('avatar-photo-actions')).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});

test.each(['saved', 'denied', 'failed'] as const)('save writes the current image and reports %s without changing the avatar', async (outcome) => {
  jest.mocked(saveImageToLibrary).mockResolvedValue(outcome);
  render(<AvatarPhotoViewer {...props} />);
  openMenu();
  fireEvent.press(screen.getByText('media.saveImage'));
  await waitFor(() => expect(saveImageToLibrary).toHaveBeenCalledWith(props.uri));
  expect(Alert.alert).toHaveBeenCalledWith(
    outcome === 'saved' ? 'media.savedTitle' : outcome === 'denied' ? 'media.saveDeniedTitle' : 'media.saveFailedTitle',
    outcome === 'saved' ? 'media.savedMessage' : outcome === 'denied' ? 'media.saveDeniedMessage' : 'media.saveFailedMessage',
  );
  expect(onChange).not.toHaveBeenCalled();
});

test('read-only viewing hides camera and library actions', () => {
  render(<AvatarPhotoViewer {...props} onChange={undefined} />);
  openMenu();
  expect(screen.queryByText('avatarPhoto.takePhoto')).toBeNull();
  expect(screen.queryByText('avatarPhoto.chooseFromPhotos')).toBeNull();
  expect(screen.getByText('media.saveImage')).toBeTruthy();
});

test('an unset avatar still allows choosing a photo but cannot save a placeholder', () => {
  render(<AvatarPhotoViewer {...props} uri={null} />);
  expect(screen.queryByTestId('avatar-full-image')).toBeNull();
  openMenu();
  fireEvent.press(screen.getByText('media.saveImage'));
  expect(saveImageToLibrary).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('avatarPhoto.chooseFromPhotos'));
  expect(onChange).toHaveBeenCalledWith('library');
});

test('Android back closes the action sheet before the full image', () => {
  render(<AvatarPhotoViewer {...props} />);
  openMenu();
  act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByTestId('avatar-photo-actions')).toBeNull();
  act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('the preview updates to a newly uploaded avatar', () => {
  const view = render(<AvatarPhotoViewer {...props} />);
  view.rerender(<AvatarPhotoViewer {...props} uri="https://example.test/new.jpg" />);
  expect(screen.getByTestId('avatar-full-image').props.uri).toBe('https://example.test/new.jpg');
});

test('closing while saving suppresses stale completion feedback', async () => {
  let finish!: (result: 'saved') => void;
  jest.mocked(saveImageToLibrary).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const view = render(<AvatarPhotoViewer {...props} />);
  openMenu();
  fireEvent.press(screen.getByText('media.saveImage'));
  view.unmount();
  await act(async () => finish('saved'));
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('busy previews cannot start another upload or duplicate an album save', async () => {
  let finish!: (result: 'saved') => void;
  jest.mocked(saveImageToLibrary).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<AvatarPhotoViewer {...props} />);
  openMenu();
  fireEvent.press(screen.getByText('media.saveImage'));
  openMenu();
  fireEvent.press(screen.getByText('media.saveImage'));
  fireEvent.press(screen.getByText('avatarPhoto.takePhoto'));
  expect(saveImageToLibrary).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => finish('saved'));
});

test('uploading keeps camera, album and save actions disabled', () => {
  render(<AvatarPhotoViewer {...props} changing />);
  openMenu();
  fireEvent.press(screen.getByText('avatarPhoto.takePhoto'));
  fireEvent.press(screen.getByText('avatarPhoto.chooseFromPhotos'));
  fireEvent.press(screen.getByText('media.saveImage'));
  expect(onChange).not.toHaveBeenCalled();
  expect(saveImageToLibrary).not.toHaveBeenCalled();
});

test('a hidden viewer retains no native modal or image resources', () => {
  render(<AvatarPhotoViewer {...props} visible={false} />);
  expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(0);
});
