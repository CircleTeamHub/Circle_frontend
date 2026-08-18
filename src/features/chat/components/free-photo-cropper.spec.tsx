import React from 'react';
import { PanResponder } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ImagePickerAsset } from 'expo-image-picker';
import { FreePhotoCropper } from './free-photo-cropper';

jest.mock('expo-image', () => ({ Image: () => null }));

const asset = {
  uri: 'file:///photo.jpg',
  width: 1200,
  height: 600,
  type: 'image',
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
} as ImagePickerAsset;

describe('FreePhotoCropper gestures', () => {
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

  it('resizes freely from a corner and then moves the selected frame', async () => {
    const onCropChange = jest.fn();
    const view = render(
      <FreePhotoCropper
        asset={asset}
        onCropChange={onCropChange}
        accessibilityLabel="crop"
      />,
    );

    fireEvent(view.getByTestId('free-photo-cropper'), 'layout', {
      nativeEvent: { layout: { width: 400, height: 600 } },
    });

    await waitFor(() => {
      expect(onCropChange).toHaveBeenLastCalledWith({
        originX: 0,
        originY: 0,
        width: 1200,
        height: 600,
      });
    });

    const bottomRight = view.getByTestId('free-crop-bottom-right');
    act(() => {
      bottomRight.props.onResponderGrant({}, { dx: 0, dy: 0 });
      bottomRight.props.onResponderMove({}, { dx: -100, dy: -50 });
      bottomRight.props.onResponderRelease({}, { dx: -100, dy: -50 });
    });
    expect(onCropChange).toHaveBeenLastCalledWith({
      originX: 0,
      originY: 0,
      width: 900,
      height: 450,
    });

    const frame = view.getByTestId('free-crop-frame');
    act(() => {
      frame.props.onResponderGrant({}, { dx: 0, dy: 0 });
      frame.props.onResponderMove({}, { dx: 50, dy: 25 });
      frame.props.onResponderRelease({}, { dx: 50, dy: 25 });
    });
    expect(onCropChange).toHaveBeenLastCalledWith({
      originX: 150,
      originY: 75,
      width: 900,
      height: 450,
    });
  });
});
