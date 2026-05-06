import { describe, it, expect, vi, beforeEach } from 'vitest';
import { poll, applyRepoFilter } from '../poll.js';

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

describe('Integration: poll()', () => {
  const baseSettings = { token: 'ghp_test', debounceMinutes: 10, pollMinutes: 2, notifications: true };

  it('1. Full poll flow: 3 PRs with different timelines → correct attention set', async () => {
    const fetcher = createMockFetcher({
      '/user': { login: 'me' },
      '/search/issues': {
        items: [
          makePR(1, 101, 'org', 'repoA', 'alice'),
          makePR(2, 202, 'org', 'repoB', 'bob'),
          makePR(3, 303, 'org', 'repoC', 'me'),
        ]
      },
      '/repos/org/repoA/issues/101/timeline': [
        { event: 'reviewed', actor: { login: 'me' }, created_at: '2026-05-05T10:00:00Z' },
      ],
      '/repos/org/repoB/issues/202/timeline': [
        { event: 'review_requested', actor: { login: 'bob' }, requested_reviewer: { login: 'me' }, created_at: '2026-05-05T11:00:00Z' },
      ],
      '/repos/org/repoC/issues/303/timeline': [
        { event: 'commented', actor: { login: 'reviewer1' }, user: { login: 'reviewer1' }, created_at: '2026-05-05T11:30:00Z', body: '' },
      ],
    });

    const result = await poll(baseSettings, { fetcher });

    expect(result.username).toBe('me');
    expect(result.results).toHaveLength(3);

    // PR 101: I reviewed → alice (author) should be in attention set
    const r1 = result.results.find(r => r.number === 101);
    expect(r1.attentionSet).toHaveProperty('alice', 'red');
    expect(r1.myStatus).toBe('green');

    // PR 202: review requested for me → I should be red
    const r2 = result.results.find(r => r.number === 202);
    expect(r2.attentionSet).toHaveProperty('me', 'red');
    expect(r2.myStatus).toBe('red');

    // PR 303: someone commented on my PR recently (within debounce) → I'm yellow
    const r3 = result.results.find(r => r.number === 303);
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
        await new Promise(r => setTimeout(r, 10));
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
        items: [
          makePR(1, 101, 'org', 'repo', 'alice'),
          makePR(2, 202, 'org', 'repo', 'bob'),
        ]
      },
      '/repos/org/repo/issues/101/timeline': [
        { event: 'review_requested', actor: { login: 'alice' }, requested_reviewer: { login: 'me' }, created_at: '2026-05-05T10:00:00Z' },
      ],
      '/repos/org/repo/issues/202/timeline': [
        { event: 'review_requested', actor: { login: 'bob' }, requested_reviewer: { login: 'me' }, created_at: '2026-05-05T10:00:00Z' },
      ],
    });

    // Both PRs need attention, but one is dismissed
    const dismissed = { 'https://github.com/org/repo/pull/101': { at: Date.now() } };
    const result = await poll(baseSettings, { fetcher, dismissed });

    expect(result.needsAttention).toBe(1); // only PR 202
  });

  it('4. Bot users filtered from attention set', async () => {
    const fetcher = createMockFetcher({
      '/user': { login: 'me' },
      '/search/issues': {
        items: [makePR(1, 101, 'org', 'repo', 'alice')]
      },
      '/repos/org/repo/issues/101/timeline': [
        { event: 'commented', actor: { login: 'dependabot[bot]' }, user: { login: 'dependabot[bot]' }, created_at: '2026-05-04T10:00:00Z', body: '@me please review' },
        { event: 'commented', actor: { login: 'renovate' }, user: { login: 'renovate' }, created_at: '2026-05-04T10:01:00Z', body: '' },
      ],
    });

    const result = await poll(baseSettings, { fetcher });
    const r = result.results[0];
    // Bots should not appear in attention set
    expect(r.attentionSet).not.toHaveProperty('dependabot[bot]');
    expect(r.attentionSet).not.toHaveProperty('renovate');
  });

  it('5. Repo filter: include mode only returns matching repos', async () => {
    const fetcher = createMockFetcher({
      '/user': { login: 'me' },
      '/search/issues': {
        items: [
          makePR(1, 1, 'org', 'keep', 'alice'),
          makePR(2, 2, 'org', 'skip', 'bob'),
        ]
      },
      '/repos/org/keep/issues/1/timeline': [
        { event: 'review_requested', actor: { login: 'alice' }, requested_reviewer: { login: 'me' }, created_at: '2026-05-05T10:00:00Z' },
      ],
      '/repos/org/skip/issues/2/timeline': [
        { event: 'review_requested', actor: { login: 'bob' }, requested_reviewer: { login: 'me' }, created_at: '2026-05-05T10:00:00Z' },
      ],
    });

    const result = await poll(baseSettings, { fetcher, repoFilterMode: 'include', repoFilterList: 'org/keep' });
    expect(result.filteredResults).toHaveLength(1);
    expect(result.filteredResults[0].repo).toBe('org/keep');
    expect(result.needsAttention).toBe(1);
  });

  it('6. API error handling: 401/500 → throws with status info', async () => {
    // 401 error
    const fetcher401 = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(poll(baseSettings, { fetcher: fetcher401 })).rejects.toThrow('GitHub API 401');

    // 500 error on user endpoint
    const fetcher500 = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(poll(baseSettings, { fetcher: fetcher500 })).rejects.toThrow('GitHub API 500');
  });

  it('7. Debounce: different debounce settings yield different results', async () => {
    // Comment from 5 minutes ago
    const commentTime = new Date(NOW - 5 * 60 * 1000).toISOString();
    const fetcher = createMockFetcher({
      '/user': { login: 'me' },
      '/search/issues': {
        items: [makePR(1, 101, 'org', 'repo', 'me')]
      },
      '/repos/org/repo/issues/101/timeline': [
        { event: 'commented', actor: { login: 'reviewer' }, user: { login: 'reviewer' }, created_at: commentTime, body: '' },
      ],
    });

    // With 10min debounce (comment is 5min old) → yellow (within debounce)
    const result10 = await poll({ ...baseSettings, debounceMinutes: 10 }, { fetcher });
    expect(result10.results[0].myStatus).toBe('yellow');

    // With 3min debounce (comment is 5min old, past debounce) → red
    const result3 = await poll({ ...baseSettings, debounceMinutes: 3 }, { fetcher });
    expect(result3.results[0].myStatus).toBe('red');
  });

  it('8. No token → returns empty results, 0 badge count', async () => {
    const fetcher = vi.fn();
    const result = await poll({ ...baseSettings, token: '' }, { fetcher });
    expect(result.results).toEqual([]);
    expect(result.needsAttention).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('applyRepoFilter', () => {
  const results = [
    { repo: 'org/alpha' },
    { repo: 'org/beta' },
    { repo: 'other/gamma' },
  ];

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
