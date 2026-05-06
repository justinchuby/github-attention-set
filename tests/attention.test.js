import { describe, it, expect } from 'vitest';
import { computeAttentionSet, isBot } from '../attention.js';

const DEBOUNCE_MIN = 10;
const DEBOUNCE_MS = DEBOUNCE_MIN * 60 * 1000;

// Helper: create a timestamp relative to "now"
function minutesAgo(n, now) {
  return new Date(now - n * 60 * 1000).toISOString();
}

describe('computeAttentionSet', () => {
  const NOW = Date.now();
  const author = 'alice';
  const reviewer = 'bob';

  // 1. Submit review → author enters attention set
  it('submit review → author enters attention set', () => {
    const timeline = [
      { event: 'reviewed', actor: { login: reviewer }, submitted_at: minutesAgo(30, NOW) },
    ];
    const result = computeAttentionSet(timeline, 'charlie', author, DEBOUNCE_MIN, NOW);
    expect(result.set[author]).toBe('red');
    expect(result.set[reviewer]).toBeUndefined();
  });

  // 2. Re-request review → reviewer enters attention set
  it('review_requested → reviewer enters attention set', () => {
    const timeline = [
      { event: 'review_requested', actor: { login: author }, requested_reviewer: { login: reviewer }, created_at: minutesAgo(5, NOW) },
    ];
    const result = computeAttentionSet(timeline, 'charlie', author, DEBOUNCE_MIN, NOW);
    expect(result.set[reviewer]).toBe('red');
    expect(result.set[author]).toBeUndefined();
  });

  // 3. @mention → mentioned person enters attention set
  it('@mention → mentioned person enters attention set', () => {
    const timeline = [
      { event: 'commented', actor: { login: reviewer }, created_at: minutesAgo(30, NOW), body: 'Hey @charlie can you take a look?' },
    ];
    const result = computeAttentionSet(timeline, 'charlie', author, DEBOUNCE_MIN, NOW);
    expect(result.set['charlie']).toBe('red');
    expect(result.myStatus).toBe('red');
  });

  // 4. Single comment + past debounce → flips (author red)
  it('comment past debounce time → author turns red', () => {
    const timeline = [
      { event: "reviewed", actor: { login: "reviewer" }, user: { login: "reviewer" }, state: "commented", submitted_at: "2024-01-01T00:00:00Z" },
      { event: 'commented', actor: { login: reviewer }, created_at: minutesAgo(15, NOW), body: 'LGTM with nits' },
    ];
    const result = computeAttentionSet(timeline, author, author, DEBOUNCE_MIN, NOW);
    expect(result.set[author]).toBe('red');
    expect(result.myStatus).toBe('red');
  });

  // 5. Single comment + within debounce → yellow (not flipped)
  it('comment within debounce time → author stays yellow', () => {
    const timeline = [
      { event: "reviewed", actor: { login: "reviewer" }, user: { login: "reviewer" }, state: "commented", submitted_at: "2024-01-01T00:00:00Z" },
      { event: 'commented', actor: { login: reviewer }, created_at: minutesAgo(5, NOW), body: 'Minor issue' },
    ];
    const result = computeAttentionSet(timeline, author, author, DEBOUNCE_MIN, NOW);
    expect(result.set[author]).toBe('yellow');
    expect(result.myStatus).toBe('yellow');
  });

  // 6. User takes action → leaves attention set
  it('user submits review → they leave attention set', () => {
    const timeline = [
      { event: 'review_requested', actor: { login: author }, requested_reviewer: { login: reviewer }, created_at: minutesAgo(30, NOW) },
      { event: 'reviewed', actor: { login: reviewer }, submitted_at: minutesAgo(10, NOW) },
    ];
    const result = computeAttentionSet(timeline, reviewer, author, DEBOUNCE_MIN, NOW);
    // reviewer was in set, then submitted review → should leave
    expect(result.set[reviewer]).toBeUndefined();
    expect(result.myStatus).toBe('green');
  });

  // 7. Multiple reviewers — independently tracked
  it('multiple reviewers tracked independently', () => {
    const timeline = [
      { event: 'review_requested', actor: { login: author }, requested_reviewer: { login: 'bob' }, created_at: minutesAgo(30, NOW) },
      { event: 'review_requested', actor: { login: author }, requested_reviewer: { login: 'carol' }, created_at: minutesAgo(29, NOW) },
      { event: 'reviewed', actor: { login: 'bob' }, submitted_at: minutesAgo(10, NOW) },
    ];
    const result = computeAttentionSet(timeline, 'carol', author, DEBOUNCE_MIN, NOW);
    // bob reviewed → leaves, carol still in
    expect(result.set['bob']).toBeUndefined();
    expect(result.set['carol']).toBe('red');
    expect(result.set[author]).toBe('red'); // author got attention from bob's review
    expect(result.myStatus).toBe('red'); // carol is in attention set
  });

  // 8. PR just created / review just requested → reviewer in attention set
  it('fresh review request → reviewer in attention set', () => {
    const timeline = [
      { event: 'review_requested', actor: { login: author }, requested_reviewer: { login: reviewer }, created_at: minutesAgo(1, NOW) },
    ];
    const result = computeAttentionSet(timeline, reviewer, author, DEBOUNCE_MIN, NOW);
    expect(result.set[reviewer]).toBe('red');
    expect(result.myStatus).toBe('red');
  });

  // Edge cases
  describe('edge cases', () => {
    it('empty timeline → no one in attention set', () => {
      const result = computeAttentionSet([], 'me', author, DEBOUNCE_MIN, NOW);
      expect(result.set).toEqual({});
      expect(result.myStatus).toBe('green');
    });

    it('single event timeline', () => {
      const timeline = [
        { event: 'reviewed', actor: { login: reviewer }, submitted_at: minutesAgo(5, NOW) },
      ];
      const result = computeAttentionSet(timeline, author, author, DEBOUNCE_MIN, NOW);
      expect(result.set[author]).toBe('red');
    });

    it('reviewer and author are the same person', () => {
      const timeline = [
      { event: "reviewed", actor: { login: "reviewer" }, user: { login: "reviewer" }, state: "commented", submitted_at: "2024-01-01T00:00:00Z" },
        { event: 'review_requested', actor: { login: 'alice' }, requested_reviewer: { login: 'alice' }, created_at: minutesAgo(5, NOW) },
      ];
      const result = computeAttentionSet(timeline, 'alice', 'alice', DEBOUNCE_MIN, NOW);
      // author requests review from themselves — both actor delete and set happen
      expect(result.set['alice']).toBe('red');
    });

    it('debounce boundary — exactly at debounce time', () => {
      const exactlyAtBoundary = new Date(NOW - DEBOUNCE_MS).toISOString();
      const timeline = [
      { event: "reviewed", actor: { login: "reviewer" }, user: { login: "reviewer" }, state: "commented", submitted_at: "2024-01-01T00:00:00Z" },
        { event: 'commented', actor: { login: reviewer }, created_at: exactlyAtBoundary, body: 'comment' },
      ];
      const result = computeAttentionSet(timeline, author, author, DEBOUNCE_MIN, NOW);
      // elapsed === debounceMs → >= check passes → red
      expect(result.set[author]).toBe('red');
    });

    it('debounce boundary — 1ms before debounce', () => {
      const justBefore = new Date(NOW - DEBOUNCE_MS + 1).toISOString();
      const timeline = [
      { event: "reviewed", actor: { login: "reviewer" }, user: { login: "reviewer" }, state: "commented", submitted_at: "2024-01-01T00:00:00Z" },
        { event: 'commented', actor: { login: reviewer }, created_at: justBefore, body: 'comment' },
      ];
      const result = computeAttentionSet(timeline, author, author, DEBOUNCE_MIN, NOW);
      // elapsed < debounceMs → yellow
      expect(result.set[author]).toBe('yellow');
    });

    it('comment by author does not put author in attention set', () => {
      const timeline = [
        { event: 'commented', actor: { login: author }, created_at: minutesAgo(30, NOW), body: 'I fixed this' },
      ];
      const result = computeAttentionSet(timeline, author, author, DEBOUNCE_MIN, NOW);
      expect(result.set[author]).toBeUndefined();
      expect(result.myStatus).toBe('green');
    });
  });
});

describe('isBot', () => {
  it('detects [bot] suffix', () => {
    expect(isBot('github-actions[bot]')).toBe(true);
    expect(isBot('dependabot[bot]')).toBe(true);
    expect(isBot('renovate[bot]')).toBe(true);
  });

  it('detects Bot type from user object', () => {
    expect(isBot('some-app', { type: 'Bot' })).toBe(true);
  });

  it('does not flag regular users', () => {
    expect(isBot('alice')).toBe(false);
    expect(isBot('bob', { type: 'User' })).toBe(false);
  });
});

describe('computeAttentionSet bot filtering', () => {
  const NOW = Date.now();
  it('filters bots from attention set output', () => {
    const timeline = [
      { event: 'review_requested', actor: { login: 'alice' }, requested_reviewer: { login: 'github-actions[bot]' }, created_at: new Date(NOW - 60000).toISOString() },
      { event: 'review_requested', actor: { login: 'alice' }, requested_reviewer: { login: 'bob' }, created_at: new Date(NOW - 60000).toISOString() },
    ];
    const result = computeAttentionSet(timeline, 'bob', 'alice', 10, NOW);
    expect(result.set['github-actions[bot]']).toBeUndefined();
    expect(result.set['bob']).toBe('red');
  });
});
