/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { getIconElement } from '../icons.js';

describe('getIconElement', () => {
  it('returns SVG element for known icons', () => {
    const svg = getIconElement('sync');
    expect(svg).toBeInstanceOf(SVGElement);
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.getAttribute('width')).toBe('16');
  });

  it('respects size parameter', () => {
    const svg = getIconElement('x', 24);
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
  });

  it('respects color parameter', () => {
    const svg = getIconElement('dot-fill', 10, '#d73a49');
    expect(svg.getAttribute('fill')).toBe('#d73a49');
  });

  it('returns null for unknown icon', () => {
    expect(getIconElement('nonexistent')).toBeNull();
  });

  it('all expected icons exist', () => {
    for (const name of ['sync', 'x', 'clock', 'gear', 'dot-fill', 'eye']) {
      expect(getIconElement(name)).toBeInstanceOf(SVGElement);
    }
  });
});
