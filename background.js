// GitHub Attention Set — Background Service Worker

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
  const defaults = { token: '', debounceMinutes: DEFAULT_DEBOUNCE, pollMinutes: DEFAULT_POLL_INTERVAL, notifications: true };
  return new Promise(r => chrome.storage.sync.get(defaults, r));
}

async function ghFetch(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

async function pollAndCompute() {
  const settings = await getSettings();
  if (!settings.token) { setBadge(0); return; }

  try {
    const user = await ghFetch('/user', settings.token);
    const username = user.login;

    // Get open PRs involving us
    const prs = await ghFetch(`/search/issues?q=involves:${username}+is:pr+is:open&per_page=50`, settings.token);

    const results = [];
    for (const pr of prs.items) {
      const [owner, repo] = pr.repository_url.replace('https://api.github.com/repos/', '').split('/');
      const number = pr.number;

      let timeline;
      try {
        timeline = await ghFetch(`/repos/${owner}/${repo}/issues/${number}/timeline?per_page=100`, settings.token);
      } catch { timeline = []; }

      const attention = computeAttentionSet(timeline, username, pr.user.login, settings.debounceMinutes);
      // Compute lastEventAt from timeline
      let lastEventAt = 0;
      for (const event of timeline) {
        const ts = new Date(event.created_at || event.submitted_at || 0).getTime();
        if (ts > lastEventAt) lastEventAt = ts;
      }

      results.push({
        id: pr.id,
        number,
        title: pr.title,
        url: pr.html_url,
        repo: `${owner}/${repo}`,
        author: pr.user.login,
        attentionSet: attention.set,
        myStatus: attention.myStatus, // 'red' | 'green' | 'yellow'
        lastEventAt,
      });
    }

    await chrome.storage.local.set({ results, username, lastPoll: Date.now() });

    const needsAttention = results.filter(r => r.myStatus === 'red').length;
    setBadge(needsAttention);

    if (settings.notifications && needsAttention > 0) {
      // Only notify on increase — simple approach
    }
  } catch (e) {
    console.error('Attention Set poll error:', e);
  }
}

function isBot(login, userObj) {
  if (!login) return false;
  if (login.includes('[bot]')) return true;
  if (userObj && userObj.type === 'Bot') return true;
  return false;
}

function computeAttentionSet(timeline, me, author, debounceMin, now = Date.now()) {
  const set = new Map();
  const debounceMs = debounceMin * 60 * 1000;

  for (const event of timeline) {
    const ts = new Date(event.created_at || event.submitted_at || 0).getTime();
    const actor = event.actor?.login || event.user?.login || '';

    switch (event.event || event.__type) {
      case 'reviewed': {
        set.delete(actor);
        set.set(author, { status: 'red', since: ts });
        break;
      }
      case 'review_requested': {
        const reviewer = event.requested_reviewer?.login;
        if (reviewer) {
          set.delete(actor);
          set.set(reviewer, { status: 'red', since: ts });
        }
        break;
      }
      case 'commented': {
        set.delete(actor);
        if (actor === author) {
          // Author replied — simplified
        } else {
          const elapsed = now - ts;
          if (elapsed >= debounceMs) {
            set.set(author, { status: 'red', since: ts });
          } else {
            set.set(author, { status: 'yellow', since: ts });
          }
        }
        break;
      }
      case 'head_ref_force_pushed':
      case 'committed': {
        if (actor === author || event.committer?.login === author) {
          set.delete(author);
        }
        break;
      }
    }

    if (event.body) {
      const mentions = event.body.match(/@([a-zA-Z0-9-]+)/g) || [];
      for (const m of mentions) {
        const mentioned = m.slice(1);
        if (mentioned !== actor) {
          set.set(mentioned, { status: 'red', since: ts });
        }
      }
    }
  }

  const myEntry = set.get(me);
  let myStatus = 'green';
  if (myEntry) {
    myStatus = myEntry.status;
  }

  const setObj = {};
  for (const [user, info] of set) {
    if (!isBot(user)) {
      setObj[user] = info.status;
    }
  }

  return { set: setObj, myStatus };
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
  if (msg.type === 'refresh') {
    pollAndCompute().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'getData') {
    chrome.storage.local.get(['results', 'username', 'lastPoll', 'dismissed'], sendResponse);
    return true;
  }
});
