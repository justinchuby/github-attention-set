// GitHub Attention Set — Options

const debounceEl = document.getElementById('debounce');
const pollEl = document.getElementById('poll');
const notifEl = document.getElementById('notifications');
const saveBtn = document.getElementById('save');
const savedEl = document.getElementById('saved');
const tokenListEl = document.getElementById('token-list');
const addTokenBtn = document.getElementById('add-token');

// --- Token list UI ---
let tokens = [];

function renderTokenList() {
  tokenListEl.innerHTML = '';
  tokens.forEach((entry, i) => {
    const div = document.createElement('div');
    div.className = 'token-entry';
    div.innerHTML = `
      <input type="text" value="${escHtml(entry.name)}" placeholder="Label (e.g. Personal)" data-idx="${i}" data-field="name">
      <input type="password" value="${escHtml(entry.token)}" placeholder="ghp_... or github_pat_..." data-idx="${i}" data-field="token">
      <button class="token-remove" data-idx="${i}" title="Remove">✕</button>
    `;
    tokenListEl.appendChild(div);
  });

  // Bind events
  tokenListEl.querySelectorAll('input').forEach(inp => {
    inp.oninput = () => {
      const idx = parseInt(inp.dataset.idx);
      tokens[idx][inp.dataset.field] = inp.value;
    };
  });
  tokenListEl.querySelectorAll('.token-remove').forEach(btn => {
    btn.onclick = () => {
      tokens.splice(parseInt(btn.dataset.idx), 1);
      renderTokenList();
    };
  });
}

addTokenBtn.onclick = () => {
  tokens.push({ name: '', token: '' });
  renderTokenList();
  // Focus the new name input
  const inputs = tokenListEl.querySelectorAll('input[data-field="name"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
};

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Migrate old format ---
function migrateTokens(stored) {
  if (stored.tokens && Array.isArray(stored.tokens)) return stored.tokens;
  if (stored.token) return [{ name: 'Default', token: stored.token }];
  return [];
}

// --- Load ---
chrome.storage.local.get({ token: '', tokens: null, debounceMinutes: 10, pollMinutes: 2, notifications: true, groupByRepo: false }, (s) => {
  tokens = migrateTokens(s);
  if (tokens.length === 0) tokens.push({ name: '', token: '' });
  renderTokenList();
  debounceEl.value = s.debounceMinutes;
  pollEl.value = s.pollMinutes;
  notifEl.checked = s.notifications;
  document.getElementById('groupByRepo').checked = s.groupByRepo === true;
});

// --- Save ---
saveBtn.onclick = () => {
  // Filter out empty tokens
  const validTokens = tokens.filter(t => t.token.trim());
  const settings = {
    tokens: validTokens,
    token: '', // clear legacy field
    debounceMinutes: parseInt(debounceEl.value) || 10,
    pollMinutes: parseInt(pollEl.value) || 2,
    notifications: notifEl.checked,
    groupByRepo: document.getElementById('groupByRepo').checked,
  };
  chrome.storage.local.set(settings, () => {
    savedEl.style.display = 'inline';
    setTimeout(() => savedEl.style.display = 'none', 2000);
    chrome.alarms.clear('poll', () => {
      chrome.alarms.create('poll', { periodInMinutes: settings.pollMinutes });
    });
  });
};

// --- Repo Filter ---
const filterAllEl = document.getElementById('filter-all');
const filterIncludeEl = document.getElementById('filter-include');
const filterExcludeEl = document.getElementById('filter-exclude');
const repoListEl = document.getElementById('repoList');
const saveFilterBtn = document.getElementById('saveFilter');
const savedFilterEl = document.getElementById('savedFilter');

chrome.storage.local.get({ repoFilterMode: 'all', repoFilterList: '' }, (s) => {
  if (s.repoFilterMode === 'include') filterIncludeEl.checked = true;
  else if (s.repoFilterMode === 'exclude') filterExcludeEl.checked = true;
  else filterAllEl.checked = true;
  repoListEl.value = s.repoFilterList;
});

saveFilterBtn.onclick = () => {
  const mode = filterIncludeEl.checked ? 'include' : filterExcludeEl.checked ? 'exclude' : 'all';
  chrome.storage.local.set({ repoFilterMode: mode, repoFilterList: repoListEl.value }, () => {
    savedFilterEl.style.display = 'inline';
    setTimeout(() => savedFilterEl.style.display = 'none', 2000);
  });
};
