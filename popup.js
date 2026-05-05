// GitHub Attention Set — Popup

const app = document.getElementById('app');

function isBot(login) {
  if (!login) return false;
  return login.includes('[bot]');
}

chrome.storage.sync.get({ token: '', username: '' }, (settings) => {
  if (!settings.token) {
    app.innerHTML = `<div class="no-token">
      <p>No GitHub token configured.</p>
      <p><a href="#" id="open-options">Open Settings</a></p>
    </div>`;
    document.getElementById('open-options').onclick = () => chrome.runtime.openOptionsPage();
    return;
  }

  // Try cached data first
  chrome.storage.local.get(['results', 'username', 'lastPoll'], (cached) => {
    if (cached && cached.results) {
      render(cached, false);
      // Background refresh
      chrome.runtime.sendMessage({ type: 'refresh' }, () => {
        chrome.runtime.sendMessage({ type: 'getData' }, (fresh) => {
          if (fresh && fresh.results) render(fresh, false);
        });
      });
    } else {
      // No cache — show spinner
      showSpinner();
      chrome.runtime.sendMessage({ type: 'refresh' }, () => {
        chrome.runtime.sendMessage({ type: 'getData' }, (data) => render(data, false));
      });
    }
  });
});

function showSpinner() {
  app.innerHTML = '<div class="empty"><span class="spinner">↻</span> Loading...</div>';
}

function render(data, isRefreshing) {
  if (!data || !data.results) {
    showSpinner();
    return;
  }

  const { results, username } = data;
  const needsAttention = results.filter(r => r.myStatus === 'red');
  const others = results.filter(r => r.myStatus !== 'red');
  const sorted = [...needsAttention, ...others];

  const count = needsAttention.length;
  const summaryText = count > 0
    ? `${count} PR${count > 1 ? 's' : ''} need${count === 1 ? 's' : ''} your attention`
    : 'All clear! No PRs waiting on you.';

  app.innerHTML = `
    <div class="header">
      <h1>🦀 Attention Set</h1>
      <button class="refresh-btn" id="refresh">${isRefreshing ? '<span class="spinner">↻</span>' : '↻ Refresh'}</button>
    </div>
    <div class="summary">${summaryText}</div>
    ${sorted.length === 0 ? '<div class="empty">No open PRs found.</div>' : `
    <ul class="pr-list">
      ${sorted.map(pr => {
        const waitingOn = Object.entries(pr.attentionSet || {})
          .filter(([u, s]) => s === 'red' && !isBot(u))
          .map(([u]) => u === username ? `<strong>@${escHtml(u)}</strong>` : `@${escHtml(u)}`);
        return `<li class="pr-item">
          <span class="dot dot-${pr.myStatus}"></span>
          <div class="pr-info">
            <div class="pr-title"><a href="${pr.url}" target="_blank">${escHtml(pr.title)}</a></div>
            <div class="pr-meta">${pr.repo}#${pr.number}${waitingOn.length ? ' · Waiting on: ' + waitingOn.join(', ') : ''}</div>
          </div>
        </li>`;
      }).join('')}
    </ul>`}
  `;

  document.getElementById('refresh').onclick = () => {
    // Show spinner on button
    const btn = document.getElementById('refresh');
    btn.innerHTML = '<span class="spinner">↻</span>';
    btn.disabled = true;
    chrome.runtime.sendMessage({ type: 'refresh' }, () => {
      chrome.runtime.sendMessage({ type: 'getData' }, (fresh) => render(fresh, false));
    });
  };
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
