# Session Vault

A Chrome extension to save and restore browser sessions — reclaim memory by closing windows, then restore them later with all tabs and tab groups intact.

## Features

- **Save & Close** — snapshot all open windows, then close them to free RAM
- **Restore** — recreate every window, tab, and tab group (names + colors preserved)
- **Save Tab** — save the current tab as a standalone entry (reading-list style)
- **Saved Groups** — file tabs into named groups while browsing; open all at once later
- **Tab Groups** — Chrome tab groups are saved and restored automatically

## Install

1. Open `chrome://extensions`
2. Toggle **Developer mode**
3. Click **Load unpacked**
4. Select the `session-vault` directory

## Permissions

- `tabs` — read tab URLs and titles for saving/restoring
- `storage` — persist sessions, groups, and saved tabs locally
- `tabGroups` — save and restore Chrome tab groups

## Build

No build step. The extension is vanilla HTML/CSS/JS (Manifest V3).
