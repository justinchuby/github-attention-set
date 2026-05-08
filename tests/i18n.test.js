import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chrome API
const chromeMock = {
  storage: { local: { get: vi.fn() } },
  i18n: { getMessage: vi.fn() },
  runtime: { getURL: vi.fn((path) => `chrome-extension://fake/${path}`) },
};
globalThis.chrome = chromeMock;

// Mock fetch
globalThis.fetch = vi.fn();

describe('i18n', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('msg() fallback chain', () => {
    it('returns override message if available', async () => {
      chromeMock.storage.local.get.mockResolvedValue({ language: 'zh_CN' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ greeting: { message: '你好' } }),
      });

      const { initI18n, msg } = await import('../i18n.js');
      await initI18n();
      expect(msg('greeting')).toBe('你好');
    });

    it('falls back to chrome.i18n if no override', async () => {
      chromeMock.storage.local.get.mockResolvedValue({ language: 'auto' });
      chromeMock.i18n.getMessage.mockImplementation((key) => (key === 'greeting' ? 'Hello' : ''));
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ greeting: { message: 'Hello EN' } }),
      });

      const { initI18n, msg } = await import('../i18n.js');
      await initI18n();
      expect(msg('greeting')).toBe('Hello');
    });

    it('falls back to English fallback if chrome.i18n returns empty', async () => {
      chromeMock.storage.local.get.mockResolvedValue({ language: 'auto' });
      chromeMock.i18n.getMessage.mockReturnValue('');
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ greeting: { message: 'Hello EN' } }),
      });

      const { initI18n, msg } = await import('../i18n.js');
      await initI18n();
      expect(msg('greeting')).toBe('Hello EN');
    });

    it('returns key if nothing found', async () => {
      chromeMock.storage.local.get.mockResolvedValue({ language: 'auto' });
      chromeMock.i18n.getMessage.mockReturnValue('');
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({}),
      });

      const { initI18n, msg } = await import('../i18n.js');
      await initI18n();
      expect(msg('unknownKey')).toBe('unknownKey');
    });
  });

  describe('loadOverrideMessages', () => {
    it('loads override for non-auto language', async () => {
      chromeMock.storage.local.get.mockResolvedValue({ language: 'ja' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ save: { message: '保存' } }),
      });

      const { initI18n, msg } = await import('../i18n.js');
      await initI18n();
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('_locales/ja/messages.json'));
      expect(msg('save')).toBe('保存');
    });

    it('handles fetch failure gracefully', async () => {
      chromeMock.storage.local.get.mockResolvedValue({ language: 'xx' });
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('not found');
        return Promise.resolve({
          json: () => Promise.resolve({ hello: { message: 'Hi' } }),
        });
      });

      const { initI18n, msg } = await import('../i18n.js');
      await initI18n();
      // override failed, should fall back
      expect(msg('hello')).toBe('Hi');
    });
  });
});
