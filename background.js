// GitHub Attention Set — Background Service Worker

import { computeAttentionSet } from './attention.js';
import { migrateTokens } from './poll.js';

const DEFAULT_POLL_INTERVAL = 2; // minutes
const DEFAULT_DEBOUNCE = 10; // minutes

// In-memory ETag cache for timeline requests
const etagCache = new Map();

// Load persisted ETag cache on startup
chrome.storage.local.get('timelineCache', (stored) => {
  if (stored.timelineCache) {
    for (const [url, entry] of Object.entries(stored.timelineCache)) {
      etagCache.set(url, entry);
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('poll', { periodInMinutes: DEFAULT_POLL_INTERVAL });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'poll') await pollAndCompute();
});

// Also poll on startup
pollAndCompute();

async function getSettings() {
  const defaults = {
    token: '',
    tokens: null,
    debounceMinutes: DEFAULT_DEBOUNCE,
    pollMinutes: DEFAULT_POLL_INTERVAL,
    notifications: true,
  };
  return new Promise((r) => chrome.storage.local.get(defaults, r));
}

async function ghFetch(path, token, { useEtag = false } = {}) {
  const url = `https://api.github.com${path}`;
  const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };

  if (useEtag) {
    const cached = etagCache.get(url);
    if (cached?.etag) {
      headers['If-None-Match'] = cached.etag;
    }
  }

  const res = await fetch(url, { headers });

  if (useEtag && res.status === 304) {
    const cached = etagCache.get(url);
    if (cached?.data) return cached.data;
    // 304 but no cached data — re-fetch without ETag
    const retry = await fetch(url, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (!retry.ok) throw new Error(`GitHub API ${retry.status}`);
    return retry.json();
  }

  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();

  if (useEtag) {
    const etag = res.headers.get('etag');
    if (etag) {
      etagCache.set(url, { etag, data });
    }
  }

  return data;
}

async function pollSingleToken(
  tokenEntry,
  debounceMinutes,
  { onlyDirectRequests = false, whitelistedTeams = [] } = {},
) {
  const { token, name } = tokenEntry;
  const user = await ghFetch('/user', token);
  const username = user.login;

  const prs = await ghFetch(`/search/issues?q=involves:${username}+is:pr+is:open&per_page=50`, token);

  const CONCURRENCY = 10;
  const items = prs.items || [];
  const results = [];

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (pr) => {
        const [owner, repo] = pr.repository_url.replace('https://api.github.com/repos/', '').split('/');
        const number = pr.number;

        let timeline;
        try {
          // Paginate timeline (max 3 pages = 300 events)
          timeline = [];
          for (let page = 1; page <= 3; page++) {
            const batch = await ghFetch(
              `/repos/${owner}/${repo}/issues/${number}/timeline?per_page=100&page=${page}`,
              token,
              { useEtag: true },
            );
            timeline.push(...batch);
            if (batch.length < 100) break; // no more pages
          }
        } catch {
          timeline = [];
        }

        const attention = computeAttentionSet(timeline, username, pr.user.login, debounceMinutes, undefined, {
          onlyDirectRequests,
          whitelistedTeams,
        });

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
          reviewerStates: attention.reviewerStates,
          allReviewers: attention.allReviewers,
          myStatus: attention.myStatus,
          prState: attention.prState,
          myReason: attention.myReason,
          myRole: attention.myRole,
          incomingDetail: attention.incomingDetail,
          lastEventAt,
          account: name || username,
        };
      }),
    );
    results.push(...batchResults);
  }

  return { results, username };
}

async function pollAndCompute() {
  const settings = await getSettings();
  const tokens = migrateTokens(settings);
  const { onlyDirectRequests, whitelistedTeams } = await new Promise((r) =>
    chrome.storage.local.get({ onlyDirectRequests: false, whitelistedTeams: [] }, r),
  );

  if (tokens.length === 0) {
    setBadge(0);
    return;
  }

  try {
    // Poll all tokens concurrently
    const tokenResults = await Promise.all(
      tokens.map((entry) => pollSingleToken(entry, settings.debounceMinutes, { onlyDirectRequests, whitelistedTeams })),
    );

    // Merge and deduplicate by PR URL
    const seen = new Set();
    const results = [];
    const usernames = [];

    for (const { results: tokenPRs, username } of tokenResults) {
      if (!usernames.includes(username)) usernames.push(username);
      for (const pr of tokenPRs) {
        if (!seen.has(pr.url)) {
          seen.add(pr.url);
          results.push(pr);
        }
      }
    }

    // Persist ETag cache and clean up stale entries
    const openTimelineUrls = new Set();
    for (const pr of results) {
      const [owner, repo] = pr.url.replace('https://github.com/', '').split('/pull/')[0].split('/');
      for (let page = 1; page <= 3; page++) {
        openTimelineUrls.add(
          `https://api.github.com/repos/${owner}/${repo}/issues/${pr.number}/timeline?per_page=100&page=${page}`,
        );
      }
    }
    for (const url of etagCache.keys()) {
      if (!openTimelineUrls.has(url)) etagCache.delete(url);
    }
    const cacheObj = Object.fromEntries(etagCache);
    chrome.storage.local.set({ timelineCache: cacheObj });

    await chrome.storage.local.set({ results, username: usernames[0] || '', usernames, lastPoll: Date.now() });

    // Apply repo filter
    const { repoFilterMode, repoFilterList } = await new Promise((r) =>
      chrome.storage.local.get({ repoFilterMode: 'all', repoFilterList: '' }, r),
    );
    let filteredResults = applyRepoFilter(results, repoFilterMode, repoFilterList);

    // Apply mute filter
    const { mutedRepos = [], mutedOwners = [] } = await new Promise((r) =>
      chrome.storage.local.get({ mutedRepos: [], mutedOwners: [] }, r),
    );
    if (mutedRepos.length > 0 || mutedOwners.length > 0) {
      const mutedRepoSet = new Set(mutedRepos.map((r) => r.toLowerCase()));
      const mutedOwnerSet = new Set(mutedOwners.map((o) => o.toLowerCase()));
      filteredResults = filteredResults.filter((r) => {
        const repoLower = r.repo.toLowerCase();
        const owner = repoLower.split('/')[0];
        return !mutedRepoSet.has(repoLower) && !mutedOwnerSet.has(owner);
      });
    }

    // Subtract dismissed PRs from badge count
    const dismissed = (await chrome.storage.local.get('dismissed')).dismissed || {};
    const needsAttention = filteredResults.filter((r) => r.myStatus === 'red' && !dismissed[r.url]).length;
    setBadge(needsAttention);

    // Smart notifications: only notify on status changes
    if (settings.notifications !== false) {
      const {
        lastNotifiedPRs = {},
        _notifyNewCommits = false,
        onlyDirectRequests = false,
        _whitelistedTeams = [],
      } = await new Promise((r) =>
        chrome.storage.local.get(
          { lastNotifiedPRs: {}, notifyNewCommits: false, onlyDirectRequests: false, whitelistedTeams: [] },
          r,
        ),
      );
      const currentRedPRs = filteredResults.filter((r) => r.myStatus === 'red' && !dismissed[r.url]);
      // Skip first poll (no previous state) to avoid notifying all existing red PRs
      const isFirstPoll = Object.keys(lastNotifiedPRs).length === 0;
      const newAttentionPRs = isFirstPoll
        ? []
        : currentRedPRs.filter((pr) => {
            const prev = lastNotifiedPRs[pr.url];
            if (prev && prev === 'red') return false; // already notified
            // notifyNewCommits filter: if false, suppress notification when reason is commit-based
            // (This is approximated: if the PR had no status change aside from commit activity)
            // Team filter: if onlyDirectRequests, suppress team-based incoming unless whitelisted
            if (onlyDirectRequests && pr.myRole === 'incoming') {
              // We can't easily distinguish direct vs team here without timeline data.
              // The filtering is done at computeAttentionSet level instead.
              // For now, allow all incoming through notification.
            }
            return true;
          });

      if (newAttentionPRs.length === 1) {
        const pr = newAttentionPRs[0];
        chrome.notifications.create(pr.url, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Attention Set',
          message: `${pr.title} needs your attention`,
        });
      } else if (newAttentionPRs.length > 1) {
        chrome.notifications.create('attention-set-batch', {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Attention Set',
          message: `${newAttentionPRs.length} new PRs need your attention`,
        });
      }

      // Update lastNotifiedPRs map
      const newMap = {};
      for (const pr of filteredResults) {
        if (!dismissed[pr.url]) {
          newMap[pr.url] = pr.myStatus;
        }
      }
      await chrome.storage.local.set({ lastNotifiedPRs: newMap });
    }

    // Cleanup: remove dismissed entries for PRs that are no longer open
    const openUrls = new Set(results.map((r) => r.url));
    const cleanedDismissed = {};
    for (const [url, entry] of Object.entries(dismissed)) {
      if (openUrls.has(url)) cleanedDismissed[url] = entry;
    }
    chrome.storage.local.set({ dismissed: cleanedDismissed });

    // Cleanup: remove dismissedClicked entries for PRs no longer open
    chrome.storage.local.get(['dismissedClicked'], (data) => {
      const clicked = data.dismissedClicked || {};
      const cleanedClicked = {};
      for (const [url, ts] of Object.entries(clicked)) {
        if (openUrls.has(url)) cleanedClicked[url] = ts;
      }
      chrome.storage.local.set({ dismissedClicked: cleanedClicked });
    });

    // Clear any previous error
    chrome.storage.local.remove('lastError');
  } catch (e) {
    console.error('Attention Set poll error:', e);
    const errorMsg = e.message || 'Unknown error';
    let errorType = 'network';
    if (errorMsg.includes('401') || errorMsg.includes('403')) {
      errorType = 'auth';
    } else if (errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503')) {
      errorType = 'server';
    }
    chrome.storage.local.set({ lastError: { type: errorType, message: errorMsg, at: Date.now() } });
  }
}

function applyRepoFilter(results, mode, repoListStr) {
  if (!mode || mode === 'all' || !repoListStr.trim()) return results;
  const repos = new Set(
    repoListStr
      .split('\n')
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean),
  );
  if (repos.size === 0) return results;
  if (mode === 'include') return results.filter((r) => repos.has(r.repo.toLowerCase()));
  if (mode === 'exclude') return results.filter((r) => !repos.has(r.repo.toLowerCase()));
  return results;
}

function setBadge(count) {
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#d73a49' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'attention-set-batch') {
    // Open popup (can't programmatically open popup, so open options or just clear)
    chrome.notifications.clear(notificationId);
  } else {
    // notificationId is the PR URL
    chrome.tabs.create({ url: notificationId });
    chrome.notifications.clear(notificationId);
  }
});

// Listen for messages from popup/content
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'updateBadge') {
    chrome.storage.local.get(['results'], (local) => {
      chrome.storage.local.get(['dismissed'], (synced) => {
        const results = local.results || [];
        const dismissed = synced.dismissed || {};
        const count = results.filter((r) => r.myStatus === 'red' && !dismissed[r.url]).length;
        setBadge(count);
      });
    });
    return;
  }
  if (msg.type === 'refresh') {
    pollAndCompute().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'getData') {
    chrome.storage.local.get(
      ['results', 'username', 'usernames', 'lastPoll', 'repoFilterMode', 'repoFilterList'],
      (local) => {
        chrome.storage.local.get(['dismissed'], (synced) => {
          sendResponse({ ...local, ...synced });
        });
      },
    );
    return true;
  }
});
