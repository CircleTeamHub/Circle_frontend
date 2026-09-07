import React from 'react';
import { render, screen } from '@testing-library/react-native';
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
  Spacing: { md: 8, lg: 16 },
  Typography: { body: {} },
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
