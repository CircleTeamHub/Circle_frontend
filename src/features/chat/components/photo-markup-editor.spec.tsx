import React, { createRef, type ReactNode } from 'react';
import { PanResponder, type StyleProp, type ViewStyle } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ImagePickerAsset } from 'expo-image-picker';
import { drawAsImage } from '@shopify/react-native-skia';
import {
  boundedPhotoExportSize,
  PhotoMarkupEditor,
  type PhotoMarkupEditorHandle,
} from './photo-markup-editor';

jest.mock('@shopify/react-native-skia', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native');
  const Container = ({ children, testID, style }: {
    children?: ReactNode;
    testID?: string;
    style?: StyleProp<ViewStyle>;
  }) => ReactModule.createElement(ReactNative.View, { testID, style }, children);
  const Shape = () => null;
  return {
    Blur: Shape,
    Canvas: Container,
    Circle: Shape,
    Group: Container,
    Image: Container,
    ImageFormat: { JPEG: 3, PNG: 4 },
    Mask: Container,
    Path: Shape,
    Skia: {
      Path: {
        Make: () => ({ moveTo: jest.fn(), lineTo: jest.fn() }),
      },
    },
    drawAsImage: jest.fn(),
    useImage: () => ({ width: () => 1200, height: () => 600 }),
  };
});

jest.mock('expo-file-system', () => ({
  File: jest.fn(() => ({
    uri: 'file:///cache/photo-markup.jpg',
    create: jest.fn(),
    write: jest.fn(),
  })),
  Paths: { cache: {} },
}));

const asset = {
  uri: 'file:///photo.jpg',
  width: 1200,
  height: 600,
  type: 'image',
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
} as ImagePickerAsset;

describe('PhotoMarkupEditor gestures', () => {
  beforeEach(() => {
    jest.spyOn(PanResponder, 'create').mockImplementation((config) => ({
      panHandlers: {
        onResponderGrant: config.onPanResponderGrant,
        onResponderMove: config.onPanResponderMove,
        onResponderRelease: config.onPanResponderRelease,
        onResponderTerminate: config.onPanResponderTerminate,
      },
    }) as ReturnType<typeof PanResponder.create>);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records a continuous finger stroke and exposes one-step undo', async () => {
    const onCanUndoChange = jest.fn();
    const ref = createRef<PhotoMarkupEditorHandle>();
    const view = render(
      <PhotoMarkupEditor
        ref={ref}
        asset={asset}
        tool="mosaic"
        color="#FF3B30"
        accessibilityLabel="markup"
        onCanUndoChange={onCanUndoChange}
        onReadyChange={jest.fn()}
      />,
    );

    fireEvent(view.getByTestId('photo-markup-editor'), 'layout', {
      nativeEvent: { layout: { width: 400, height: 600 } },
    });
    const surface = await view.findByTestId('photo-markup-touch-surface');
    act(() => {
      surface.props.onResponderGrant({
        nativeEvent: { locationX: 40, locationY: 20 },
      });
      surface.props.onResponderMove({
        nativeEvent: { locationX: 200, locationY: 100 },
      });
      surface.props.onResponderRelease();
    });

    await waitFor(() => expect(onCanUndoChange).toHaveBeenLastCalledWith(true));
    act(() => ref.current?.undo());
    await waitFor(() => expect(onCanUndoChange).toHaveBeenLastCalledWith(false));
  });
});

describe('PhotoMarkupEditor export budget', () => {
  beforeEach(() => {
    jest.spyOn(PanResponder, 'create').mockImplementation((config) => ({
      panHandlers: {
        onResponderGrant: config.onPanResponderGrant,
        onResponderMove: config.onPanResponderMove,
        onResponderRelease: config.onPanResponderRelease,
        onResponderTerminate: config.onPanResponderTerminate,
      },
    }) as ReturnType<typeof PanResponder.create>);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('caps a high-resolution export to a 4096px long edge', () => {
    expect(boundedPhotoExportSize(8000, 6000)).toEqual({ width: 4096, height: 3072 });
  });

  it('does not upscale an image inside the export budget', () => {
    expect(boundedPhotoExportSize(1200, 600)).toEqual({ width: 1200, height: 600 });
  });

  it('renders and reports the bounded export dimensions', async () => {
    const exportAsset = {
      ...asset,
      width: 8000,
      height: 6000,
    } as ImagePickerAsset;
    const ref = createRef<PhotoMarkupEditorHandle>();
    const rendered = {
      encodeToBytes: jest.fn(() => new Uint8Array([1, 2, 3])),
      dispose: jest.fn(),
    };
    (drawAsImage as jest.Mock).mockResolvedValue(rendered);
    const view = render(
      <PhotoMarkupEditor
        ref={ref}
        asset={exportAsset}
        tool="draw"
        color="#FF3B30"
        accessibilityLabel="markup"
        onCanUndoChange={jest.fn()}
        onReadyChange={jest.fn()}
      />,
    );

    fireEvent(view.getByTestId('photo-markup-editor'), 'layout', {
      nativeEvent: { layout: { width: 400, height: 600 } },
    });
    const surface = await view.findByTestId('photo-markup-touch-surface');
    act(() => {
      surface.props.onResponderGrant({
        nativeEvent: { locationX: 40, locationY: 20 },
      });
      surface.props.onResponderRelease();
    });

    const exported = await act(async () => ref.current?.exportImage());

    const scene = (drawAsImage as jest.Mock).mock.calls[0]?.[0];
    expect(scene.props).toEqual(expect.objectContaining({ width: 4096, height: 3072 }));
    expect(drawAsImage).toHaveBeenCalledWith(
      expect.anything(),
      { width: 4096, height: 3072 },
    );
    expect(exported).toEqual(expect.objectContaining({ width: 4096, height: 3072 }));
  });
});
