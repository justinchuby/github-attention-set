// Core attention set computation — pure function, no Chrome API dependency.

/**
 * Returns true if the user should be considered a bot.
 */
export function isBot(login, userObj) {
  if (!login) return false;
  if (login.includes('[bot]')) return true;
  if (userObj && userObj.type === 'Bot') return true;
  if (userObj && userObj.type === 'Organization') return true;
  // Known bots without [bot] suffix
  const knownBots = ['dependabot', 'renovate', 'github-actions', 'codecov', 'stale'];
  if (knownBots.includes(login.toLowerCase())) return true;
  // Filter numeric-only "usernames" (likely parsing errors)
  if (/^\d+$/.test(login)) return true;
  // Filter non-User types (orgs, mannequins, etc.)
  if (userObj && userObj.type && userObj.type !== 'User') return true;
  return false;
}

export function computeAttentionSet(timeline, me, author, debounceMin, now = Date.now()) {
  const set = new Map(); // user -> { status: 'red'|'yellow', since: timestamp }
  const debounceMs = debounceMin * 60 * 1000;

  for (const event of timeline) {
    const ts = new Date(event.created_at || event.submitted_at || 0).getTime();
    const actor = event.actor?.login || event.user?.login || '';

    switch (event.event || event.__type) {
      case 'reviewed': {
        // Submit review → author enters attention set
        set.delete(actor); // reviewer leaves
        set.set(author, { status: 'red', since: ts });
        break;
      }
      case 'review_requested': {
        // Author requests review → author leaves attention set
        set.delete(actor);
        // Add reviewer to attention set (only if individual, not team/org)
        const reviewer = event.requested_reviewer?.login;
        if (reviewer && !isBot(reviewer, event.requested_reviewer)) {
          set.set(reviewer, { status: 'red', since: ts });
        }
        break;
      }
      case 'commented': {
        // Skip bot comments entirely
        if (isBot(actor, event.actor || event.user)) break;
        // Comment by someone → they leave attention set
        set.delete(actor);
        if (actor === author) {
          // Author replied — simplified: no additional logic in original
        } else {
          // Reviewer commented → author with debounce
          const elapsed = now - ts;
          if (elapsed >= debounceMs) {
            set.set(author, { status: 'red', since: ts });
          } else {
            set.set(author, { status: 'yellow', since: ts });
          }
        }
        break;
      }
      case 'head_ref_force_pushed':
      case 'committed': {
        // Push by author → author leaves
        if (actor === author || event.committer?.login === author) {
          set.delete(author);
        }
        break;
      }
      case 'auto_merge_enabled':
      case 'merged':
      case 'closed': {
        // PR approved/merged/closed → everyone leaves attention set
        set.clear();
        break;
      }
    }

    // @mentions in comment body
    if (event.body) {
      const mentions = event.body.match(/@([a-zA-Z0-9-]+)/g) || [];
      for (const m of mentions) {
        const mentioned = m.slice(1);
        if (mentioned !== actor) {
          set.set(mentioned, { status: 'red', since: ts });
        }
      }
    }
  }

  // Determine my status
  const myEntry = set.get(me);
  // Post-processing: if author is in set but PR never reviewed, ball is with reviewers
  const hasBeenReviewed = timeline.some(e => (e.event || e.__type) === "reviewed");
  if (!hasBeenReviewed && set.has(author)) {
    set.delete(author);
  }

  let myStatus = 'green';
  if (myEntry) {
    myStatus = myEntry.status;
  }

  const setObj = {};
  for (const [user, info] of set) {
    if (!isBot(user)) {
      setObj[user] = info.status;
    }
  }

  return { set: setObj, myStatus };
}
