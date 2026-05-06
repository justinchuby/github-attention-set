// Poll logic — pure module, no Chrome API dependency.
// Input: settings + fetcher. Output: results + badge count.

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
 * Core poll logic: fetch PRs, compute attention sets, return results.
 * @param {object} settings - { token, debounceMinutes, pollMinutes, notifications }
 * @param {object} opts - { fetcher, repoFilterMode, repoFilterList, dismissed }
 * @returns {{ results, username, needsAttention, filteredResults, error? }}
 */
export async function poll(settings, opts = {}) {
  const { fetcher = fetch, repoFilterMode = 'all', repoFilterList = '', dismissed = {} } = opts;

  if (!settings.token) {
    return { results: [], username: null, needsAttention: 0, filteredResults: [], error: null };
  }

  const user = await ghFetch('/user', settings.token, fetcher);
  const username = user.login;

  // Get open PRs involving us
  const prs = await ghFetch(`/search/issues?q=involves:${username}+is:pr+is:open&per_page=50`, settings.token, fetcher);

  // Fetch timelines in parallel (batches of 6)
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
        timeline = await ghFetch(`/repos/${owner}/${repo}/issues/${number}/timeline?per_page=100`, settings.token, fetcher);
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
      };
    }));
    results.push(...batchResults);
  }

  // Apply repo filter
  const filteredResults = applyRepoFilter(results, repoFilterMode, repoFilterList);

  // Badge count: red status and not dismissed
  const needsAttention = filteredResults.filter(r => r.myStatus === 'red' && !dismissed[r.url]).length;

  return { results, username, needsAttention, filteredResults, error: null };
}

export function applyRepoFilter(results, mode, repoListStr) {
  if (!mode || mode === 'all' || !repoListStr.trim()) return results;
  const repos = new Set(repoListStr.split('\n').map(r => r.trim().toLowerCase()).filter(Boolean));
  if (repos.size === 0) return results;
  if (mode === 'include') return results.filter(r => repos.has(r.repo.toLowerCase()));
  if (mode === 'exclude') return results.filter(r => !repos.has(r.repo.toLowerCase()));
  return results;
}
