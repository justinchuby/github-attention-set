// GitHub Attention Set — Options
import { h } from './dom.js';
import { initI18n, msg } from './i18n.js';

await initI18n();

// Apply i18n to data-i18n elements
document.querySelectorAll('[data-i18n]').forEach(el => {
  const m = msg(el.dataset.i18n);
  if (m && m !== el.dataset.i18n) el.textContent = m;
});

const languageEl = document.getElementById('language');
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
  tokenListEl.textContent = '';
  tokens.forEach((entry, i) => {
    const nameInput = h('input', {
      type: 'text',
      value: entry.name,
      placeholder: 'Label (e.g. Personal)',
      'data-idx': String(i),
      'data-field': 'name'
    });
    nameInput.oninput = () => { tokens[i].name = nameInput.value; };

    const tokenInput = h('input', {
      type: 'password',
      value: entry.token,
      placeholder: 'ghp_... or github_pat_...',
      'data-idx': String(i),
      'data-field': 'token'
    });
    tokenInput.oninput = () => { tokens[i].token = tokenInput.value; };

    const removeBtn = h('button', {
      class: 'token-remove',
      'data-idx': String(i),
      title: 'Remove',
      'aria-label': `Remove token ${entry.name || i + 1}`
    }, '✕');
    removeBtn.onclick = () => {
      tokens.splice(i, 1);
      renderTokenList();
    };

    const div = h('div', { class: 'token-entry' }, [nameInput, tokenInput, removeBtn]);
    tokenListEl.appendChild(div);
  });
}

addTokenBtn.onclick = () => {
  tokens.push({ name: '', token: '' });
  renderTokenList();
  const inputs = tokenListEl.querySelectorAll('input[data-field="name"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
};

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
  const validTokens = tokens.filter(t => t.token.trim());
  const settings = {
    tokens: validTokens,
    token: '',
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

// --- Language ---
chrome.storage.local.get({ language: 'auto' }, (s) => {
  languageEl.value = s.language;
});

languageEl.onchange = () => {
  chrome.storage.local.set({ language: languageEl.value }, () => {
    savedEl.style.display = 'inline';
    savedEl.textContent = '✓';
    setTimeout(() => { savedEl.style.display = 'none'; savedEl.textContent = '✓ Saved!'; }, 3000);
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
