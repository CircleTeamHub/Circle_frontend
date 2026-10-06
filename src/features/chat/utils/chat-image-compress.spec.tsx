import { manipulateAsync } from 'expo-image-manipulator';
import {
  CHAT_IMAGE_MAX_EDGE,
  planChatImageUpload,
  prepareChatImageForUpload,
} from './chat-image-compress';

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

const mockManipulateAsync = manipulateAsync as jest.MockedFunction<
  typeof manipulateAsync
>;

const photo = {
  uri: 'file:///picked/IMG_0001.HEIC',
  width: 4032,
  height: 3024,
  contentType: 'image/heic',
  filename: 'IMG_0001.HEIC',
};

describe('chat image upload preparation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shrinks a camera photo to the long-edge limit and re-encodes it as JPEG', async () => {
    mockManipulateAsync.mockResolvedValue({
      uri: 'file:///cache/resized.jpg',
      width: 2048,
      height: 1536,
    });

    const prepared = await prepareChatImageForUpload(photo);

    expect(mockManipulateAsync).toHaveBeenCalledTimes(1);
    expect(mockManipulateAsync).toHaveBeenCalledWith(
      photo.uri,
      [{ resize: { width: CHAT_IMAGE_MAX_EDGE } }],
      { compress: 0.82, format: 'jpeg' },
    );
    expect(prepared).toEqual({
      uri: 'file:///cache/resized.jpg',
      width: 2048,
      height: 1536,
      contentType: 'image/jpeg',
      filename: 'IMG_0001.jpg',
    });
  });

  it('limits a portrait photo by its height', () => {
    expect(planChatImageUpload({ ...photo, width: 3024, height: 4032 })).toEqual({
      reencode: true,
      resize: { height: CHAT_IMAGE_MAX_EDGE },
    });
  });

  it('re-encodes a small image without resizing, which also drops its EXIF location', () => {
    expect(
      planChatImageUpload({ ...photo, width: 1080, height: 1920 }),
    ).toEqual({ reencode: true, resize: null });
  });

  it('leaves GIFs alone so they keep animating', async () => {
    const gif = {
      uri: 'file:///picked/party.gif',
      width: 480,
      height: 270,
      contentType: 'image/gif',
      filename: 'party.gif',
    };
    await expect(prepareChatImageForUpload(gif)).resolves.toEqual(gif);
    expect(mockManipulateAsync).not.toHaveBeenCalled();
  });

  it('measures an image of unknown size first and shrinks it when it turns out too large', async () => {
    mockManipulateAsync
      .mockResolvedValueOnce({ uri: 'file:///cache/full.jpg', width: 6000, height: 4000 })
      .mockResolvedValueOnce({ uri: 'file:///cache/small.jpg', width: 2048, height: 1365 });

    const prepared = await prepareChatImageForUpload({
      uri: 'content://media/42',
      contentType: 'image/jpeg',
      filename: '42',
    });

    expect(mockManipulateAsync).toHaveBeenNthCalledWith(
      2,
      'content://media/42',
      [{ resize: { width: CHAT_IMAGE_MAX_EDGE } }],
      { compress: 0.82, format: 'jpeg' },
    );
    expect(prepared).toMatchObject({
      uri: 'file:///cache/small.jpg',
      width: 2048,
      height: 1365,
      filename: '42.jpg',
    });
  });

  it('sends the original when the image cannot be processed', async () => {
    mockManipulateAsync.mockRejectedValue(new Error('decode failed'));
    await expect(prepareChatImageForUpload(photo)).resolves.toEqual(photo);
  });
});
