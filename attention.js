// Core attention set computation — pure function, no Chrome API dependency.

/**
 * Returns true if the user should be considered a bot.
 */
export function isBot(login, userObj) {
  if (!login) return false;
  if (login.includes('[bot]')) return true;
  if (userObj && userObj.type === 'Bot') return true;
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
        // Author re-requests review → reviewer enters
        const reviewer = event.requested_reviewer?.login;
        if (reviewer) {
          set.delete(actor); // author leaves
          set.set(reviewer, { status: 'red', since: ts });
        }
        break;
      }
      case 'commented': {
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
