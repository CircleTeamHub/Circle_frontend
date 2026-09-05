import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { captureVideoFrame, VideoDraftPreview } from './VideoDraftPreview.web';

function createFakeDocument() {
  const listeners = new Map<string, () => void>();
  const video = {
    readyState: 2,
    duration: 3,
    videoWidth: 640,
    videoHeight: 360,
    currentTime: 0,
    muted: false,
    preload: '',
    playsInline: false,
    autoplay: true,
    src: '',
    addEventListener: jest.fn((event: string, listener: () => void) => listeners.set(event, listener)),
    removeEventListener: jest.fn((event: string) => listeners.delete(event)),
    load: jest.fn(),
    play: jest.fn(),
    removeAttribute: jest.fn(),
    remove: jest.fn(),
    emit: (event: string) => listeners.get(event)?.(),
  };
  const context = { drawImage: jest.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: jest.fn(() => context),
    toDataURL: jest.fn(() => 'data:image/jpeg;base64,captured-frame'),
  };
  return {
    document: {
      createElement: jest.fn((tag: string) => (tag === 'video' ? video : canvas)),
    },
    video,
    canvas,
    context,
  };
}

test('web preview captures a still frame without playing the selected video', async () => {
  const previousDocument = global.document;
  const fake = createFakeDocument();
  Object.defineProperty(global, 'document', { configurable: true, value: fake.document });
  try {
    render(<VideoDraftPreview uri="blob:selected-video" />);
    await waitFor(() => expect(fake.video.load).toHaveBeenCalledTimes(1));

    act(() => fake.video.emit('loadedmetadata'));
    expect(fake.video.currentTime).toBe(0.1);
    act(() => fake.video.emit('loadeddata'));
    expect(fake.context.drawImage).not.toHaveBeenCalled();
    act(() => fake.video.emit('seeked'));
    await screen.findByTestId('note-media-preview-video');
    expect(screen.getByTestId('note-media-preview-video').props.src).toBe(
      'data:image/jpeg;base64,captured-frame',
    );
    expect(fake.context.drawImage).toHaveBeenCalledWith(fake.video, 0, 0, 320, 180);
    expect(fake.video.play).not.toHaveBeenCalled();
    expect(fake.video.remove).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(global, 'document', { configurable: true, value: previousDocument });
  }
});

test('web capture bounds portrait canvas dimensions while preserving its aspect ratio', async () => {
  const fake = createFakeDocument();
  fake.video.videoWidth = 1;
  fake.video.videoHeight = 10_000;
  const capture = captureVideoFrame('blob:portrait-video', fake.document as never);

  fake.video.emit('loadedmetadata');
  fake.video.emit('seeked');
  await expect(capture).resolves.toBe('data:image/jpeg;base64,captured-frame');
  expect(fake.canvas.width).toBe(1);
  expect(fake.canvas.height).toBe(320);
  expect(fake.canvas.width).toBeLessThanOrEqual(320);
  expect(fake.canvas.height).toBeLessThanOrEqual(320);
});

test('web capture uses the available zero-duration frame without seeking', async () => {
  const fake = createFakeDocument();
  fake.video.duration = 0;
  const capture = captureVideoFrame('blob:zero-duration', fake.document as never);

  fake.video.emit('loadedmetadata');
  await expect(capture).resolves.toBe('data:image/jpeg;base64,captured-frame');
  expect(fake.video.currentTime).toBe(0);
  expect(fake.context.drawImage).toHaveBeenCalledTimes(1);
});

test('web capture seeks a nonzero frame and cleans up error or timeout fallbacks', async () => {
  jest.useFakeTimers();
  const fake = createFakeDocument();
  try {
    fake.video.readyState = 0;
    const capture = captureVideoFrame('blob:unresponsive-video', fake.document as never);
    fake.video.emit('loadedmetadata');
    expect(fake.video.currentTime).toBe(0.1);

    fake.video.emit('error');
    await expect(capture).resolves.toBeNull();
    expect(fake.video.remove).toHaveBeenCalledTimes(1);

    const timeoutFake = createFakeDocument();
    const timeoutCapture = captureVideoFrame('blob:never-loads', timeoutFake.document as never);
    act(() => jest.advanceTimersByTime(5_000));
    await expect(timeoutCapture).resolves.toBeNull();
    expect(timeoutFake.video.remove).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
