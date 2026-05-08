# v1.1.0 Release Notes

## ✨ New Features

### Critique-Style Reviewer Display
- **Color = review state**: 🟢 approved, 🔴 changes requested, 🟡 commented, ⚫ pending
- **Bold = in attention set**: see at a glance who needs to act
- PR author is also bolded when in the attention set
- All reviewer names link to GitHub profiles

### PR Classification
- PRs are now grouped into sub-sections with Octicons:
  - 👁 **Incoming** — PRs where you're a reviewer
  - ⛙ **Outgoing** — Your own PRs
  - @ **Mentioned** — PRs where you were @mentioned
- Both "Needs your attention" and "Waiting on others" sections are organized this way
- Users who submitted a review (even without being requested) are classified as Incoming

### Search & Filter
- Real-time search box in popup — filter by PR title, repo, author, PR number, or any reviewer name
- 120ms debounce for smooth typing

### Smart Notifications
- Only notifies when a PR **newly enters** your attention set
- No notification spam on first poll
- No repeated notifications for PRs already in your attention set

### ETag Caching
- Conditional requests with `If-None-Match` — 304 responses don't consume rate limit
- Cached per-timeline-page, cleaned up automatically when PRs close
- ~80-90% reduction in API requests for unchanged PRs

### Repo/Owner Muting (Blacklist)
- ⋮ menu on each PR → "Mute this repo" / "Mute all from [owner]"
- Muted repos/owners hidden from popup and badge count
- Manage muted list in Options (unmute anytime)

### Team Review Support
- `requested_team` events now add you to the attention set
- **Only direct requests** toggle — ignore team review requests
- **Allowed teams** list — exceptions to the above

### Seen Indicator
- **Solid dot** ● = new activity you haven't seen
- **Hollow dot** ○ = you clicked the PR link (seen it)
- Works for both active and dismissed PRs

### Dismissed PR Improvements
- Dismissed PRs stay hidden until manually restored (no auto-restore)
- Blue dot indicator when a dismissed PR has new activity
- Dismiss/mute buttons stacked vertically to save space

### Other
- `notifyNewCommits` toggle in Options
- PR list sorted by latest event time (newest first)
- PR author displayed in meta line with link to profile
- Popup width increased (360px → 420px)
- Pill badge font size increased for readability
- Concurrency increased (6 → 10 parallel requests)

## 🐛 Bug Fixes

- **Badge/popup count mismatch** — both now use identical filtering logic
- **Bot review_requested skipped** — actor being a bot no longer skips the entire event (the reviewer matters, not who requested it)
- **@mentioned after review** — submitting a review now clears you from mentioned + assigned sets
- **Case-insensitive usernames** — `@copilot` and `@Copilot` correctly match
- **msg() TDZ crash** — variable shadowing the `msg` function in error banner
- **PR author not displaying** — nested array flattening bug in DOM construction
- **Dismissed PR author display** — same flattening fix
- **Hardcoded knownBots removed** — now relies on `[bot]` suffix and `type: Bot` field from API
- **Bot handling** — bots requested as reviewers are treated normally; comment-only bots are ignored
- **dismissedClicked cleanup** — no longer grows unbounded for closed/merged PRs

## 🔧 Developer Experience

- **ESLint + Prettier** — zero warnings, consistent code style
- **GitHub CI workflow** — lint + format check + tests on every push/PR
- **181 tests** (up from 105) — attention logic, utils, i18n, notifications, search, DOM, icons
- **i18n translation completeness test** — CI fails if any locale has untranslated keys
- **Coverage tooling** — c8 configured for measuring coverage
- **DRY cleanup** — shared `utils.js`, removed dead code

## 🌍 Internationalization

- **33 locales** (added zh_HK)
- All new keys translated across all locales
- Dialect locales use proper script: 粵語 (繁體), 吳語 (簡體), 客家話 (繁體), 閩南話 (繁體), 文言, ᠮᠣᠩᠭᠣᠯ (traditional Mongolian script)
- Options page reorganized into logical sections: Polling / Display / Notifications
- Repo Filter simplified: allowlist only (muting handles the blacklist)
- `homepage_url` added to manifest (shows in extension context menu)

## 📊 Stats

- **161 commits** since v1.0.0
- **62 files changed**, +16,597 / -1,737 lines
- **181 tests** (was 105)
- **33 locales** (was 31)
