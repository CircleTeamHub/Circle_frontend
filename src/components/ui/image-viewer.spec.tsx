import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { FlatList, Modal, View } from 'react-native';
import { ImageViewer } from './image-viewer';

jest.mock('@/components/app/UploadProgressHost', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { UploadProgressHost: () => <View testID="upload-progress-modal-host" /> };
});

jest.mock('@/components/ui/zoomable-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ZoomableImage: (props: Record<string, unknown>) => (
      <View testID="zoomable-image" {...props} />
    ),
  };
});

let mockVideoPageMounts = 0;
jest.mock('@/components/ui/viewer-video-page', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ViewerVideoPage: (props: Record<string, unknown>) => {
      useEffect(() => { mockVideoPageMounts += 1; }, []);
      return <View testID="viewer-video-page" {...props} />;
    },
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

test('applies each conversation image privacy policy and reports horizontal paging', () => {
  const onIndexChange = jest.fn();
  render(<ImageViewer images={['ordinary.jpg', 'private.jpg']} privacyModes={['standard', 'ephemeral']} visible onClose={jest.fn()} onIndexChange={onIndexChange} />);
  expect(screen.getByTestId('zoomable-image').props.cachePolicy).toBe('memory-disk');
  fireEvent.scroll(screen.UNSAFE_getByType(FlatList), { nativeEvent: { contentOffset: { x: 750, y: 0 } } });
  expect(onIndexChange).toHaveBeenCalledWith(1);
  expect(screen.getByTestId('zoomable-image').props.cachePolicy).toBe('none');
  expect(screen.getByTestId('zoomable-image').props.onLongPress).toBeUndefined();
});

test('only mounts the active full-size image and retains empty pages for swipe navigation', () => {
  render(<ImageViewer images={['0.jpg', '1.jpg', '2.jpg']} cacheKeys={['zero', 'one', 'two']} initialIndex={1} visible onClose={jest.fn()} />);
  const list = screen.UNSAFE_getByType(FlatList);
  expect(screen.getAllByTestId('zoomable-image')).toHaveLength(1);
  expect(screen.getByTestId('zoomable-image').props).toMatchObject({ uri: '1.jpg', cacheKey: 'one' });
  const placeholder = list.props.renderItem({ item: '0.jpg', index: 0 });
  expect(placeholder.type).toBe(View);
  expect(placeholder.props.style).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
  const pageWidth = list.props.getItemLayout(null, 2).length;
  fireEvent.scroll(list, { nativeEvent: { contentOffset: { x: pageWidth * 2, y: 0 } } });
  expect(screen.getAllByTestId('zoomable-image')).toHaveLength(1);
  expect(screen.getByTestId('zoomable-image').props).toMatchObject({ uri: '2.jpg', cacheKey: 'two' });
});

test('does not interrupt a horizontal drag when the parent tracks the selected message', () => {
  const scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex');
  function TrackedViewer() {
    const [index, setIndex] = React.useState(0);
    return <ImageViewer images={['0.jpg', '1.jpg']} visible initialIndex={index} onIndexChange={setIndex} onClose={jest.fn()} />;
  }
  render(<TrackedViewer />);
  scrollToIndex.mockClear();
  fireEvent.scroll(screen.UNSAFE_getByType(FlatList), { nativeEvent: { contentOffset: { x: 750, y: 0 } } });
  expect(scrollToIndex).not.toHaveBeenCalled();
  scrollToIndex.mockRestore();
});

test('horizontal paging changes the photo, then swiping down returns to the conversation', () => {
  const onIndexChange = jest.fn();
  function Conversation() {
    const [visible, setVisible] = React.useState(true);
    return (
      <View testID="conversation">
        <ImageViewer images={['0.jpg', '1.jpg']} visible={visible}
          onIndexChange={onIndexChange} onClose={() => setVisible(false)} />
      </View>
    );
  }
  render(<Conversation />);
  const list = screen.UNSAFE_getByType(FlatList);
  const pageWidth = list.props.getItemLayout(null, 1).offset;
  fireEvent.scroll(list, { nativeEvent: { contentOffset: { x: pageWidth, y: 0 } } });
  expect(onIndexChange).toHaveBeenCalledTimes(1);
  expect(onIndexChange).toHaveBeenLastCalledWith(1);
  const current = screen.getAllByTestId('zoomable-image').find((image) => image.props.active)!;
  expect(current.props.uri).toBe('1.jpg');

  fireEvent(current, 'swipeDown');
  expect(screen.queryByTestId('zoomable-image')).toBeNull();
  expect(screen.getByTestId('conversation')).toBeTruthy();
  expect(onIndexChange).toHaveBeenCalledTimes(1);
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

test('save menu hides the viewer controls from Android accessibility focus', () => {
  render(
    <ImageViewer
      images={['https://example.test/ordinary.jpg']}
      visible
      onClose={jest.fn()}
    />,
  );

  const viewerContent = screen.getByTestId('image-viewer-content');
  expect(viewerContent.props.importantForAccessibility).toBe('auto');

  act(() => {
    fireEvent(screen.getByTestId('zoomable-image'), 'longPress');
  });

  expect(viewerContent.props.importantForAccessibility).toBe('no-hide-descendants');
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

test('ignores old page zoom callbacks and clears the old page lock during paging', () => {
  render(<ImageViewer images={['0.jpg', '1.jpg']} visible onClose={jest.fn()} />);
  const list = screen.UNSAFE_getByType(FlatList);
  const current = screen.getByTestId('zoomable-image');
  const onOldPageZoomedChange = current.props.onZoomedChange;
  act(() => onOldPageZoomedChange(true));
  expect(list.props.scrollEnabled).toBe(false);
  fireEvent.scroll(list, { nativeEvent: { contentOffset: { x: 750, y: 0 } } });
  expect(list.props.scrollEnabled).toBe(true);
  const next = screen.getAllByTestId('zoomable-image').find((image) => image.props.active);
  act(() => next!.props.onZoomedChange(true));
  act(() => onOldPageZoomedChange(false));
  expect(list.props.scrollEnabled).toBe(false);
});

test('keeps upload progress visible inside its existing native modal', () => {
  render(<ImageViewer images={['image.jpg']} visible onClose={jest.fn()} />);
  expect(screen.getByTestId('upload-progress-modal-host')).toBeTruthy();
});

describe('video pages', () => {
  const mixed = {
    images: ['photo.jpg', 'poster.jpg'],
    cacheKeys: ['photo-key', 'poster-key'],
    videos: [undefined, 'https://example.test/clip.mp4'],
    visible: true,
    onClose: jest.fn(),
  };
  const pageTo = (x: number) => fireEvent.scroll(screen.UNSAFE_getByType(FlatList), { nativeEvent: { contentOffset: { x, y: 0 } } });
  const width = () => screen.UNSAFE_getByType(FlatList).props.getItemLayout(null, 1).offset as number;

  test('a swipe from a photo lands on a video page with its source and poster', () => {
    render(<ImageViewer {...mixed} />);
    pageTo(width());
    const page = screen.getByTestId('viewer-video-page');
    expect(page.props.videoUrl).toBe('https://example.test/clip.mp4');
    expect(page.props.posterUrl).toBe('poster.jpg');
    expect(page.props.posterCacheKey).toBe('poster-key');
    expect(page.props.autoPlay).toBe(false);
    expect(screen.queryByTestId('zoomable-image')).toBeNull();
  });

  test('a video without a poster reaches the page with no poster source', () => {
    render(<ImageViewer {...mixed} images={['photo.jpg', '']} initialIndex={1} />);
    expect(screen.getByTestId('viewer-video-page').props.posterUrl).toBeUndefined();
  });

  test('the privacy mode of each video page reaches it', () => {
    render(<ImageViewer {...mixed} initialIndex={1} privacyModes={['standard', 'ephemeral']} />);
    expect(screen.getByTestId('viewer-video-page').props.ephemeral).toBe(true);
  });

  test('the tapped video auto-plays once and does not restart after swiping back', () => {
    render(<ImageViewer {...mixed} initialIndex={1} autoPlayInitialVideo />);
    expect(screen.getByTestId('viewer-video-page').props.autoPlay).toBe(true);
    pageTo(0);
    expect(screen.queryByTestId('viewer-video-page')).toBeNull();
    pageTo(width());
    expect(screen.getByTestId('viewer-video-page').props.autoPlay).toBe(false);
  });

  test('page swipes stay blocked exactly while the video page holds the pager', () => {
    render(<ImageViewer {...mixed} initialIndex={1} />);
    const list = screen.UNSAFE_getByType(FlatList);
    expect(list.props.scrollEnabled).toBe(true);
    act(() => screen.getByTestId('viewer-video-page').props.onPagerLockChange(true));
    expect(list.props.scrollEnabled).toBe(false);
    act(() => screen.getByTestId('viewer-video-page').props.onPagerLockChange(false));
    expect(list.props.scrollEnabled).toBe(true);
  });

  test('swiping down on a video page closes the viewer', () => {
    const onClose = jest.fn();
    render(<ImageViewer {...mixed} initialIndex={1} onClose={onClose} />);
    fireEvent(screen.getByTestId('viewer-video-page'), 'swipeDown');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('a rotated signed poster URL keeps the running video page mounted', () => {
    const view = render(<ImageViewer {...mixed} initialIndex={1} />);
    mockVideoPageMounts = 0;
    view.rerender(<ImageViewer {...mixed} initialIndex={1} images={['photo.jpg', 'poster.jpg?sig=new']} />);
    expect(mockVideoPageMounts).toBe(0);
    expect(screen.getByTestId('viewer-video-page').props.posterUrl).toBe('poster.jpg?sig=new');
  });
});
