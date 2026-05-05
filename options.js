// GitHub Attention Set — Options

const tokenEl = document.getElementById('token');
const debounceEl = document.getElementById('debounce');
const pollEl = document.getElementById('poll');
const notifEl = document.getElementById('notifications');
const saveBtn = document.getElementById('save');
const savedEl = document.getElementById('saved');

// Load
chrome.storage.sync.get({ token: '', debounceMinutes: 10, pollMinutes: 2, notifications: true }, (s) => {
  tokenEl.value = s.token;
  debounceEl.value = s.debounceMinutes;
  pollEl.value = s.pollMinutes;
  notifEl.checked = s.notifications;
});

saveBtn.onclick = () => {
  const settings = {
    token: tokenEl.value.trim(),
    debounceMinutes: parseInt(debounceEl.value) || 10,
    pollMinutes: parseInt(pollEl.value) || 2,
    notifications: notifEl.checked,
  };
  chrome.storage.sync.set(settings, () => {
    savedEl.style.display = 'inline';
    setTimeout(() => savedEl.style.display = 'none', 2000);
    // Update alarm interval
    chrome.alarms.clear('poll', () => {
      chrome.alarms.create('poll', { periodInMinutes: settings.pollMinutes });
    });
  });
};

// Repo Filter
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
