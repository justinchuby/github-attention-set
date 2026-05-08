// Shared utility functions for GitHub Attention Set extension.

/**
 * Filter results by repository include/exclude list.
 */
export function applyRepoFilter(results, mode, repoListStr) {
  if (!mode || mode === 'all' || !repoListStr.trim()) return results;
  const repos = new Set(
    repoListStr
      .split('\n')
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean),
  );
  if (repos.size === 0) return results;
  if (mode === 'include') return results.filter((r) => repos.has(r.repo.toLowerCase()));
  return results;
}
