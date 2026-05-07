// i18n wrapper — supports user-selected language override
let overrideMessages = null;

export async function initI18n() {
  const { language } = await chrome.storage.local.get({ language: 'auto' });
  if (language !== 'auto') {
    try {
      const url = chrome.runtime.getURL(`_locales/${language}/messages.json`);
      const res = await fetch(url);
      overrideMessages = await res.json();
    } catch { overrideMessages = null; }
  }
}

export function msg(key) {
  if (overrideMessages && overrideMessages[key]) {
    return overrideMessages[key].message;
  }
  return chrome.i18n.getMessage(key) || key;
}
