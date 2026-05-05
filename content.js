// GitHub Attention Set — Content Script

(async function() {
  const data = await new Promise(r => chrome.runtime.sendMessage({ type: 'getData' }, r));
  if (!data || !data.results) return;

  const { results, username } = data;
  const url = window.location.href;

  if (isPRListPage()) {
    injectPRListIndicators(results, username);
  } else if (isPRDetailPage()) {
    injectPRDetailBanner(results, username);
  }

  function isPRListPage() {
    return /github\.com\/(pulls|.*\/pulls)/.test(url);
  }

  function isPRDetailPage() {
    return /github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url);
  }

  function injectPRListIndicators(results, username) {
    const rows = document.querySelectorAll('[id^="issue_"],.js-issue-row');
    rows.forEach(row => {
      const link = row.querySelector('a[data-hovercard-type="pull_request"], a[id^="issue_"]');
      if (!link) return;

      const href = link.getAttribute('href') || '';
      const match = href.match(/\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (!match) return;

      const prNum = parseInt(match[3]);
      const repo = `${match[1]}/${match[2]}`;
      const pr = results.find(r => r.number === prNum && r.repo === repo);
      if (!pr) return;

      if (row.querySelector('.gas-indicator')) return;

      const dot = document.createElement('span');
      dot.className = `gas-indicator gas-${pr.myStatus}`;
      dot.title = pr.myStatus === 'red' ? 'Waiting on you' :
                  pr.myStatus === 'yellow' ? 'Debouncing...' : 'Not waiting on you';

      const target = row.querySelector('.d-flex, .flex-auto') || row;
      target.style.position = 'relative';
      target.appendChild(dot);
    });
  }

  function injectPRDetailBanner(results, username) {
    const match = url.match(/\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return;

    const prNum = parseInt(match[3]);
    const repo = `${match[1]}/${match[2]}`;
    const pr = results.find(r => r.number === prNum && r.repo === repo);
    if (!pr) return;

    if (document.querySelector('.gas-detail-banner')) return;

    const banner = document.createElement('div');
    banner.className = `gas-detail-banner gas-banner-${pr.myStatus}`;

    const waitingOn = Object.entries(pr.attentionSet)
      .filter(([_, status]) => status === 'red')
      .map(([user]) => `@${user}`);

    if (pr.myStatus === 'red') {
      banner.textContent = '⏳ Waiting on you';
    } else if (waitingOn.length > 0) {
      banner.textContent = `✓ Waiting on ${waitingOn.join(', ')}`;
    } else {
      banner.textContent = '✓ No one in attention set';
    }

    // Insert after title
    const title = document.querySelector('.gh-header-title, .js-issue-title');
    if (title && title.parentNode) {
      title.parentNode.insertBefore(banner, title.nextSibling);
    }
  }
})();
