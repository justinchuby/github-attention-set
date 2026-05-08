// GitHub Attention Set — Popup
import { getIcon } from './icons.js';
import { h } from './dom.js';
import { initI18n, msg } from './i18n.js';
import { applyRepoFilter } from './utils.js';

await initI18n();

function timeAgo(dateStringOrMs) {
  if (!dateStringOrMs) return '';
  const ms = typeof dateStringOrMs === 'number' ? dateStringOrMs : new Date(dateStringOrMs).getTime();
  if (!ms || isNaN(ms)) return '';
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return msg('justNow');
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
app.setAttribute('role', 'main');

// Search filter — created once, outside render() to preserve focus/input
const searchContainer = h('div', { class: 'search-box' });
const searchIcon = h('span', { class: 'search-icon' });
searchIcon.appendChild(htmlToNodes(getIcon('search', 14)));
const searchInput = h('input', {
  type: 'text',
  class: 'search-input',
  placeholder: msg('filterPlaceholder'),
  'aria-label': msg('filterPlaceholder'),
});
searchContainer.appendChild(searchIcon);
searchContainer.appendChild(searchInput);
let currentFilter = '';
let _filterTimer = null;
searchInput.addEventListener('keyup', () => {
  clearTimeout(_filterTimer);
  _filterTimer = setTimeout(() => {
    currentFilter = searchInput.value.trim().toLowerCase();
    applyFilter();
  }, 120);
});

function applyFilter() {
  const sections = app.querySelectorAll('[data-filter-section]');
  sections.forEach((section) => {
    const items = section.querySelectorAll('.pr-item');
    let visibleCount = 0;
    items.forEach((item) => {
      const text = (item.dataset.filterText || '').toLowerCase();
      const match = !currentFilter || text.includes(currentFilter);
      item.style.display = match ? '' : 'none';
      if (match) visibleCount++;
    });
    // Hide section header if no visible items
    const header = section.previousElementSibling;
    if (header && header.classList.contains('status-section-title')) {
      header.style.display = visibleCount > 0 ? '' : 'none';
    }
    section.style.display = visibleCount > 0 ? '' : 'none';
  });
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
      h('p', null, msg('noToken')),
      h('p', null, h('a', { href: '#', id: 'open-options' }, msg('openSettings'))),
    ]);
    app.appendChild(noToken);
    document.getElementById('open-options').onclick = () => chrome.runtime.openOptionsPage();
    return;
  }

  chrome.storage.local.get(
    ['results', 'username', 'lastPoll', 'repoFilterMode', 'repoFilterList', 'groupByRepo', 'dismissedClicked'],
    (localData) => {
      chrome.storage.local.get(['dismissed'], (syncData) => {
        const cached = { ...localData, ...syncData };
        window.__lastError = cached.lastError || null;
        window.__groupByRepo = cached.groupByRepo === true;
        window.__dismissedClicked = cached.dismissedClicked || {};
        if (cached && cached.results) {
          render(cached, false);
          const btn = document.getElementById('refresh');
          if (btn) {
            btn.textContent = '';
            const spinner = h('span', { class: 'spinner' });
            spinner.appendChild(htmlToNodes(getIcon('sync', 12)));
            btn.appendChild(spinner);
            btn.append(' ' + msg('refresh'));
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
    },
  );
});

function showSpinner() {
  app.textContent = '';
  const empty = h('div', { class: 'empty' });
  empty.appendChild(htmlToNodes(getIcon('sync', 14)));
  empty.append(' ' + msg('loading'));
  app.appendChild(empty);
}

function dismissPR(prUrl, lastEventAt) {
  chrome.storage.local.get(['dismissed'], (data) => {
    const dismissed = data.dismissed || {};
    dismissed[prUrl] = { prUrl, dismissedAt: Date.now(), lastEventAt: lastEventAt || 0 };
    chrome.storage.local.set({ dismissed }, () => {
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
    chrome.storage.local.set({ dismissed }, () => {
      chrome.runtime.sendMessage({ type: 'updateBadge' });
      chrome.runtime.sendMessage({ type: 'getData' }, (fresh) => {
        if (fresh && fresh.results) render(fresh, false);
      });
    });
  });
}

function muteRepo(repo) {
  chrome.storage.local.get({ mutedRepos: [] }, (data) => {
    const list = data.mutedRepos || [];
    if (!list.includes(repo)) list.push(repo);
    chrome.storage.local.set({ mutedRepos: list }, () => {
      chrome.runtime.sendMessage({ type: 'updateBadge' });
      chrome.runtime.sendMessage({ type: 'getData' }, (fresh) => {
        if (fresh && fresh.results) render(fresh, false);
      });
    });
  });
}

function muteOwner(owner) {
  chrome.storage.local.get({ mutedOwners: [] }, (data) => {
    const list = data.mutedOwners || [];
    if (!list.includes(owner)) list.push(owner);
    chrome.storage.local.set({ mutedOwners: list }, () => {
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

function renderPRItem(pr, username, showRepo) {
  const clickedAt = (window.__dismissedClicked || {})[pr.url] || 0;
  const seen = clickedAt > (pr.lastEventAt || 0);
  const color = pr.myStatus === 'red' ? '#d73a49' : pr.myStatus === 'yellow' ? '#dbab09' : '#28a745';
  const dotIcon = seen ? 'dot' : 'dot-fill';
  const metaParts = [];
  if (showRepo) metaParts.push(pr.repo);
  metaParts.push(`#${pr.number}`);

  const stateLabels = {
    DRAFT: msg('stateDraft'),
    REVIEWING: msg('stateReview'),
    CHANGES_REQUESTED: msg('stateFix'),
    COMMENTED: msg('stateRespond'),
    APPROVED_NO_AUTOMERGE: msg('stateMerge'),
    MERGING: msg('stateMerging'),
    STALLED_MERGE: msg('stateStuck'),
    MERGED: msg('stateMerged'),
    CLOSED: msg('stateClosed'),
  };

  const incomingDetailLabels = {
    new: msg('stateNew'),
    updated: msg('stateUpdated'),
    rereview: msg('stateRereview'),
  };

  // Use incoming detail label if applicable
  let stateLabel;
  if (pr.myRole === 'incoming' && pr.incomingDetail && incomingDetailLabels[pr.incomingDetail]) {
    stateLabel = incomingDetailLabels[pr.incomingDetail];
  } else {
    stateLabel = stateLabels[pr.myReason || pr.prState] || '';
  }
  const metaChildren = [showRepo ? `${pr.repo}#${pr.number}` : `#${pr.number}`];
  if (pr.author) {
    metaChildren.push(' · by ');
    metaChildren.push(
      h('a', { href: `https://github.com/${pr.author}`, target: '_blank', style: { color: 'inherit' } }, pr.author),
    );
  }
  // state badge rendered separately below
  if (window.__multiAccount ? pr.account : null) {
    metaChildren.push(' · ');
    metaChildren.push(h('span', { style: { color: '#8b949e' } }, pr.account));
  }
  // Reviewers rendered as colored names (Critique-style)
  // Color = review state, Bold = in attention set
  const reviewerStates = pr.reviewerStates || {};
  const attentionSet = pr.attentionSet || {};
  const allReviewers = pr.allReviewers || [];
  const reviewerChildren = [];
  const stateColors = {
    approved: '#28a745',
    changes_requested: '#d73a49',
    commented: '#dbab09',
    pending: '#8b949e',
  };
  if (allReviewers.length > 0) {
    allReviewers.forEach((u, i) => {
      if (i > 0) reviewerChildren.push(', ');
      const state = reviewerStates[u] || 'pending';
      const inSet = !!attentionSet[u];
      const stateLabel_sr = {
        approved: msg('stateApproved') || 'approved',
        changes_requested: msg('stateFix') || 'changes requested',
        commented: msg('stateRespond') || 'commented',
        pending: msg('stateReview') || 'pending',
      };
      const nameEl = h(
        'a',
        {
          href: `https://github.com/${u}`,
          target: '_blank',
          style: {
            color: stateColors[state],
            fontWeight: inSet ? 'bold' : 'normal',
            textDecoration: 'none',
            fontSize: '11px',
          },
          title: `${u}: ${state}${inSet ? ' (in attention set)' : ''}`,
          'aria-label': `${u}: ${stateLabel_sr[state] || state}${inSet ? ' (in attention set)' : ''}`,
        },
        u,
      );
      reviewerChildren.push(nameEl);
    });
  }
  const waitingOnChildren = reviewerChildren;

  const dot = h('span', { class: 'dot' });
  dot.appendChild(htmlToNodes(getIcon(dotIcon, 10, color)));

  const dismissBtn = h('button', {
    class: 'dismiss-btn',
    title: msg('dismiss'),
    'aria-label': `Dismiss ${pr.title}`,
    'data-url': pr.url,
    'data-event-at': String(pr.lastEventAt || 0),
  });
  dismissBtn.appendChild(htmlToNodes(getIcon('x', 14)));
  dismissBtn.onclick = (e) => {
    e.stopPropagation();
    dismissPR(pr.url, pr.lastEventAt || 0);
  };

  // Mute menu button
  const [owner, _repoName] = pr.repo.split('/');
  const muteBtn = h(
    'button',
    {
      class: 'dismiss-btn mute-btn',
      title: msg('moreOptions'),
      'aria-label': msg('moreOptions'),
      style: { fontSize: '16px', padding: '2px 4px' },
    },
    '⋮',
  );
  muteBtn.setAttribute('aria-expanded', 'false');
  muteBtn.setAttribute('aria-haspopup', 'true');
  const toggleMuteMenu = (e) => {
    e.stopPropagation();
    // Remove any existing mute menu
    const existing = muteBtn.parentElement.querySelector('.mute-menu');
    if (existing) {
      existing.remove();
      muteBtn.setAttribute('aria-expanded', 'false');
      return;
    }
    document.querySelectorAll('.mute-menu').forEach((m) => m.remove());
    const menu = h('div', { class: 'mute-menu', role: 'menu' }, [
      h('button', { class: 'mute-menu-item', role: 'menuitem' }, `${msg('muteRepo')}: ${pr.repo}`),
      h('button', { class: 'mute-menu-item', role: 'menuitem' }, `${msg('muteOwner')} ${owner}`),
    ]);
    menu.children[0].onclick = (ev) => {
      ev.stopPropagation();
      muteRepo(pr.repo);
      menu.remove();
      muteBtn.setAttribute('aria-expanded', 'false');
    };
    menu.children[1].onclick = (ev) => {
      ev.stopPropagation();
      muteOwner(owner);
      menu.remove();
      muteBtn.setAttribute('aria-expanded', 'false');
    };
    muteBtn.parentElement.appendChild(menu);
    muteBtn.setAttribute('aria-expanded', 'true');
    menu.children[0].focus();
    // Close on outside click or Escape
    const closer = (evt) => {
      if (!menu.contains(evt.target) && evt.target !== muteBtn) {
        menu.remove();
        muteBtn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', closer);
        document.removeEventListener('keydown', keyHandler);
      }
    };
    const keyHandler = (evt) => {
      if (evt.key === 'Escape') {
        menu.remove();
        muteBtn.setAttribute('aria-expanded', 'false');
        muteBtn.focus();
        document.removeEventListener('click', closer);
        document.removeEventListener('keydown', keyHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closer);
      document.addEventListener('keydown', keyHandler);
    }, 0);
  };
  muteBtn.onclick = toggleMuteMenu;

  const filterText = `${pr.title} ${pr.repo} ${pr.author} #${pr.number} ${pr.number} ${(pr.allReviewers || []).join(' ')}`;

  return h('li', { class: 'pr-item', 'data-filter-text': filterText }, [
    dot,
    h('div', { class: 'pr-info' }, [
      h(
        'div',
        { class: 'pr-title' },
        (() => {
          const link = h('a', { href: pr.url, target: '_blank', title: pr.title }, pr.title);
          link.onclick = () => {
            chrome.storage.local.get(['dismissedClicked'], (data) => {
              const clicked = data.dismissedClicked || {};
              clicked[pr.url] = Date.now();
              chrome.storage.local.set({ dismissedClicked: clicked });
            });
          };
          return link;
        })(),
      ),
      h('div', { class: 'pr-meta' }, metaChildren),
      waitingOnChildren.length ? h('div', { class: 'pr-waiting' }, waitingOnChildren) : null,
    ]),
    h('div', { class: 'pr-right' }, [
      h('span', { class: 'pr-time' }, timeAgo(pr.lastEventAt)),
      stateLabel ? h('span', { class: 'pr-state-badge', 'aria-label': `Status: ${stateLabel}` }, stateLabel) : null,
    ]),
    h(
      'div',
      {
        class: 'pr-actions',
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0px', position: 'relative' },
      },
      [dismissBtn, muteBtn],
    ),
  ]);
}

function renderDismissedItem(pr, dismissedData) {
  const d = dismissedData || {};
  const hasNewActivity = pr.lastEventAt && d.lastEventAt && pr.lastEventAt > d.lastEventAt;
  const clickedAt = (window.__dismissedClicked || {})[pr.url] || 0;
  const seenNewActivity = hasNewActivity && clickedAt > pr.lastEventAt;
  const dotColor = hasNewActivity && !seenNewActivity ? '#0969da' : '#8b949e';
  const dot = h('span', { class: 'dot', title: hasNewActivity ? msg('newActivity') : '' });
  dot.appendChild(htmlToNodes(getIcon('dot-fill', 10, dotColor)));

  const restoreBtn = h(
    'button',
    { class: 'restore-btn', 'data-url': pr.url, 'aria-label': `${msg('restore')} ${pr.title}` },
    msg('restore'),
  );
  restoreBtn.onclick = (e) => {
    e.stopPropagation();
    restorePR(pr.url);
  };

  const link = h('a', { href: pr.url, target: '_blank', title: pr.title }, pr.title);
  link.onclick = () => {
    // Record that user clicked this dismissed PR
    chrome.storage.local.get(['dismissedClicked'], (data) => {
      const clicked = data.dismissedClicked || {};
      clicked[pr.url] = Date.now();
      chrome.storage.local.set({ dismissedClicked: clicked });
    });
  };

  const filterText = `${pr.title} ${pr.repo} ${pr.author || ''} #${pr.number} ${pr.number} ${(pr.allReviewers || []).join(' ')}`;

  return h('li', { class: 'pr-item pr-item-dismissed', 'data-filter-text': filterText }, [
    dot,
    h('div', { class: 'pr-info' }, [
      h('div', { class: 'pr-title' }, link),
      h(
        'div',
        { class: 'pr-meta' },
        (() => {
          const parts = [`${pr.repo}#${pr.number}`];
          if (pr.author) {
            parts.push(' · by ');
            parts.push(
              h(
                'a',
                { href: `https://github.com/${pr.author}`, target: '_blank', style: { color: 'inherit' } },
                pr.author,
              ),
            );
          }
          return parts;
        })(),
      ),
    ]),
    restoreBtn,
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

async function render(data, _isRefreshing) {
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

  // Apply mute filter
  const mutedData = await new Promise((r) => chrome.storage.local.get({ mutedRepos: [], mutedOwners: [] }, r));
  const mutedRepoSet = new Set((mutedData.mutedRepos || []).map((r) => r.toLowerCase()));
  const mutedOwnerSet = new Set((mutedData.mutedOwners || []).map((o) => o.toLowerCase()));
  if (mutedRepoSet.size > 0 || mutedOwnerSet.size > 0) {
    results = results.filter((r) => {
      const repoLower = r.repo.toLowerCase();
      const owner = repoLower.split('/')[0];
      return !mutedRepoSet.has(repoLower) && !mutedOwnerSet.has(owner);
    });
  }

  const activePRs = results.filter((pr) => !dismissed[pr.url]);
  const dismissedPRs = results.filter((pr) => !!dismissed[pr.url]);

  const needsAttention = activePRs
    .filter((r) => r.myStatus === 'red')
    .sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0));
  const others = activePRs
    .filter((r) => r.myStatus !== 'red')
    .sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0));

  const roleIcons = { incoming: 'eye', outgoing: 'git-pull-request', mentioned: 'mention' };
  function roleHeader(sec) {
    const iconSpan = document.createElement('span');
    iconSpan.innerHTML = getIcon(roleIcons[sec.label] || 'dot-fill', 12, '#8b949e');
    iconSpan.style.cssText = 'vertical-align: middle; margin-right: 4px;';
    const header = h('div', { class: 'role-subsection-title' });
    header.appendChild(iconSpan);
    header.appendChild(document.createTextNode(` ${sec.labelText} (${sec.prs.length})`));
    return header;
  }

  // Group by role for sub-sections
  function groupByRole(prs) {
    const incoming = prs.filter((p) => p.myRole === 'incoming');
    const outgoing = prs.filter((p) => p.myRole === 'outgoing');
    const mentioned = prs.filter((p) => p.myRole === 'mentioned');
    const other = prs.filter((p) => !p.myRole || p.myRole === 'other');
    return { incoming, outgoing, mentioned, other };
  }

  // Build header
  const refreshBtn = h('button', { class: 'refresh-btn', id: 'refresh', 'aria-label': msg('refresh') });
  refreshBtn.appendChild(htmlToNodes(getIcon('sync', 12)));
  refreshBtn.append(' ' + msg('refresh'));

  const settingsBtn = h('button', {
    class: 'settings-btn',
    id: 'open-settings',
    title: msg('settings'),
    'aria-label': msg('settings'),
  });
  settingsBtn.appendChild(htmlToNodes(getIcon('gear', 14)));

  const headerImg = h('img', {
    src: 'icons/icon48.png',
    width: '18',
    height: '18',
    alt: '',
    style: { verticalAlign: 'middle', marginRight: '6px' },
  });
  const header = h('div', { class: 'header' }, [h('h1', null, [headerImg, msg('extName')]), refreshBtn, settingsBtn]);

  app.textContent = '';
  app.appendChild(header);
  app.appendChild(searchContainer);
  // Restore search input value
  searchInput.value = currentFilter ? searchInput.value : '';

  // Error banner
  if (window.__lastError) {
    const msg = window.__lastError.type === 'auth' ? msg('errorAuth') : msg('errorNetwork');
    app.appendChild(h('div', { class: 'error-banner' }, msg));
  }

  // PR lists
  if (activePRs.length === 0) {
    app.appendChild(h('div', { class: 'empty' }, msg('noPRs')));
  } else {
    if (needsAttention.length > 0) {
      app.appendChild(
        h('div', { class: 'status-section-title attention' }, `${msg('needsAttention')} (${needsAttention.length})`),
      );
      const attentionContainer = h('div', { 'data-filter-section': 'attention' });
      const roles = groupByRole(needsAttention);
      const roleSections = [
        { label: 'incoming', labelText: msg('incoming'), prs: roles.incoming },
        { label: 'outgoing', labelText: msg('outgoing'), prs: roles.outgoing },
        { label: 'mentioned', labelText: msg('mentioned'), prs: roles.mentioned },
      ];
      const hasSubSection = roleSections.some((s) => s.prs.length > 0);
      for (const sec of roleSections) {
        if (sec.prs.length === 0) continue;
        if (hasSubSection) {
          attentionContainer.appendChild(roleHeader(sec));
        }
        const groups = window.__groupByRepo ? groupByRepo(sec.prs) : [{ repo: '', prs: sec.prs }];
        attentionContainer.appendChild(renderRepoGroups(groups, username));
      }
      if (roles.other.length > 0) {
        const groups = window.__groupByRepo ? groupByRepo(roles.other) : [{ repo: '', prs: roles.other }];
        attentionContainer.appendChild(renderRepoGroups(groups, username));
      }
      app.appendChild(attentionContainer);
    }
    if (others.length > 0) {
      app.appendChild(
        h('div', { class: 'status-section-title others' }, `${msg('waitingOnOthers')} (${others.length})`),
      );
      const othersContainer = h('div', { 'data-filter-section': 'others' });
      const roles = groupByRole(others);
      const roleSections = [
        { label: 'incoming', labelText: msg('incoming'), prs: roles.incoming },
        { label: 'outgoing', labelText: msg('outgoing'), prs: roles.outgoing },
      ];
      const hasSubSection = roleSections.some((s) => s.prs.length > 0);
      for (const sec of roleSections) {
        if (sec.prs.length === 0) continue;
        if (hasSubSection) {
          othersContainer.appendChild(roleHeader(sec));
        }
        const groups = window.__groupByRepo ? groupByRepo(sec.prs) : [{ repo: '', prs: sec.prs }];
        othersContainer.appendChild(renderRepoGroups(groups, username));
      }
      // mentioned + other go ungrouped
      const rest = [...roles.mentioned, ...roles.other];
      if (rest.length > 0) {
        const groups = window.__groupByRepo ? groupByRepo(rest) : [{ repo: '', prs: rest }];
        othersContainer.appendChild(renderRepoGroups(groups, username));
      }
      app.appendChild(othersContainer);
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
    path.setAttribute(
      'd',
      'M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z',
    );
    chevronSvg.appendChild(path);

    const toggle = h(
      'button',
      {
        class: 'dismissed-toggle',
        id: 'dismissed-toggle',
        'aria-expanded': 'false',
        'aria-label': `Show ${dismissedPRs.length} ${msg('dismissed')} items`,
      },
      [`${dismissedPRs.length} ${msg('dismissed')} `, chevronSvg],
    );

    const dismissedList = h('ul', {
      class: 'pr-list dismissed-list',
      id: 'dismissed-list',
      style: { display: window.__dismissedExpanded ? '' : 'none' },
    });
    for (const pr of dismissedPRs) {
      dismissedList.appendChild(renderDismissedItem(pr, dismissed[pr.url]));
    }

    toggle.onclick = () => {
      window.__dismissedExpanded = !window.__dismissedExpanded;
      const show = dismissedList.style.display === 'none';
      dismissedList.style.display = show ? 'block' : 'none';
      toggle.setAttribute('aria-expanded', String(show));
    };

    app.appendChild(h('div', { class: 'status-section-title' })); // spacer for filter logic
    const dismissedContainer = h('div', { 'data-filter-section': 'dismissed' });
    dismissedContainer.appendChild(toggle);
    dismissedContainer.appendChild(dismissedList);
    app.appendChild(dismissedContainer);
  }

  // Bind header buttons
  document.getElementById('open-settings').onclick = () => chrome.runtime.openOptionsPage();
  document.getElementById('refresh').onclick = () => {
    const btn = document.getElementById('refresh');
    btn.textContent = '';
    const spinner = h('span', { class: 'spinner' });
    spinner.appendChild(htmlToNodes(getIcon('sync', 12)));
    btn.appendChild(spinner);
    btn.append(' ' + msg('refresh'));
    btn.disabled = true;
    chrome.runtime.sendMessage({ type: 'refresh' }, () => {
      chrome.runtime.sendMessage({ type: 'getData' }, (fresh) => {
        if (fresh && fresh.results) render(fresh, false);
        else {
          btn.textContent = '';
          btn.appendChild(htmlToNodes(getIcon('sync', 12)));
          btn.append(' ' + msg('refresh'));
          btn.disabled = false;
        }
      });
    });
  };

  // Re-apply filter after render
  applyFilter();
}
