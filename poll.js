// Poll logic — pure module, no Chrome API dependency.
// Input: settings + fetcher. Output: results + badge count.
// Supports multiple tokens: polls each token concurrently and merges results.

import { computeAttentionSet, isBot } from './attention.js';

/**
 * Fetch helper that throws on non-OK responses.
 */
async function ghFetch(path, token, fetcher = fetch) {
  const res = await fetcher(`https://api.github.com${path}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

/**
 * Migrate old storage format to new tokens array.
 */
export function migrateTokens(stored) {
  if (stored.tokens && Array.isArray(stored.tokens) && stored.tokens.length > 0) {
    return stored.tokens;
  }
  if (stored.token) {
    return [{ name: 'Default', token: stored.token }];
  }
  return [];
}

/**
 * Poll a single token: fetch user, PRs, timelines, compute attention sets.
 * Returns { results, username }
 */
async function pollSingleToken(tokenEntry, settings, fetcher) {
  const { token, name } = tokenEntry;
  const user = await ghFetch('/user', token, fetcher);
  const username = user.login;

  const prs = await ghFetch(`/search/issues?q=involves:${username}+is:pr+is:open&per_page=50`, token, fetcher);

  const CONCURRENCY = 6;
  const items = prs.items || [];
  const results = [];

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (pr) => {
      const [owner, repo] = pr.repository_url.replace('https://api.github.com/repos/', '').split('/');
      const number = pr.number;

      let timeline;
      try {
        timeline = await ghFetch(`/repos/${owner}/${repo}/issues/${number}/timeline?per_page=100`, token, fetcher);
      } catch { timeline = []; }

      const attention = computeAttentionSet(timeline, username, pr.user.login, settings.debounceMinutes);

      let lastEventAt = 0;
      for (const event of timeline) {
        const ts = new Date(event.created_at || event.submitted_at || 0).getTime();
        if (ts > lastEventAt) lastEventAt = ts;
      }

      return {
        id: pr.id,
        number,
        title: pr.title,
        url: pr.html_url,
        repo: `${owner}/${repo}`,
        author: pr.user.login,
        attentionSet: attention.set,
        myStatus: attention.myStatus,
        lastEventAt,
        account: name || username,
      };
    }));
    results.push(...batchResults);
  }

  return { results, username };
}

/**
 * Core poll logic: fetch PRs for all tokens, merge, deduplicate, return results.
 * @param {object} settings - { token?, tokens?, debounceMinutes, pollMinutes, notifications }
 * @param {object} opts - { fetcher, repoFilterMode, repoFilterList, dismissed }
 * @returns {{ results, username, usernames, needsAttention, filteredResults, error? }}
 */
export async function poll(settings, opts = {}) {
  const { fetcher = fetch, repoFilterMode = 'all', repoFilterList = '', dismissed = {} } = opts;

  // Resolve tokens array (backward compat)
  const tokens = migrateTokens(settings);
  if (tokens.length === 0) {
    return { results: [], username: null, usernames: [], needsAttention: 0, filteredResults: [], error: null };
  }

  // Poll all tokens concurrently
  const tokenResults = await Promise.all(
    tokens.map(entry => pollSingleToken(entry, settings, fetcher))
  );

  // Merge and deduplicate by PR URL (first occurrence wins — keeps attention from first token that sees it)
  const seen = new Set();
  const mergedResults = [];
  const usernames = [];

  for (const { results, username } of tokenResults) {
    if (!usernames.includes(username)) usernames.push(username);
    for (const pr of results) {
      if (!seen.has(pr.url)) {
        seen.add(pr.url);
        mergedResults.push(pr);
      }
    }
  }

  // Apply repo filter
  const filteredResults = applyRepoFilter(mergedResults, repoFilterMode, repoFilterList);

  // Badge count: red status and not dismissed
  const needsAttention = filteredResults.filter(r => r.myStatus === 'red' && !dismissed[r.url]).length;

  return { results: mergedResults, username: usernames[0] || null, usernames, needsAttention, filteredResults, error: null };
}

export function applyRepoFilter(results, mode, repoListStr) {
  if (!mode || mode === 'all' || !repoListStr.trim()) return results;
  const repos = new Set(repoListStr.split('\n').map(r => r.trim().toLowerCase()).filter(Boolean));
  if (repos.size === 0) return results;
  if (mode === 'include') return results.filter(r => repos.has(r.repo.toLowerCase()));
  if (mode === 'exclude') return results.filter(r => !repos.has(r.repo.toLowerCase()));
  return results;
}
