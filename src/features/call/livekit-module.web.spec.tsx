import React from 'react';
import { render, screen } from '@testing-library/react-native';
import {
  getInitialLiveKitModule,
  loadLiveKitModule,
} from './livekit-module.web';
import { reportError } from '@/observability/sentry';

jest.mock('@/observability/sentry', () => ({ reportError: jest.fn() }));

const mockLiveKitComponents = () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const { View: NativeView } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    LiveKitRoom: ({ children }: { children?: React.ReactNode }) => children,
    VideoTrack: (props: Record<string, unknown>) =>
      ReactModule.createElement(NativeView, { testID: 'sdk-video', ...props }),
    RoomAudioRenderer: () =>
      ReactModule.createElement(NativeView, { testID: 'room-audio' }),
    useConnectionState: () => 'connected',
    useLocalParticipant: () => ({
      localParticipant: {
        identity: 'local',
        setMicrophoneEnabled: jest.fn(),
        setCameraEnabled: jest.fn(),
      },
      isMicrophoneEnabled: true,
      isCameraEnabled: false,
    }),
    useTracks: () => [{ participant: { identity: 'remote' } }],
    useParticipants: () => [{ identity: 'remote', name: 'Remote' }],
    useRoomContext: () => ({ disconnect: jest.fn() }),
  };
};

test('web LiveKit adapter reports a rejected chunk load and retries later', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: jest.fn() } },
  });

  try {
    const rejectedLoader = jest.fn().mockRejectedValue(new Error('chunk failed'));
    await expect(loadLiveKitModule(rejectedLoader)).resolves.toBeNull();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'LiveKit web module failed to load' }),
      { operation: 'livekit', kind: 'moduleLoad' },
    );

    const retryLoader = jest.fn(async () => mockLiveKitComponents() as never);
    await expect(loadLiveKitModule(retryLoader)).resolves.not.toBeNull();
    expect(retryLoader).toHaveBeenCalledTimes(1);
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorNavigator) {
      Object.defineProperty(globalThis, 'navigator', priorNavigator);
    } else {
      Reflect.deleteProperty(globalThis, 'navigator');
    }
  }
});

test('web LiveKit adapter loads once and preserves the native-facing contract', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: jest.fn() } },
  });

  try {
    const [first, second] = await Promise.all([
      loadLiveKitModule(async () => mockLiveKitComponents() as never),
      loadLiveKitModule(async () => mockLiveKitComponents() as never),
    ]);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(getInitialLiveKitModule()).toBe(first);
    expect(first?.useConnectionState()).toBe('connected');
    expect(first?.useTracks(['camera'])).toEqual([
      { participant: { identity: 'remote' } },
    ]);

    const trackRef = { participant: { identity: 'remote' } };
    render(
      <>
        {first
          ? React.createElement(first.VideoTrack, {
              trackRef,
              style: [{ opacity: 0.8 }, { borderRadius: 12 }],
              objectFit: 'contain',
              mirror: true,
            })
          : null}
        {first ? React.createElement(first.RoomAudioRenderer) : null}
      </>,
    );

    expect(screen.getByTestId('sdk-video').props.style).toMatchObject({
      width: '100%',
      height: '100%',
      opacity: 0.8,
      borderRadius: 12,
      objectFit: 'contain',
      transform: 'scaleX(-1)',
    });
    expect(screen.getByTestId('room-audio')).toBeTruthy();
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorNavigator) {
      Object.defineProperty(globalThis, 'navigator', priorNavigator);
    } else {
      Reflect.deleteProperty(globalThis, 'navigator');
    }
  }
});

test('web LiveKit adapter fails closed when browser WebRTC is unavailable', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'window');
  try {
    expect(getInitialLiveKitModule()).toBeNull();
    expect(await loadLiveKitModule()).toBeNull();
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
  }
});
