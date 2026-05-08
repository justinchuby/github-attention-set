import { describe, it, expect } from 'vitest';

// Extract the notification decision logic from background.js (lines 248-254)
// as a pure testable function
function shouldNotify(pr, lastNotifiedPRs, isFirstPoll) {
  if (isFirstPoll) return false;
  if (pr.myStatus !== 'red') return false;
  const prev = lastNotifiedPRs[pr.url];
  if (prev && prev === 'red') return false; // already notified
  return true;
}

describe('notification decision logic', () => {
  const redPR = { url: 'https://github.com/org/repo/pull/1', myStatus: 'red', title: 'Fix bug' };
  const greenPR = { url: 'https://github.com/org/repo/pull/2', myStatus: 'green', title: 'OK' };

  it('new red PR triggers notification', () => {
    expect(shouldNotify(redPR, {}, false)).toBe(true);
  });

  it('already notified red PR does NOT trigger notification', () => {
    const lastNotified = { [redPR.url]: 'red' };
    expect(shouldNotify(redPR, lastNotified, false)).toBe(false);
  });

  it('first poll never triggers notification', () => {
    expect(shouldNotify(redPR, {}, true)).toBe(false);
  });

  it('green PR does NOT trigger notification', () => {
    expect(shouldNotify(greenPR, {}, false)).toBe(false);
  });

  it('previously green now red PR triggers notification', () => {
    const lastNotified = { [redPR.url]: 'green' };
    expect(shouldNotify(redPR, lastNotified, false)).toBe(true);
  });
});
