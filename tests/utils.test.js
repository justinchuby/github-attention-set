import { describe, it, expect } from 'vitest';
import { applyRepoFilter } from '../utils.js';

const results = [
  { repo: 'org/RepoA', title: 'PR1' },
  { repo: 'org/RepoB', title: 'PR2' },
  { repo: 'other/RepoC', title: 'PR3' },
];

describe('applyRepoFilter', () => {
  it('mode=all returns everything', () => {
    expect(applyRepoFilter(results, 'all', 'org/RepoA')).toEqual(results);
  });

  it('no mode returns everything', () => {
    expect(applyRepoFilter(results, '', 'org/RepoA')).toEqual(results);
  });

  it('include mode keeps only listed repos', () => {
    expect(applyRepoFilter(results, 'include', 'org/RepoA\norg/RepoB')).toEqual([
      results[0],
      results[1],
    ]);
  });

  it('exclude mode removes listed repos', () => {
    expect(applyRepoFilter(results, 'exclude', 'org/RepoA')).toEqual([results[1], results[2]]);
  });

  it('empty list returns everything regardless of mode', () => {
    expect(applyRepoFilter(results, 'include', '')).toEqual(results);
    expect(applyRepoFilter(results, 'include', '  \n  ')).toEqual(results);
  });

  it('case insensitive matching', () => {
    expect(applyRepoFilter(results, 'include', 'ORG/REPOA')).toEqual([results[0]]);
  });

  it('multiline list with whitespace', () => {
    expect(applyRepoFilter(results, 'include', '  org/RepoA  \n  other/RepoC  \n')).toEqual([
      results[0],
      results[2],
    ]);
  });
});
