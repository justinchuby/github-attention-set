# GitHub Attention Set

A Chrome extension that brings Google Critique's "Attention Set" concept to GitHub — see at a glance which PRs are waiting on you.

## Features

- 🔴🟢🟡 Signal dots on PR list pages showing what needs your attention
- Status banner on PR detail pages
- Popup with a quick summary of all your PRs
- Badge count on the extension icon
- Automatic dark/light mode support
- Configurable debounce time and poll interval

## Attention Set Logic

**You enter the attention set when:**
| Event | Who enters |
|---|---|
| Someone submits a review | PR Author |
| Reviewer comments (after debounce) | PR Author |
| Author re-requests review | Reviewer |
| Author replies to comment (after debounce) | Reviewer |
| @mention | Mentioned person |

**You leave when:** you take action (comment, review, push, re-request review).

## Setup

1. Load as unpacked extension in `chrome://extensions`
2. Click extension icon → Open Settings
3. Enter a GitHub PAT with `repo` scope
4. Done! The extension polls every 2 minutes by default.

## Requirements

- GitHub Personal Access Token with `repo` scope
- Chrome/Chromium with Manifest V3 support
