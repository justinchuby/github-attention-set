import { describe, it, expect } from 'vitest';
import { getIcon } from '../icons.js';

describe('getIcon', () => {
  it('returns SVG string for known icons', () => {
    const svg = getIcon('sync');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(svg).toContain('width="16"');
  });

  it('respects size parameter', () => {
    const svg = getIcon('x', 24);
    expect(svg).toContain('width="24"');
    expect(svg).toContain('height="24"');
  });

  it('respects color parameter', () => {
    const svg = getIcon('dot-fill', 10, '#d73a49');
    expect(svg).toContain('fill="#d73a49"');
  });

  it('returns empty string for unknown icon', () => {
    expect(getIcon('nonexistent')).toBe('');
  });

  it('all expected icons exist', () => {
    for (const name of ['sync', 'x', 'clock', 'gear', 'dot-fill', 'eye']) {
      expect(getIcon(name)).toContain('<svg');
    }
  });
});
