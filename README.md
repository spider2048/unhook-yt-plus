# unhook-yt

A Chrome extension that makes YouTube calmer and gives you real control over
channels. It combines the "hide the noise" toggles you know from Unhook with a
genuinely free, open source channel blocker, all in one place.

Everything runs locally in your browser. There are no accounts, no servers and
no network calls from the extension itself.

## Why

Blocking a whole platform only half works. The videos you actually lose hours
to come from specific channels, and most tools either charge for that or make
it a footnote. unhook-yt treats channel blocking as the core feature, and adds
friction where it matters: the blocklist is guarded by a drawn captcha so that
"unblock it real quick" at 1am stops being a one-click decision.

## Features

### Channel blocker

- Multiple blocklist profiles, each with its own channels and its own switch
- Add channels by handle, URL, channel ID or exact name
- One-click "Block" pill on video cards, with a small profile picker dialog
- Right-click context menu on watch pages
- Blocked channels disappear from the home feed and search results
- Their videos redirect to a blocked page instead of playing
- Their channel pages are blocked, and playlists they own are blocked too

### YouTube behavior

Grouped into three cards, with a per-card master dropdown:

- Watch page: hide the video sidebar, recommendations, comments, live chat,
  playlist panel, merch and fundraiser shelves, end screens, video info and
  hover previews; disable the Shift+N next-video keybind
- Home and search: hide the home feed, shorts (including /shorts pages),
  mixes and inapt search results; square thumbnails; disable the hover
  highlight
- Sidebar and navigation: hide the top header, notifications, subscriptions,
  explore and trending, and the "More from YouTube" links

### Built-in guardrails

- Optional captcha gate for the settings page, with 32 or 64 character codes,
  an unlock timer and a cooldown on wrong attempts. There is no reset path;
  that is the point.

## Privacy

The extension collects nothing and reports nothing.

- No analytics, no Google Analytics, no telemetry of any kind
- No requests leave your browser: there is no network code at all
- Your blocklists, toggles and settings live in your browser's local storage
- The only things it reads are the YouTube pages you already have open

For comparison, Unhook's site states it uses Google Analytics to analyze
traffic and records your user agent when you send feedback. unhook-yt has no
such channels by design, and because it is open source you do not have to
take our word for it.

## How it compares

A quick side by side with Unhook, based on its public feature list. Both tools
hide the usual clutter; the differences are in channels, profiles and trust.

| Feature | Unhook | unhook-yt |
| --- | --- | --- |
| Hide home feed, shorts, recommendations, comments, live chat | ✅ | ✅ |
| Open source | ❌ | ✅ |
| Price | ✅ free | ✅ free |
| Channel blocking | ❌ not offered | ✅ free, core feature |
| Block from a video card or context menu | ❌ | ✅ one click |
| Multiple blocklist profiles with per-surface control | ❌ | ✅ |
| Block playlists owned by a channel | ❌ | ✅ |
| Captcha-locked settings against impulsive unblocking | ❌ | ✅ optional |
| Per-channel analytics and channel time blocking | ❌ | ⏳ planned |

## Install

1. Download the zip from the
   [releases page](https://github.com/spider2048/unhook-yt/releases) and
   unzip it somewhere permanent.
2. Open `chrome://extensions` (or `brave://extensions`).
3. Turn on Developer mode, click "Load unpacked" and select the unzipped
   folder.

The `.crx` asset exists for managed installs; Chrome blocks local `.crx`
drag-and-drop installs for regular users, so use the zip.

## Roadmap

- Per-channel analytics: watch time, impressions and blocked attempts, all
  stored locally
- Channel-level time blocking: give a channel a daily time budget instead of
  a hard block, and let the extension enforce it

## Development

```
npm install
npm test
```

Unit tests run with node:test and cover the shared modules (channel matching,
profiles, behavior registry, captcha). Pushing a `v*` tag triggers a GitHub
Actions workflow that runs the tests, packs a signed `.crx` and attaches it
with an unpacked zip to a GitHub release.

## Notes

❗ YouTube changes its page structure often, so selectors may occasionally
need updates; the extension fails quietly rather than breaking your browsing.

This project is not affiliated with YouTube or Unhook. YouTube changes its
page structure often, so selectors may occasionally need updates; the
extension fails quietly rather than breaking your browsing.
