
function renderError(error) {
  if (!error) return '';
  const msgs = {
    auth: '⚠️ Token expired or invalid. <a href="#" id="go-settings">Update in settings</a>',
    server: '⚠️ GitHub is unreachable. Showing cached data.',
    network: '⚠️ Network error. Showing cached data.'
  };
  return `<div class="error-banner">${msgs[error.type] || msgs.network}</div>`;
}

// GitHub Attention Set — Popup
import { getIcon } from './icons.js';

function timeAgo(dateStringOrMs) {
  if (!dateStringOrMs) return '';
  const ms = typeof dateStringOrMs === 'number' ? dateStringOrMs : new Date(dateStringOrMs).getTime();
  if (!ms || isNaN(ms)) return '';
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

const app = document.getElementById('app');

function isBot(login) {
  if (!login) return false;
  return login.includes('[bot]');
}

chrome.storage.local.get({ token: '', username: '' }, (settings) => {
  if (!settings.token) {
    app.innerHTML = `<div class="no-token">
      <p>No GitHub token configured.</p>
      <p><a href="#" id="open-options">Open Settings</a></p>
    </div>`;
    document.getElementById('open-options').onclick = () => chrome.runtime.openOptionsPage();
    return;
  }

  // Try cached data first
  chrome.storage.local.get(['results', 'username', 'lastPoll', 'dismissed', 'repoFilterMode', 'repoFilterList'], (cached) => {
    window.__lastError = cached.lastError || null;
    window.__groupByRepo = cached.groupByRepo === true;
    if (cached && cached.results) {
      render(cached, false);
      const btn = document.getElementById('refresh');
      if (btn) { btn.innerHTML = '<span class="spinner">' + getIcon('sync', 12) + '</span>'; btn.disabled = true; }
      chrome.runtime.sendMessage({ type: 'refresh' }, () => {
        chrome.runtime.sendMessage({ type: 'getData' }, (fresh) => {
          if (fresh && fresh.results) render(fresh, false);
        });
      });
    } else {
      showSpinner();
      chrome.runtime.sendMessage({ type: 'refresh' }, () => {
        chrome.runtime.sendMessage({ type: 'getData' }, (data) => render(data, false));
      });
    }
  });
});

function showSpinner() {
  app.innerHTML = `<div class="empty">${getIcon('sync', 14)} Loading...</div>`;
}

function dismissPR(prUrl, lastEventAt) {
  chrome.storage.local.get(['dismissed'], (data) => {
    const dismissed = data.dismissed || {};
    dismissed[prUrl] = { prUrl, dismissedAt: Date.now(), lastEventAt: lastEventAt || 0 };
    chrome.storage.local.set({ dismissed }, () => {
      chrome.runtime.sendMessage({ type: 'getData' }, (fresh) => {
        if (fresh && fresh.results) render(fresh, false);
      });
    });
  });
}

function restorePR(prUrl) {
  chrome.storage.local.get(['dismissed'], (data) => {
    const dismissed = data.dismissed || {};
    delete dismissed[prUrl];
    chrome.storage.local.set({ dismissed }, () => {
      chrome.runtime.sendMessage({ type: 'getData' }, (fresh) => {
        if (fresh && fresh.results) render(fresh, false);
      });
    });
  });
}

function groupByRepo(prs) {
  const map = new Map();
  for (const pr of prs) {
    if (!map.has(pr.repo)) map.set(pr.repo, []);
    map.get(pr.repo).push(pr);
  }
  // Sort PRs within each group by lastEventAt desc
  const groups = [];
  for (const [repo, repoPrs] of map) {
    repoPrs.sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0));
    const latestEvent = repoPrs[0]?.lastEventAt || 0;
    groups.push({ repo, prs: repoPrs, latestEvent });
  }
  // Sort groups by latest event desc
  groups.sort((a, b) => b.latestEvent - a.latestEvent);
  return groups;
}

function applyRepoFilter(results, mode, repoListStr) {
  if (!mode || mode === 'all' || !repoListStr.trim()) return results;
  const repos = new Set(repoListStr.split('\n').map(r => r.trim().toLowerCase()).filter(Boolean));
  if (repos.size === 0) return results;
  if (mode === 'include') return results.filter(r => repos.has(r.repo.toLowerCase()));
  if (mode === 'exclude') return results.filter(r => !repos.has(r.repo.toLowerCase()));
  return results;
}

function render(data, isRefreshing) {
  if (!data || !data.results) {
    showSpinner();
    return;
  }

  const { username } = data;
  let { results } = data;
  const dismissed = data.dismissed || {};

  // Apply repo filter
  const filterData = data.repoFilterMode ? data : {};
  const filterMode = filterData.repoFilterMode || 'all';
  const filterList = filterData.repoFilterList || '';
  results = applyRepoFilter(results, filterMode, filterList);

  // Filter out dismissed PRs (unless they have new events)
  const activePRs = results.filter(pr => {
    const d = dismissed[pr.url];
    if (!d) return true;
    // If there's a newer event since dismiss, auto-restore
    if (pr.lastEventAt && pr.lastEventAt > d.lastEventAt) {
      // Will be cleaned up on next storage write
      return true;
    }
    return false;
  });

  const dismissedPRs = results.filter(pr => {
    const d = dismissed[pr.url];
    if (!d) return false;
    if (pr.lastEventAt && pr.lastEventAt > d.lastEventAt) return false;
    return true;
  });

  const needsAttention = activePRs.filter(r => r.myStatus === 'red');
  const others = activePRs.filter(r => r.myStatus !== 'red');
  const sorted = [...needsAttention, ...others];

  const count = needsAttention.length;
  const summaryText = count > 0
    ? `${count} PR${count > 1 ? 's' : ''} need${count === 1 ? 's' : ''} your attention`
    : 'All clear! No PRs waiting on you.';

  // Group by repo per status section
  const needsAttentionGroups = groupByRepo(needsAttention);
  const othersGroups = window.__groupByRepo ? groupByRepo(others) : [{ repo: '', prs: others }];

  const dismissedSection = dismissedPRs.length > 0 ? `
    <div class="dismissed-toggle" id="dismissed-toggle">
      ${dismissedPRs.length} dismissed <svg width="12" height="12" viewBox="0 0 16 16" style="vertical-align:middle"><path fill="currentColor" d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z"></path></svg>
    </div>
    <ul class="pr-list dismissed-list" id="dismissed-list" style="display:none;">
      ${dismissedPRs.map(pr => `<li class="pr-item pr-item-dismissed">
        <span class="dot">${getIcon('dot-fill', 10, '#8b949e')}</span>
        <div class="pr-info">
          <div class="pr-title"><a href="${pr.url}" target="_blank" title="${escHtml(pr.title)}">${escHtml(pr.title)}</a></div>
          <div class="pr-meta">${pr.repo}#${pr.number}</div>
        </div>
        <button class="restore-btn" data-url="${escHtml(pr.url)}">Restore</button>
      </li>`).join('')}
    </ul>
  ` : '';

  function renderRepoGroups(groups) {
    return groups.map(group => `
      <div class="repo-group">
        <div class="repo-group-title">${escHtml(group.repo)} (${group.prs.length})</div>
        <ul class="pr-list">
          ${group.prs.map(pr => {
            const color = pr.myStatus === 'red' ? '#d73a49' : pr.myStatus === 'yellow' ? '#dbab09' : '#28a745';
            const waitingOn = Object.entries(pr.attentionSet || {})
              .filter(([u, s]) => s === 'red' && !isBot(u))
              .map(([u]) => u === username ? `<strong>@${escHtml(u)}</strong>` : `@${escHtml(u)}`);
            return `<li class="pr-item">
              <span class="dot">${getIcon('dot-fill', 10, color)}</span>
              <div class="pr-info">
                <div class="pr-title"><a href="${pr.url}" target="_blank" title="${escHtml(pr.title)}">${escHtml(pr.title)}</a></div>
                <div class="pr-meta">#${pr.number}${waitingOn.length ? ' · Waiting on: ' + waitingOn.join(', ') : ''}</div>
              </div>
              <span class="pr-time">${timeAgo(pr.lastEventAt)}</span>
              <button class="dismiss-btn" data-url="${escHtml(pr.url)}" data-event-at="${pr.lastEventAt || 0}" title="Dismiss">${getIcon('x', 14)}</button>
            </li>`;
          }).join('')}
        </ul>
      </div>
    `).join('');
  }

  let prListHtml = '';
  if (activePRs.length === 0) {
    prListHtml = '<div class="empty">No open PRs found.</div>';
  } else {
    if (needsAttention.length > 0) {
      prListHtml += `<div class="status-section-title">Needs your attention (${needsAttention.length})</div>`;
      prListHtml += renderRepoGroups(needsAttentionGroups);
    }
    if (others.length > 0) {
      prListHtml += `<div class="status-section-title">Waiting on others (${others.length})</div>`;
      prListHtml += renderRepoGroups(othersGroups);
    }
  }

  app.innerHTML = `
    <div class="header">
      <h1>Attention Set</h1>
      <button class="refresh-btn" id="refresh">${isRefreshing ? getIcon('sync', 12) : getIcon('sync', 12) + ' Refresh'}</button>
    </div>
    ${window.__lastError ? `<div class="error-banner">${window.__lastError.type === "auth" ? "⚠️ Token expired or invalid. Update in settings." : "⚠️ GitHub unreachable. Showing cached data."}</div>` : ""}
    <div class="summary">${summaryText}</div>
    ${prListHtml}
    ${dismissedSection}
  `;

  // Refresh button
  document.getElementById('refresh').onclick = () => {
    const btn = document.getElementById('refresh');
    btn.innerHTML = getIcon('sync', 12);
    btn.disabled = true;
    chrome.runtime.sendMessage({ type: 'refresh' }, () => {
      chrome.runtime.sendMessage({ type: 'getData' }, (fresh) => render(fresh, false));
    });
  };

  // Dismiss buttons
  document.querySelectorAll('.dismiss-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      dismissPR(btn.dataset.url, parseInt(btn.dataset.eventAt) || 0);
    };
  });

  // Dismissed toggle
  const toggle = document.getElementById('dismissed-toggle');
  if (toggle) {
    toggle.onclick = () => {
      const list = document.getElementById('dismissed-list');
      list.style.display = list.style.display === 'none' ? 'block' : 'none';
    };
  }

  // Restore buttons
  document.querySelectorAll('.restore-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      restorePR(btn.dataset.url);
    };
  });
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
