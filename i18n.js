// i18n wrapper — supports user-selected language override
let overrideMessages = null;
let fallbackMessages = null;

export async function initI18n() {
  const { language } = await chrome.storage.local.get({ language: 'auto' });
  if (language !== 'auto') {
    try {
      const url = chrome.runtime.getURL(`_locales/${language}/messages.json`);
      const res = await fetch(url);
      overrideMessages = await res.json();
    } catch {
      overrideMessages = null;
    }
  }
  // Always load English as fallback
  try {
    const enUrl = chrome.runtime.getURL('_locales/en/messages.json');
    const enRes = await fetch(enUrl);
    fallbackMessages = await enRes.json();
  } catch {
    fallbackMessages = null;
  }
}

export function msg(key) {
  if (overrideMessages && overrideMessages[key]) {
    return overrideMessages[key].message;
  }
  const chromeMsg = chrome.i18n.getMessage(key);
  if (chromeMsg) return chromeMsg;
  // Fallback to English
  if (fallbackMessages && fallbackMessages[key]) {
    return fallbackMessages[key].message;
  }
  return key;
}
