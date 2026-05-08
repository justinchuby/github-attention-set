/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { h } from '../dom.js';

describe('h() DOM helper', () => {
  it('creates an element with the given tag', () => {
    const el = h('div');
    expect(el.tagName).toBe('DIV');
  });

  it('sets attributes', () => {
    const el = h('a', { href: 'https://example.com', target: '_blank' });
    expect(el.getAttribute('href')).toBe('https://example.com');
    expect(el.getAttribute('target')).toBe('_blank');
  });

  it('sets className via className attr', () => {
    const el = h('div', { className: 'foo bar' });
    expect(el.className).toBe('foo bar');
  });

  it('sets class via class attr', () => {
    const el = h('div', { class: 'baz' });
    expect(el.getAttribute('class')).toBe('baz');
  });

  it('applies style object', () => {
    const el = h('div', { style: { color: 'red', fontSize: '14px' } });
    expect(el.style.color).toBe('red');
    expect(el.style.fontSize).toBe('14px');
  });

  it('adds event listeners for on* attrs', () => {
    let clicked = false;
    const el = h('button', {
      onclick: () => {
        clicked = true;
      },
    });
    el.click();
    expect(clicked).toBe(true);
  });

  it('skips null/undefined/false attribute values', () => {
    const el = h('div', { 'data-x': null, 'data-y': undefined, 'data-z': false });
    expect(el.hasAttribute('data-x')).toBe(false);
    expect(el.hasAttribute('data-y')).toBe(false);
    expect(el.hasAttribute('data-z')).toBe(false);
  });

  it('appends text children', () => {
    const el = h('span', null, 'hello');
    expect(el.textContent).toBe('hello');
    expect(el.childNodes[0].nodeType).toBe(3); // TEXT_NODE
  });

  it('appends number children as text', () => {
    const el = h('span', null, 42);
    expect(el.textContent).toBe('42');
  });

  it('appends element children', () => {
    const child = h('em', null, 'bold');
    const el = h('div', null, child);
    expect(el.children[0].tagName).toBe('EM');
  });

  it('appends array of mixed children', () => {
    const el = h('div', null, ['text', h('span', null, 'inner'), 42, null, false]);
    // text + span + 42 = 3 child nodes (null/false skipped)
    expect(el.childNodes.length).toBe(3);
  });

  it('handles no children', () => {
    const el = h('br');
    expect(el.childNodes.length).toBe(0);
  });
});
