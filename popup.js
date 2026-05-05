// GitHub Attention Set — Popup

const app = document.getElementById('app');

chrome.storage.sync.get({ token: '' }, (settings) => {
  if (!settings.token) {
    app.innerHTML = `<div class="no-token">
      <p>No GitHub token configured.</p>
      <p><a href="#" id="open-options">Open Settings</a></p>
    </div>`;
    document.getElementById('open-options').onclick = () => chrome.runtime.openOptionsPage();
    return;
  }

  chrome.runtime.sendMessage({ type: 'getData' }, render);
});

function render(data) {
  if (!data || !data.results) {
    app.innerHTML = '<div class="empty">Loading...</div>';
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
      <button class="refresh-btn" id="refresh">↻ Refresh</button>
    </div>
    <div class="summary">${summaryText}</div>
    ${sorted.length === 0 ? '<div class="empty">No open PRs found.</div>' : `
    <ul class="pr-list">
      ${sorted.map(pr => {
        const waitingOn = Object.entries(pr.attentionSet || {})
          .filter(([_, s]) => s === 'red')
          .map(([u]) => `@${u}`);
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
    chrome.runtime.sendMessage({ type: 'refresh' }, () => {
      chrome.runtime.sendMessage({ type: 'getData' }, render);
    });
  };
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
