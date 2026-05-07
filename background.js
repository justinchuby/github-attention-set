// GitHub Attention Set — Background Service Worker

import { computeAttentionSet, isBot } from './attention.js';
import { migrateTokens } from './poll.js';

const DEFAULT_POLL_INTERVAL = 2; // minutes
const DEFAULT_DEBOUNCE = 10; // minutes

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('poll', { periodInMinutes: DEFAULT_POLL_INTERVAL });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'poll') await pollAndCompute();
});

// Also poll on startup
pollAndCompute();

async function getSettings() {
  const defaults = { token: '', tokens: null, debounceMinutes: DEFAULT_DEBOUNCE, pollMinutes: DEFAULT_POLL_INTERVAL, notifications: true };
  return new Promise(r => chrome.storage.local.get(defaults, r));
}

async function ghFetch(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

async function pollSingleToken(tokenEntry, debounceMinutes) {
  const { token, name } = tokenEntry;
  const user = await ghFetch('/user', token);
  const username = user.login;

  const prs = await ghFetch(`/search/issues?q=involves:${username}+is:pr+is:open&per_page=50`, token);

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
        // Paginate timeline (max 3 pages = 300 events)
        timeline = [];
        for (let page = 1; page <= 3; page++) {
          const batch = await ghFetch(`/repos/${owner}/${repo}/issues/${number}/timeline?per_page=100&page=${page}`, token);
          timeline.push(...batch);
          if (batch.length < 100) break; // no more pages
        }
      } catch { timeline = []; }

      const attention = computeAttentionSet(timeline, username, pr.user.login, debounceMinutes);

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
          prState: attention.prState,
          myReason: attention.myReason,
        lastEventAt,
        account: name || username,
      };
    }));
    results.push(...batchResults);
  }

  return { results, username };
}

async function pollAndCompute() {
  const settings = await getSettings();
  const tokens = migrateTokens(settings);

  if (tokens.length === 0) { setBadge(0); return; }

  try {
    // Poll all tokens concurrently
    const tokenResults = await Promise.all(
      tokens.map(entry => pollSingleToken(entry, settings.debounceMinutes))
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

    await chrome.storage.local.set({ results, username: usernames[0] || '', usernames, lastPoll: Date.now() });

    // Apply repo filter
    const { repoFilterMode, repoFilterList } = await new Promise(r => chrome.storage.local.get({ repoFilterMode: 'all', repoFilterList: '' }, r));
    const filteredResults = applyRepoFilter(results, repoFilterMode, repoFilterList);

    // Subtract dismissed PRs from badge count
    const dismissed = (await chrome.storage.local.get('dismissed')).dismissed || {};
    const needsAttention = filteredResults.filter(r => r.myStatus === 'red' && !dismissed[r.url]).length;
    setBadge(needsAttention);


    // Cleanup: remove dismissed entries for PRs that are no longer open
    const openUrls = new Set(results.map(r => r.url));
    const cleanedDismissed = {};
    for (const [url, entry] of Object.entries(dismissed)) {
      if (openUrls.has(url)) cleanedDismissed[url] = entry;
    }
    chrome.storage.local.set({ dismissed: cleanedDismissed });

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
  const repos = new Set(repoListStr.split('\n').map(r => r.trim().toLowerCase()).filter(Boolean));
  if (repos.size === 0) return results;
  if (mode === 'include') return results.filter(r => repos.has(r.repo.toLowerCase()));
  if (mode === 'exclude') return results.filter(r => !repos.has(r.repo.toLowerCase()));
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

// Listen for messages from popup/content
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'updateBadge') {
    chrome.storage.local.get(['results'], (local) => {
      chrome.storage.local.get(['dismissed'], (synced) => {
        const results = local.results || [];
        const dismissed = synced.dismissed || {};
        const count = results.filter(r => r.myStatus === 'red' && !dismissed[r.url]).length;
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
    chrome.storage.local.get(['results', 'username', 'usernames', 'lastPoll', 'repoFilterMode', 'repoFilterList'], (local) => {
      chrome.storage.local.get(['dismissed'], (synced) => {
        sendResponse({ ...local, ...synced });
      });
    });
    return true;
  }
});
