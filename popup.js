// GitHub Attention Set — Popup
import { getIcon } from './icons.js';
import { h } from './dom.js';

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

/** Parse an HTML string into DOM nodes (for icon SVGs from getIcon) */
function htmlToNodes(htmlStr) {
  const t = document.createElement('template');
  t.innerHTML = htmlStr;
  return t.content;
}

chrome.storage.local.get({ token: '', tokens: null, username: '' }, (settings) => {
  const hasToken = (settings.tokens && settings.tokens.length > 0) || settings.token;
  window.__multiAccount = settings.tokens && settings.tokens.length > 1;
  if (!hasToken) {
    app.textContent = '';
    const noToken = h('div', { class: 'no-token' }, [
      h('p', null, 'No GitHub token configured.'),
      h('p', null, h('a', { href: '#', id: 'open-options' }, 'Open Settings'))
    ]);
    app.appendChild(noToken);
    document.getElementById('open-options').onclick = () => chrome.runtime.openOptionsPage();
    return;
  }

  chrome.storage.local.get(['results', 'username', 'lastPoll', 'dismissed', 'repoFilterMode', 'repoFilterList', 'groupByRepo'], (cached) => {
    window.__lastError = cached.lastError || null;
    window.__groupByRepo = cached.groupByRepo === true;
    if (cached && cached.results) {
      render(cached, false);
      const btn = document.getElementById('refresh');
      if (btn) {
        btn.textContent = '';
        const spinner = h('span', { class: 'spinner' });
        spinner.appendChild(htmlToNodes(getIcon('sync', 12)));
        btn.appendChild(spinner);
        btn.append(' Refresh');
        btn.disabled = true;
      }
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
  app.textContent = '';
  const empty = h('div', { class: 'empty' });
  empty.appendChild(htmlToNodes(getIcon('sync', 14)));
  empty.append(' Loading...');
  app.appendChild(empty);
}

function dismissPR(prUrl, lastEventAt) {
  chrome.storage.sync.get(['dismissed'], (data) => {
    const dismissed = data.dismissed || {};
    dismissed[prUrl] = { prUrl, dismissedAt: Date.now(), lastEventAt: lastEventAt || 0 };
    chrome.storage.sync.set({ dismissed }, () => {
      chrome.runtime.sendMessage({ type: 'updateBadge' });
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
    chrome.storage.sync.set({ dismissed }, () => {
      chrome.runtime.sendMessage({ type: 'updateBadge' });
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
  const groups = [];
  for (const [repo, repoPrs] of map) {
    repoPrs.sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0));
    const latestEvent = repoPrs[0]?.lastEventAt || 0;
    groups.push({ repo, prs: repoPrs, latestEvent });
  }
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

function renderPRItem(pr, username, showRepo) {
  const color = pr.myStatus === 'red' ? '#d73a49' : pr.myStatus === 'yellow' ? '#dbab09' : '#28a745';
  const waitingOn = Object.entries(pr.attentionSet || {})
    .filter(([u, s]) => s === 'red' && !isBot(u))
    .map(([u]) => u);

  const metaParts = [];
  if (showRepo) metaParts.push(pr.repo);
  metaParts.push(`#${pr.number}`);

  
  const stateLabels = {
    DRAFT: 'Draft',
    REVIEWING: 'Review needed',
    CHANGES_REQUESTED: 'Address feedback',
    COMMENTED: 'Respond to review',
    APPROVED_NO_AUTOMERGE: 'Ready to merge',
    MERGING: 'Merging...',
    STALLED_MERGE: 'Check CI',
    MERGED: 'Merged',
    CLOSED: 'Closed',
  };

  const stateLabel = stateLabels[pr.prState] || '';
  const metaChildren = [showRepo ? `${pr.repo}#${pr.number}` : `#${pr.number}`];
  // state badge rendered separately below
  if ((window.__multiAccount ? pr.account : null)) {
    metaChildren.push(' · ');
    metaChildren.push(h('span', { style: { color: '#8b949e' } }, pr.account));
  }
  if (waitingOn.length) {
    metaChildren.push(' · Waiting on: ');
    waitingOn.forEach((u, i) => {
      if (i > 0) metaChildren.push(', ');
      if (u === username) {
        metaChildren.push(h('strong', null, `@${u}`));
      } else {
        metaChildren.push(`@${u}`);
      }
    });
  }

  const dot = h('span', { class: 'dot' });
  dot.appendChild(htmlToNodes(getIcon('dot-fill', 10, color)));

  const dismissBtn = h('button', {
    class: 'dismiss-btn',
    title: 'Dismiss',
    'data-url': pr.url,
    'data-event-at': String(pr.lastEventAt || 0)
  });
  dismissBtn.appendChild(htmlToNodes(getIcon('x', 14)));
  dismissBtn.onclick = (e) => {
    e.stopPropagation();
    dismissPR(pr.url, pr.lastEventAt || 0);
  };

  return h('li', { class: 'pr-item' }, [
    dot,
    h('div', { class: 'pr-info' }, [
      h('div', { class: 'pr-title' }, h('a', { href: pr.url, target: '_blank', title: pr.title }, pr.title)),
      h('div', { class: 'pr-meta' }, metaChildren)
    ]),
    h('div', { class: 'pr-right' }, [
        h('span', { class: 'pr-time' }, timeAgo(pr.lastEventAt)),
        stateLabel ? h('span', { class: 'pr-state-badge' }, stateLabel) : null,
      ]),
    dismissBtn
  ]);
}

function renderDismissedItem(pr) {
  const dot = h('span', { class: 'dot' });
  dot.appendChild(htmlToNodes(getIcon('dot-fill', 10, '#8b949e')));

  const restoreBtn = h('button', { class: 'restore-btn', 'data-url': pr.url }, 'Restore');
  restoreBtn.onclick = (e) => {
    e.stopPropagation();
    restorePR(pr.url);
  };

  return h('li', { class: 'pr-item pr-item-dismissed' }, [
    dot,
    h('div', { class: 'pr-info' }, [
      h('div', { class: 'pr-title' }, h('a', { href: pr.url, target: '_blank', title: pr.title }, pr.title)),
      h('div', { class: 'pr-meta' }, `${pr.repo}#${pr.number}`)
    ]),
    restoreBtn
  ]);
}

function renderRepoGroups(groups, username) {
  const frag = document.createDocumentFragment();
  for (const group of groups) {
    const showRepo = !group.repo; // show repo in meta if not grouped
    const groupDiv = h('div', { class: 'repo-group' });
    if (group.repo) {
      groupDiv.appendChild(h('div', { class: 'repo-group-title' }, `${group.repo} (${group.prs.length})`));
    }
    const ul = h('ul', { class: 'pr-list' });
    for (const pr of group.prs) {
      ul.appendChild(renderPRItem(pr, username, showRepo));
    }
    groupDiv.appendChild(ul);
    frag.appendChild(groupDiv);
  }
  return frag;
}

function render(data, isRefreshing) {
  if (!data || !data.results) {
    showSpinner();
    return;
  }

  const { username } = data;
  let { results } = data;
  const dismissed = data.dismissed || {};

  const filterData = data.repoFilterMode ? data : {};
  const filterMode = filterData.repoFilterMode || 'all';
  const filterList = filterData.repoFilterList || '';
  results = applyRepoFilter(results, filterMode, filterList);

  const activePRs = results.filter(pr => {
    const d = dismissed[pr.url];
    if (!d) return true;
    if (pr.lastEventAt && pr.lastEventAt > d.lastEventAt) return true;
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

  const needsAttentionGroups = window.__groupByRepo ? groupByRepo(needsAttention) : [{ repo: "", prs: needsAttention }];
  const othersGroups = window.__groupByRepo ? groupByRepo(others) : [{ repo: '', prs: others }];

  // Build header
  const refreshBtn = h('button', { class: 'refresh-btn', id: 'refresh' });
  refreshBtn.appendChild(htmlToNodes(getIcon('sync', 12)));
  refreshBtn.append(' Refresh');

  const settingsBtn = h('button', { class: 'settings-btn', id: 'open-settings', title: 'Settings' });
  settingsBtn.appendChild(htmlToNodes(getIcon('gear', 14)));

  const headerImg = h('img', { src: 'icons/icon48.png', width: '18', height: '18', style: { verticalAlign: 'middle', marginRight: '6px' } });
  const header = h('div', { class: 'header' }, [
    h('h1', null, [headerImg, 'Attention Set']),
    refreshBtn,
    settingsBtn
  ]);

  app.textContent = '';
  app.appendChild(header);

  // Error banner
  if (window.__lastError) {
    const msg = window.__lastError.type === 'auth'
      ? '⚠️ Token expired or invalid. Update in settings.'
      : '⚠️ GitHub unreachable. Showing cached data.';
    app.appendChild(h('div', { class: 'error-banner' }, msg));
  }

  // PR lists
  if (activePRs.length === 0) {
    app.appendChild(h('div', { class: 'empty' }, 'No open PRs found.'));
  } else {
    if (needsAttention.length > 0) {
      app.appendChild(h('div', { class: 'status-section-title attention' }, `Needs your attention (${needsAttention.length})`));
      app.appendChild(renderRepoGroups(needsAttentionGroups, username));
    }
    if (others.length > 0) {
      app.appendChild(h('div', { class: 'status-section-title others' }, `Waiting on others (${others.length})`));
      app.appendChild(renderRepoGroups(othersGroups, username));
    }
  }

  // Dismissed section
  if (dismissedPRs.length > 0) {
    const chevronSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevronSvg.setAttribute('width', '12');
    chevronSvg.setAttribute('height', '12');
    chevronSvg.setAttribute('viewBox', '0 0 16 16');
    chevronSvg.style.verticalAlign = 'middle';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', 'M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z');
    chevronSvg.appendChild(path);

    const toggle = h('div', { class: 'dismissed-toggle', id: 'dismissed-toggle' }, [
      `${dismissedPRs.length} dismissed `,
      chevronSvg
    ]);

    const dismissedList = h('ul', { class: 'pr-list dismissed-list', id: 'dismissed-list', style: { display: 'none' } });
    for (const pr of dismissedPRs) {
      dismissedList.appendChild(renderDismissedItem(pr));
    }

    toggle.onclick = () => {
      dismissedList.style.display = dismissedList.style.display === 'none' ? 'block' : 'none';
    };

    app.appendChild(toggle);
    app.appendChild(dismissedList);
  }

  // Bind header buttons
  document.getElementById('open-settings').onclick = () => chrome.runtime.openOptionsPage();
  document.getElementById('refresh').onclick = () => {
    const btn = document.getElementById('refresh');
    btn.textContent = '';
    const spinner = h('span', { class: 'spinner' });
    spinner.appendChild(htmlToNodes(getIcon('sync', 12)));
    btn.appendChild(spinner);
    btn.append(' Refresh');
    btn.disabled = true;
    chrome.runtime.sendMessage({ type: 'refresh' }, () => {
      chrome.runtime.sendMessage({ type: 'getData' }, (fresh) => {
        if (fresh && fresh.results) render(fresh, false);
        else {
          btn.textContent = '';
          btn.appendChild(htmlToNodes(getIcon('sync', 12)));
          btn.append(' Refresh');
          btn.disabled = false;
        }
      });
    });
  };
}
