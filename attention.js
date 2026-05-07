// Core attention set computation — pure function, no Chrome API dependency.

/**
 * Returns true if the user should be considered a bot.
 */
export function isBot(login, userObj) {
  if (!login) return false;
  if (login.includes('[bot]')) return true;
  if (userObj && userObj.type === 'Bot') return true;
  if (userObj && userObj.type === 'Organization') return true;
  const knownBots = ['dependabot', 'renovate', 'github-actions', 'codecov', 'stale'];
  if (knownBots.includes(login.toLowerCase())) return true;
  if (/^\d+$/.test(login)) return true;
  if (userObj && userObj.type && userObj.type !== 'User') return true;
  return false;
}

// PR states
const STATE = {
  DRAFT: 'DRAFT',
  REVIEWING: 'REVIEWING',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  COMMENTED: 'COMMENTED',
  APPROVED_NO_AUTOMERGE: 'APPROVED_NO_AUTOMERGE',
  MERGING: 'MERGING',
  STALLED_MERGE: 'STALLED_MERGE',
  MERGED: 'MERGED',
  CLOSED: 'CLOSED',
};

const AUTO_MERGE_ON = new Set(['auto_merge_enabled', 'auto_squash_enabled', 'auto_rebase_enabled', 'added_to_merge_queue']);
const AUTO_MERGE_OFF = new Set(['auto_merge_disabled', 'removed_from_merge_queue']);

export function computeAttentionSet(timeline, me, author, debounceMin, now = Date.now()) {
  const debounceMs = debounceMin * 60 * 1000;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  // --- Step 1: Determine PR state ---
  let prState = STATE.REVIEWING; // default: waiting for review
  let autoMergeActive = false;
  let lastActivityAt = 0; // last non-bot event timestamp
  let requestedReviewers = new Set(); // track current requested reviewers
  let commentedAt = 0; // timestamp of the commented review (for debounce)

  // Additional tracking for attention set extras
  const mentioned = new Map(); // user -> { status, since }
  const assigned = new Set();

  for (const event of timeline) {
    const type = event.event || event.__type;
    const ts = new Date(event.created_at || event.submitted_at || 0).getTime();
    const actor = event.actor?.login || event.user?.login || '';
    const actorObj = event.actor || event.user;

    // Track last non-bot activity
    if (!isBot(actor, actorObj) && ts > lastActivityAt) {
      lastActivityAt = ts;
    }

    // Track auto-merge status
    if (AUTO_MERGE_ON.has(type)) autoMergeActive = true;
    if (AUTO_MERGE_OFF.has(type)) autoMergeActive = false;

    switch (type) {
      case 'convert_to_draft':
        prState = STATE.DRAFT;
        break;

      case 'ready_for_review':
        prState = STATE.REVIEWING;
        break;

      case 'review_requested': {
        if (isBot(actor, actorObj)) break;
        const reviewer = event.requested_reviewer?.login;
        if (reviewer && !isBot(reviewer, event.requested_reviewer)) {
          requestedReviewers.add(reviewer);
        }
        // If author re-requests review, transition to REVIEWING
        if (actor === author) {
          prState = STATE.REVIEWING;
        }
        break;
      }

      case 'review_request_removed': {
        const removed = event.requested_reviewer?.login;
        if (removed) requestedReviewers.delete(removed);
        break;
      }

      case 'reviewed': {
        if (isBot(actor, actorObj)) break;
        const reviewState = event.state;
        // Reviewer leaves requested set
        requestedReviewers.delete(actor);

        if (reviewState === 'changes_requested') {
          prState = STATE.CHANGES_REQUESTED;
        } else if (reviewState === 'commented') {
          commentedAt = ts;
          const elapsed = now - ts;
          if (elapsed >= debounceMs) {
            prState = STATE.COMMENTED;
          }
          // If within debounce, keep current state (or mark COMMENTED for yellow handling)
          // We'll handle debounce in myStatus calculation
          if (elapsed < debounceMs) {
            // Mark as commented but within debounce
            prState = STATE.COMMENTED;
          }
        } else if (reviewState === 'approved') {
          if (autoMergeActive) {
            const timeSinceLastActivity = now - Math.max(lastActivityAt, ts);
            if (timeSinceLastActivity > TWENTY_FOUR_HOURS) {
              prState = STATE.STALLED_MERGE;
            } else {
              prState = STATE.MERGING;
            }
          } else {
            prState = STATE.APPROVED_NO_AUTOMERGE;
          }
        }
        break;
      }

      case 'committed':
      case 'head_ref_force_pushed': {
        const committer = event.committer?.login || actor;
        // Author commits don't auto-transition to REVIEWING
        // Only transitions if author also re-requested review (handled in review_requested)
        break;
      }

      case 'merged':
        prState = STATE.MERGED;
        break;

      case 'closed':
        prState = STATE.CLOSED;
        break;

      case 'assigned': {
        const assignee = event.assignee?.login;
        if (assignee && assignee !== author && !isBot(assignee, event.assignee)) {
          assigned.add(assignee);
        }
        break;
      }

      case 'unassigned': {
        const unassignee = event.assignee?.login;
        if (unassignee) assigned.delete(unassignee);
        break;
      }
    }

    // @mentions in comment body
    if (event.body && !isBot(actor, actorObj)) {
      const mentions = event.body.match(/@([a-zA-Z0-9-]+)/g) || [];
      for (const m of mentions) {
        const user = m.slice(1);
        if (user !== actor && !isBot(user)) {
          mentioned.set(user, { status: 'red', since: ts });
        }
      }
    }
  }

  // Post-processing: reconcile state with final autoMerge status
  if (prState === STATE.APPROVED_NO_AUTOMERGE && autoMergeActive) {
    const timeSinceLastActivity = now - lastActivityAt;
    if (timeSinceLastActivity > TWENTY_FOUR_HOURS) {
      prState = STATE.STALLED_MERGE;
    } else {
      prState = STATE.MERGING;
    }
  } else if ((prState === STATE.MERGING || prState === STATE.STALLED_MERGE) && !autoMergeActive) {
    prState = STATE.APPROVED_NO_AUTOMERGE;
  }

  // --- Step 2: Build attention set based on state ---
  const set = {};

  switch (prState) {
    case STATE.DRAFT:
    case STATE.MERGING:
    case STATE.MERGED:
    case STATE.CLOSED:
      // Nobody in attention set
      break;

    case STATE.REVIEWING:
      for (const reviewer of requestedReviewers) {
        if (!isBot(reviewer)) {
          set[reviewer] = 'red';
        }
      }
      break;

    case STATE.CHANGES_REQUESTED:
      set[author] = 'red';
      break;

    case STATE.COMMENTED: {
      const elapsed = now - commentedAt;
      if (elapsed >= debounceMs) {
        set[author] = 'red';
      } else {
        set[author] = 'yellow';
      }
      break;
    }

    case STATE.APPROVED_NO_AUTOMERGE:
      set[author] = 'red';
      break;

    case STATE.STALLED_MERGE:
      set[author] = 'red';
      break;
  }

  // --- Additional rules (override state-based set) ---
  // @mentions
  for (const [user, info] of mentioned) {
    if (!set[user]) {
      set[user] = info.status;
    }
  }

  // Assigned (non-author)
  for (const user of assigned) {
    if (!set[user]) {
      set[user] = 'red';
    }
  }

  // review_request_removed already handled by removing from requestedReviewers

  // Filter bots from final output
  for (const user of Object.keys(set)) {
    if (isBot(user)) {
      delete set[user];
    }
  }

  // --- Step 3: Compute myStatus ---
  let myStatus = 'green';
  if (set[me]) {
    myStatus = set[me];
  }

  return { set, myStatus, prState };
}
