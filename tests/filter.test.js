import { describe, it, expect } from 'vitest';

// Extracted filter logic from popup.js (line 57-59, 379)
function buildFilterText(pr) {
  return `${pr.title} ${pr.repo} ${pr.author} #${pr.number} ${pr.number} ${(pr.allReviewers || []).join(' ')}`;
}

function matchesFilter(pr, query) {
  if (!query) return true;
  const text = buildFilterText(pr).toLowerCase();
  return text.includes(query.toLowerCase());
}

const samplePR = {
  title: 'Fix memory leak in parser',
  repo: 'org/my-project',
  author: 'alice',
  number: 42,
  allReviewers: ['bob', 'carol'],
};

describe('search/filter logic', () => {
  it('empty search matches everything', () => {
    expect(matchesFilter(samplePR, '')).toBe(true);
    expect(matchesFilter(samplePR, null)).toBe(true);
  });

  it('matches by title', () => {
    expect(matchesFilter(samplePR, 'memory leak')).toBe(true);
  });

  it('matches by repo', () => {
    expect(matchesFilter(samplePR, 'my-project')).toBe(true);
  });

  it('matches by author', () => {
    expect(matchesFilter(samplePR, 'alice')).toBe(true);
  });

  it('matches by PR number with #', () => {
    expect(matchesFilter(samplePR, '#42')).toBe(true);
  });

  it('matches by PR number without #', () => {
    expect(matchesFilter(samplePR, '42')).toBe(true);
  });

  it('matches by reviewer name', () => {
    expect(matchesFilter(samplePR, 'carol')).toBe(true);
  });

  it('case insensitive', () => {
    expect(matchesFilter(samplePR, 'FIX MEMORY')).toBe(true);
    expect(matchesFilter(samplePR, 'ALICE')).toBe(true);
  });

  it('no match returns false', () => {
    expect(matchesFilter(samplePR, 'nonexistent')).toBe(false);
  });
});
