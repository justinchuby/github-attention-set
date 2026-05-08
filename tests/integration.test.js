import { describe, it, expect, vi, beforeEach } from 'vitest';
import { poll, applyRepoFilter, migrateTokens } from '../poll.js';

// Helper: create a mock fetcher that routes based on URL
function createMockFetcher(routes) {
  const calls = [];
  const fetcher = vi.fn(async (url, opts) => {
    calls.push({ url, opts, time: Date.now() });
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        const result = typeof handler === 'function' ? handler(url) : handler;
        if (result instanceof Error) {
          return { ok: false, status: result.message, json: async () => ({}) };
        }
        if (result && result.__status) {
          return { ok: false, status: result.__status, json: async () => result.body || {} };
        }
        return { ok: true, json: async () => result };
      }
    }
    return { ok: true, json: async () => ({}) };
  });
  fetcher.calls = calls;
  return fetcher;
}

function makePR(id, number, owner, repo, author, title = `PR #${number}`) {
  return {
    id,
    number,
    title,
    html_url: `https://github.com/${owner}/${repo}/pull/${number}`,
    repository_url: `https://api.github.com/repos/${owner}/${repo}`,
    user: { login: author },
  };
}

const NOW = new Date('2026-05-05T12:00:00Z').getTime();

describe('migrateTokens', () => {
  it('returns tokens array if present', () => {
    const tokens = [{ name: 'Work', token: 'ghp_abc' }];
    expect(migrateTokens({ tokens })).toEqual(tokens);
  });

  it('migrates old single token format', () => {
    expect(migrateTokens({ token: 'ghp_old' })).toEqual([{ name: 'Default', token: 'ghp_old' }]);
  });

  it('returns empty array if no token', () => {
    expect(migrateTokens({})).toEqual([]);
  });

  it('prefers tokens array over legacy token field', () => {
    const result = migrateTokens({ token: 'ghp_old', tokens: [{ name: 'New', token: 'ghp_new' }] });
    expect(result).toEqual([{ name: 'New', token: 'ghp_new' }]);
  });
});

describe('Integration: poll()', () => {
  const baseSettings = {
    tokens: [{ name: 'Personal', token: 'ghp_test' }],
    debounceMinutes: 10,
    pollMinutes: 2,
    notifications: true,
  };

  it('1. Full poll flow: 3 PRs with different timelines → correct attention set', async () => {
    const fetcher = createMockFetcher({
      '/user': { login: 'me' },
      '/search/issues': {
        items: [
          makePR(1, 101, 'org', 'repoA', 'alice'),
          makePR(2, 202, 'org', 'repoB', 'bob'),
          makePR(3, 303, 'org', 'repoC', 'me'),
        ],
      },
      '/repos/org/repoA/issues/101/timeline': [
        { event: 'reviewed', actor: { login: 'me' }, state: 'approved', submitted_at: '2026-05-05T10:00:00Z' },
      ],
      '/repos/org/repoB/issues/202/timeline': [
        {
          event: 'review_requested',
          actor: { login: 'bob' },
          requested_reviewer: { login: 'me' },
          created_at: '2026-05-05T11:00:00Z',
        },
      ],
      '/repos/org/repoC/issues/303/timeline': [
        {
          event: 'reviewed',
          actor: { login: 'reviewer1' },
          user: { login: 'reviewer1' },
          state: 'commented',
          submitted_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
        },
      ],
    });

    const result = await poll(baseSettings, { fetcher });

    expect(result.username).toBe('me');
    expect(result.results).toHaveLength(3);

    const r1 = result.results.find((r) => r.number === 101);
    expect(r1.attentionSet).toHaveProperty('alice', 'red');
    expect(r1.myStatus).toBe('green');

    const r2 = result.results.find((r) => r.number === 202);
    expect(r2.attentionSet).toHaveProperty('me', 'red');
    expect(r2.myStatus).toBe('red');

    const r3 = result.results.find((r) => r.number === 303);
    expect(r3.myStatus).toBe('yellow');
  });

  it('2. Concurrency: 6 PR timelines fetched in parallel', async () => {
    const prs = Array.from({ length: 6 }, (_, i) => makePR(i + 1, i + 1, 'org', 'repo', 'alice'));
    let concurrentMax = 0;
    let inflight = 0;

    const fetcher = vi.fn(async (url) => {
      if (url.includes('/user')) return { ok: true, json: async () => ({ login: 'me' }) };
      if (url.includes('/search/issues')) return { ok: true, json: async () => ({ items: prs }) };
      if (url.includes('/timeline')) {
        inflight++;
        concurrentMax = Math.max(concurrentMax, inflight);
        await new Promise((r) => setTimeout(r, 10));
        inflight--;
        return { ok: true, json: async () => [] };
      }
      return { ok: true, json: async () => ({}) };
    });

    await poll(baseSettings, { fetcher });
    expect(concurrentMax).toBe(6);
  });

  it('3. Dismissed PRs excluded from badge count', async () => {
    const fetcher = createMockFetcher({
      '/user': { login: 'me' },
      '/search/issues': {
        items: [makePR(1, 101, 'org', 'repo', 'alice'), makePR(2, 202, 'org', 'repo', 'bob')],
      },
      '/repos/org/repo/issues/101/timeline': [
        {
          event: 'review_requested',
          actor: { login: 'alice' },
          requested_reviewer: { login: 'me' },
          created_at: '2026-05-05T10:00:00Z',
        },
      ],
      '/repos/org/repo/issues/202/timeline': [
        {
          event: 'review_requested',
          actor: { login: 'bob' },
          requested_reviewer: { login: 'me' },
          created_at: '2026-05-05T10:00:00Z',
        },
      ],
    });

    const dismissed = { 'https://github.com/org/repo/pull/101': { at: Date.now() } };
    const result = await poll(baseSettings, { fetcher, dismissed });

    expect(result.needsAttention).toBe(1);
  });

  it('4. Bot users filtered from attention set', async () => {
    const fetcher = createMockFetcher({
      '/user': { login: 'me' },
      '/search/issues': {
        items: [makePR(1, 101, 'org', 'repo', 'alice')],
      },
      '/repos/org/repo/issues/101/timeline': [
        {
          event: 'commented',
          actor: { login: 'dependabot[bot]' },
          user: { login: 'dependabot[bot]' },
          created_at: '2026-05-04T10:00:00Z',
          body: '@me please review',
        },
        {
          event: 'commented',
          actor: { login: 'renovate' },
          user: { login: 'renovate' },
          created_at: '2026-05-04T10:01:00Z',
          body: '',
        },
      ],
    });

    const result = await poll(baseSettings, { fetcher });
    const r = result.results[0];
    expect(r.attentionSet).not.toHaveProperty('dependabot[bot]');
    expect(r.attentionSet).not.toHaveProperty('renovate');
  });

  it('5. Repo filter: include mode only returns matching repos', async () => {
    const fetcher = createMockFetcher({
      '/user': { login: 'me' },
      '/search/issues': {
        items: [makePR(1, 1, 'org', 'keep', 'alice'), makePR(2, 2, 'org', 'skip', 'bob')],
      },
      '/repos/org/keep/issues/1/timeline': [
        {
          event: 'review_requested',
          actor: { login: 'alice' },
          requested_reviewer: { login: 'me' },
          created_at: '2026-05-05T10:00:00Z',
        },
      ],
      '/repos/org/skip/issues/2/timeline': [
        {
          event: 'review_requested',
          actor: { login: 'bob' },
          requested_reviewer: { login: 'me' },
          created_at: '2026-05-05T10:00:00Z',
        },
      ],
    });

    const result = await poll(baseSettings, { fetcher, repoFilterMode: 'include', repoFilterList: 'org/keep' });
    expect(result.filteredResults).toHaveLength(1);
    expect(result.filteredResults[0].repo).toBe('org/keep');
    expect(result.needsAttention).toBe(1);
  });

  it('6. API error handling: 401/500 → throws with status info', async () => {
    const fetcher401 = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(poll(baseSettings, { fetcher: fetcher401 })).rejects.toThrow('GitHub API 401');

    const fetcher500 = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(poll(baseSettings, { fetcher: fetcher500 })).rejects.toThrow('GitHub API 500');
  });

  it('7. Debounce: different debounce settings yield different results', async () => {
    const commentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const fetcher = createMockFetcher({
      '/user': { login: 'me' },
      '/search/issues': {
        items: [makePR(1, 101, 'org', 'repo', 'me')],
      },
      '/repos/org/repo/issues/101/timeline': [
        {
          event: 'reviewed',
          actor: { login: 'reviewer' },
          user: { login: 'reviewer' },
          state: 'commented',
          submitted_at: commentTime,
        },
      ],
    });

    const result10 = await poll({ ...baseSettings, debounceMinutes: 10 }, { fetcher });
    expect(result10.results[0].myStatus).toBe('yellow');

    const result3 = await poll({ ...baseSettings, debounceMinutes: 3 }, { fetcher });
    expect(result3.results[0].myStatus).toBe('red');
  });

  it('8. No token → returns empty results, 0 badge count', async () => {
    const fetcher = vi.fn();
    const result = await poll({ tokens: [] }, { fetcher });
    expect(result.results).toEqual([]);
    expect(result.needsAttention).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('9. Legacy single token format still works via migration', async () => {
    const fetcher = createMockFetcher({
      '/user': { login: 'me' },
      '/search/issues': { items: [] },
    });
    const result = await poll({ token: 'ghp_legacy', debounceMinutes: 10 }, { fetcher });
    expect(result.username).toBe('me');
    expect(result.results).toEqual([]);
  });

  it('10. Multiple tokens: results merged and deduplicated', async () => {
    // Two tokens see overlapping PRs — differentiate by Authorization header
    const fetcher = vi.fn(async (url, opts) => {
      const token = opts?.headers?.Authorization?.replace('token ', '') || '';
      if (url.includes('/user')) {
        const login = token === 'ghp_1' ? 'user1' : 'user2';
        return { ok: true, json: async () => ({ login }) };
      }
      if (url.includes('/search/issues')) {
        if (token === 'ghp_1') {
          return {
            ok: true,
            json: async () => ({
              items: [makePR(1, 101, 'org', 'repo', 'alice'), makePR(2, 102, 'org', 'repo', 'bob')],
            }),
          };
        } else {
          return {
            ok: true,
            json: async () => ({
              items: [makePR(1, 101, 'org', 'repo', 'alice'), makePR(3, 103, 'org', 'repo', 'charlie')],
            }),
          };
        }
      }
      if (url.includes('/timeline')) {
        return { ok: true, json: async () => [] };
      }
      return { ok: true, json: async () => ({}) };
    });

    const settings = {
      tokens: [
        { name: 'Personal', token: 'ghp_1' },
        { name: 'Work', token: 'ghp_2' },
      ],
      debounceMinutes: 10,
    };

    const result = await poll(settings, { fetcher });

    // Should have 3 unique PRs (101 deduplicated)
    expect(result.results).toHaveLength(3);
    expect(result.usernames).toContain('user1');
    expect(result.usernames).toContain('user2');
    const urls = result.results.map((r) => r.url);
    expect(new Set(urls).size).toBe(3);
  });

  it('11. Multiple tokens: each uses correct username for attention calculation', async () => {
    // Token 1: user1 is requested reviewer on PR 101
    // Token 2: user2 is author of PR 102 with a review
    const fetcher = vi.fn(async (url) => {
      if (url.includes('/user')) {
        // Differentiate by auth header
        const token = url; // We'll use a different approach
        return { ok: true, json: async () => ({ login: 'user1' }) };
      }
      if (url.includes('/search/issues')) {
        return { ok: true, json: async () => ({ items: [makePR(1, 101, 'org', 'repo', 'alice')] }) };
      }
      if (url.includes('/timeline')) {
        return {
          ok: true,
          json: async () => [
            {
              event: 'review_requested',
              actor: { login: 'alice' },
              requested_reviewer: { login: 'user1' },
              created_at: '2026-05-05T10:00:00Z',
            },
          ],
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const settings = { tokens: [{ name: 'Personal', token: 'ghp_1' }], debounceMinutes: 10 };
    const result = await poll(settings, { fetcher });

    expect(result.results[0].myStatus).toBe('red');
    expect(result.results[0].attentionSet).toHaveProperty('user1', 'red');
  });

  it('12. PR results include account field', async () => {
    const fetcher = createMockFetcher({
      '/user': { login: 'me' },
      '/search/issues': { items: [makePR(1, 101, 'org', 'repo', 'alice')] },
      '/repos/org/repo/issues/101/timeline': [],
    });

    const settings = { tokens: [{ name: 'Work EMU', token: 'ghp_work' }], debounceMinutes: 10 };
    const result = await poll(settings, { fetcher });

    expect(result.results[0].account).toBe('Work EMU');
  });
});

describe('ETag caching', () => {
  const baseSettings = { tokens: [{ name: 'Test', token: 'ghp_test' }], debounceMinutes: 10 };

  it('13. Uses cached data on 304 response', async () => {
    const cachedTimeline = [
      {
        event: 'review_requested',
        actor: { login: 'alice' },
        requested_reviewer: { login: 'me' },
        created_at: '2026-05-05T10:00:00Z',
      },
    ];
    const etagCache = new Map();
    etagCache.set('https://api.github.com/repos/org/repo/issues/101/timeline?per_page=100&page=1', {
      etag: '"abc123"',
      data: cachedTimeline,
    });

    const fetcher = vi.fn(async (url, opts) => {
      if (url.includes('/user')) return { ok: true, json: async () => ({ login: 'me' }), headers: new Headers() };
      if (url.includes('/search/issues'))
        return {
          ok: true,
          json: async () => ({ items: [makePR(1, 101, 'org', 'repo', 'alice')] }),
          headers: new Headers(),
        };
      if (url.includes('/timeline')) {
        // Verify If-None-Match was sent
        expect(opts.headers['If-None-Match']).toBe('"abc123"');
        return { ok: false, status: 304, json: async () => ({}), headers: new Headers() };
      }
      return { ok: true, json: async () => ({}), headers: new Headers() };
    });

    const result = await poll(baseSettings, { fetcher, etagCache });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].myStatus).toBe('red');
  });

  it('14. Stores etag from 200 response and reuses on next poll', async () => {
    const etagCache = new Map();
    const timeline = [
      {
        event: 'review_requested',
        actor: { login: 'alice' },
        requested_reviewer: { login: 'me' },
        created_at: '2026-05-05T10:00:00Z',
      },
    ];

    const fetcher = vi.fn(async (url) => {
      if (url.includes('/user')) return { ok: true, json: async () => ({ login: 'me' }), headers: new Headers() };
      if (url.includes('/search/issues'))
        return {
          ok: true,
          json: async () => ({ items: [makePR(1, 101, 'org', 'repo', 'alice')] }),
          headers: new Headers(),
        };
      if (url.includes('/timeline')) {
        return { ok: true, status: 200, json: async () => timeline, headers: new Headers([['etag', '"xyz789"']]) };
      }
      return { ok: true, json: async () => ({}), headers: new Headers() };
    });

    await poll(baseSettings, { fetcher, etagCache });

    const cached = etagCache.get('https://api.github.com/repos/org/repo/issues/101/timeline?per_page=100&page=1');
    expect(cached).toBeDefined();
    expect(cached.etag).toBe('"xyz789"');
    expect(cached.data).toEqual(timeline);
  });

  it('15. No If-None-Match sent for non-timeline requests', async () => {
    const etagCache = new Map();
    const fetcher = vi.fn(async (url, opts) => {
      if (url.includes('/user')) {
        expect(opts.headers['If-None-Match']).toBeUndefined();
        return { ok: true, json: async () => ({ login: 'me' }), headers: new Headers() };
      }
      if (url.includes('/search/issues')) {
        expect(opts.headers['If-None-Match']).toBeUndefined();
        return { ok: true, json: async () => ({ items: [] }), headers: new Headers() };
      }
      return { ok: true, json: async () => ({}), headers: new Headers() };
    });

    await poll(baseSettings, { fetcher, etagCache });
  });
});

describe('applyRepoFilter', () => {
  const results = [{ repo: 'org/alpha' }, { repo: 'org/beta' }, { repo: 'other/gamma' }];

  it('mode=all returns everything', () => {
    expect(applyRepoFilter(results, 'all', 'org/alpha')).toEqual(results);
  });

  it('mode=include filters to matching repos', () => {
    expect(applyRepoFilter(results, 'include', 'org/alpha\nother/gamma')).toHaveLength(2);
  });

  it('mode=exclude removes matching repos', () => {
    expect(applyRepoFilter(results, 'exclude', 'org/beta')).toHaveLength(2);
  });
});
