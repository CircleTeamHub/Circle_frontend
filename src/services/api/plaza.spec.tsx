import { normalizePlazaPost } from './plaza';

jest.mock('@/services/api/client', () => ({ apiClient: jest.fn() }));
jest.mock('@/utils/dev-log', () => ({ devWarn: jest.fn() }));
jest.mock('@/constants/config', () => ({
  API_URL: 'https://api.example.com/api/v1',
  MEDIA_ORIGINS: ['https://cdn.example.com'],
}));

const wirePost = {
  id: 'p1',
  content: 'hi',
  images: [],
  tags: [],
  city: '上海',
  cities: ['上海'],
  isHorn: false,
  noteId: 'note-1',
  restrictions: { vipLevel: null, creditScore: null, fancyNumber: false },
  signupCount: 0,
  signedByMe: false,
  signupRestrictions: { vipLevel: null, creditScore: null, fancyNumber: false },
  canSignup: true,
  canInteract: true,
  author: { id: 'author', nickname: 'A', avatarUrl: null, accountId: 'a1', displayIcons: [] },
  circle: { id: 'c1', name: 'C' },
  circles: [],
  createdAt: '2026-11-15T00:00:00Z',
  expiresAt: '2026-11-16T00:00:00Z',
};

test('the attached note arrives as a renderable note card, with only trusted image hosts', () => {
  const post = normalizePlazaPost({
    ...wirePost,
    noteCard: {
      noteId: 'note-1',
      ownerId: 'author',
      title: '外滩夜景机位',
      contentPreview: '三个机位',
      coverUrl: 'https://cdn.example.com/notes/cover.jpg?sig=1',
      previewUrls: ['https://cdn.example.com/notes/a.jpg?sig=1', 'https://evil.example.net/b.jpg'],
      imageCount: 2,
      videoCount: 1,
      showcaseCount: 1,
      hasText: true,
      hasLocation: true,
      workStatus: 'WORKING',
      publicationStatus: 'ACTIVE',
      somethingElse: 'dropped',
    },
  } as never);
  expect(post.noteCard).toEqual(expect.objectContaining({
    noteId: 'note-1',
    ownerId: 'author',
    title: '外滩夜景机位',
    coverUrl: 'https://cdn.example.com/notes/cover.jpg?sig=1',
    previewUrls: ['https://cdn.example.com/notes/a.jpg?sig=1'],
    imageCount: 2,
    videoCount: 1,
    workStatus: 'WORKING',
    publicationStatus: 'ACTIVE',
  }));
  expect(post.noteCard).not.toHaveProperty('somethingElse');
});

test('no note, an older server without the field, or a card without an id all mean no note card', () => {
  expect(normalizePlazaPost({ ...wirePost, noteId: null, noteCard: null } as never).noteCard).toBeNull();
  expect(normalizePlazaPost(wirePost as never).noteCard).toBeNull();
  expect(normalizePlazaPost({ ...wirePost, noteCard: { title: 'x' } } as never).noteCard).toBeNull();
  expect(normalizePlazaPost({ ...wirePost, noteCard: ['x'] } as never).noteCard).toBeNull();
});
