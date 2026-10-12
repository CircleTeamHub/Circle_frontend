import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { FlatList, Modal } from 'react-native';
import { ImageViewer } from './image-viewer';

jest.mock('@/components/ui/zoomable-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ZoomableImage: (props: Record<string, unknown>) => (
      <View testID="zoomable-image" {...props} />
    ),
  };
});

jest.mock('@/utils/save-image', () => ({
  saveImageToLibrary: jest.fn(),
}));

jest.mock('@/theme', () => ({
  Radius: { xl: 20, full: 9999 },
  Spacing: { sm: 4, md: 8, lg: 16 },
  Typography: { body: {}, caption: {} },
  useTheme: () => ({
    colors: {
      overlay: 'rgba(0,0,0,.4)',
      surface: '#fff',
      surfaceBorder: '#ddd',
      text: '#111',
      textSecondary: '#666',
      iconAccent: '#6200ee',
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

test('ephemeral previews stay memory-only and expose no save gesture', () => {
  render(
    <ImageViewer
      images={['https://example.test/private.jpg']}
      visible
      privacyMode="ephemeral"
      onClose={jest.fn()}
    />,
  );

  const image = screen.getByTestId('zoomable-image');
  expect(image.props.cachePolicy).toBe('none');
  expect(image.props.onLongPress).toBeUndefined();
});

test('standard previews keep disk caching and the save gesture', () => {
  render(
    <ImageViewer
      images={['https://example.test/ordinary.jpg']}
      visible
      onClose={jest.fn()}
    />,
  );

  const image = screen.getByTestId('zoomable-image');
  expect(image.props.cachePolicy).toBe('memory-disk');
  expect(image.props.onLongPress).toEqual(expect.any(Function));
});

test('long press opens the save menu inside the viewer modal and cancel closes it', () => {
  const onClose = jest.fn();
  render(
    <ImageViewer
      images={['https://example.test/ordinary.jpg']}
      visible
      onClose={onClose}
    />,
  );

  act(() => {
    fireEvent(screen.getByTestId('zoomable-image'), 'longPress');
  });
  // The menu is an overlay inside the viewer's own Modal, not a sibling Modal.
  const sheet = screen.getByTestId('image-action-sheet');
  expect(screen.UNSAFE_getAllByType(Modal)).toHaveLength(1);
  expect(sheet).toBeTruthy();
  expect(screen.getByText('media.saveImage')).toBeTruthy();

  fireEvent.press(screen.getByLabelText('common.cancel'));
  expect(screen.queryByTestId('image-action-sheet')).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});

test('Android back closes the save menu first, then the viewer', () => {
  const onClose = jest.fn();
  render(
    <ImageViewer
      images={['https://example.test/ordinary.jpg']}
      visible
      onClose={onClose}
    />,
  );
  act(() => {
    fireEvent(screen.getByTestId('zoomable-image'), 'longPress');
  });

  act(() => {
    screen.UNSAFE_getByType(Modal).props.onRequestClose();
  });
  expect(screen.queryByTestId('image-action-sheet')).toBeNull();
  expect(onClose).not.toHaveBeenCalled();

  act(() => {
    screen.UNSAFE_getByType(Modal).props.onRequestClose();
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('hidden viewers do not mount zoomable image resources', () => {
  const { queryByTestId } = render(
    <ImageViewer
      images={['https://example.test/hidden.jpg']}
      visible={false}
      onClose={jest.fn()}
    />,
  );

  expect(queryByTestId('zoomable-image')).toBeNull();
});

test('starts rendering a nonadjacent destination while a fling is still in progress', () => {
  const view = render(
    <ImageViewer
      images={['https://example.test/0.jpg', 'https://example.test/1.jpg', 'https://example.test/2.jpg']}
      visible
      onClose={jest.fn()}
    />,
  );
  const list = view.UNSAFE_getByType(FlatList);

  fireEvent.scroll(list, {
    nativeEvent: { contentOffset: { x: 1500, y: 0 } },
  });

  expect(screen.getAllByTestId('zoomable-image').some((image) => image.props.uri === 'https://example.test/2.jpg')).toBe(true);
});
