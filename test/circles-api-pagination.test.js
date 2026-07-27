const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function loadCirclesApi(apiClient) {
  const cursorPages = loadTsModule(
    'src/services/api/collect-cursor-pages.ts',
  );
  return loadTsModule('src/services/api/circles.ts', {
    requireShim: (specifier) => {
      if (specifier === '@/services/api/client') return { apiClient };
      if (specifier === '@/services/api/utils') {
        return {
          buildQuery: (params) => {
            const query = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
              if (value !== undefined && value !== null && value !== '') {
                query.set(key, String(value));
              }
            }
            const encoded = query.toString();
            return encoded ? `?${encoded}` : '';
          },
          normalizeMediaUrl: (value) => value ?? null,
        };
      }
      if (specifier === './collect-cursor-pages') return cursorPages;
      throw new Error(`unexpected import: ${specifier}`);
    },
    context: { URLSearchParams },
  });
}

test('fetchMyCircles requests every cursor page and returns the full list', async () => {
  const urls = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: `circle-${index}`,
  }));
  const api = loadCirclesApi(async (url) => {
    urls.push(url);
    return urls.length === 1 ? firstPage : [{ id: 'circle-100' }];
  });

  const result = await api.fetchMyCircles('joined');

  assert.deepEqual(urls, [
    '/circle/my?tab=joined&limit=100',
    '/circle/my?tab=joined&limit=100&cursor=circle-99',
  ]);
  assert.equal(result.length, 101);
  assert.equal(result.at(-1).id, 'circle-100');
});

test('fetchMyCircles rejects rather than returning a partial authority set', async () => {
  let calls = 0;
  const api = loadCirclesApi(async () => {
    calls += 1;
    if (calls === 1) {
      return Array.from({ length: 100 }, (_, index) => ({
        id: `circle-${index}`,
      }));
    }
    throw new Error('page unavailable');
  });

  await assert.rejects(api.fetchMyCircles('created'), /page unavailable/);
});
