/*
 * Behavior-feature implementation lanes.
 * Lane 1 (plumbing) defines the registry, then lanes 2-4 run in parallel,
 * each writing exactly one module file. Read the returned outputs, then
 * integrate and live-verify in the parent.
 */
const model = "opencode-go/deepseek-v4.1-flash";
const AGENT = "delegate";
const CWD = "/home/spider/coding/youtube_channel_blocker_extension";

const CONTRACT = `
REGISTRY CONTRACT (implemented by the plumbing lane in src/shared/behavior.js; code against it, do not read or write that file):
globalThis.YCB.behavior.register({ id, css, marker, action, reset })
  - id: one of the 21 behavior ids; first registration per id wins.
  - css: string of CSS rules; you MUST write rules as 'html[data-ycb-behavior~="<id>"] <selector> { display:none !important }'.
  - marker: optional fn(ctx) called once per candidate node per document (the registry keeps a WeakSet per marker); use ctx.markOff(node, id) to hide a node (sets data-ycb-off="<id>", CSS rule [data-ycb-off]{display:none!important}); never use inline styles.
  - action: optional fn(ctx) called on every debounced scan for enabled ids (NOT per node); use for imperative work (pausing videos, clicking autoplay).
  - reset: optional fn() called on every yt-navigate-finish (clears your per-document flags).
ctx passed to marker/action: { markOff(node,id), isMarkedOff(node,id), clearOff(id), squash, isWatchPage, isHomePage, isSearchPage, pauseVideos }.
Root attribute 'data-ycb-behavior' on <html> carries the enabled ids as tokens.
`;

const COMMON = `
HARD CONSTRAINTS: never run rm; never delete files; never kill processes; never call chrome.runtime.reload; never restart the browser; do not write any file other than the one assigned to you.
LIVE VERIFICATION (allowed, read-only): a throwaway Brave runs with --remote-debugging-port=9222 and the extension loaded. Use playwright-core via: import { createRequire } from 'module'; const require = createRequire('/home/spider/coding/youtube_channel_blocker_extension/package.json'); const { chromium } = require('playwright-core'); const browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); Open NEW tabs, wait for hydration (~5-6s), dump DOM facts, CLOSE every tab you open. Do not interact with existing tabs. Unpacked extension files serve from disk; that only matters for options pages, not for youtube.com dumps.
VALIDATION: node --check your file; npm test must stay green (you are not touching tested code paths).
REPORT: final selector set per id tagged verified / not-verified; corrections versus this brief; live evidence (element counts, attribute values you measured).
`;

const plumbingTask = `IMPLEMENTATION LANE 1 (plumbing) for a Chrome MV3 YouTube extension. Read first: manifest.json, src/content/blocker.js, src/shared/profiles.js, src/shared/matching.js, tests/unit/profiles.test.js (test style), and src/options/options.js ONLY lines 1-60 for the BEHAVIORS list (that file is off-limits for writing).

Background: the options page already persists storage key 'behavior' (object of 21 boolean ids, default all false). Planner conclusions you implement now: (a) blocker.js never reads 'behavior' and storage.onChanged ignores it; (b) injectStyle() gives up permanently if documentElement is missing; (c) behavior hiding must be root-attribute-gated CSS plus a separate marker attribute, never reusing data-ycb-hidden.

YOU ARE THE ONLY WRITER of: src/shared/behavior.js, tests/unit/behavior.test.js, src/content/blocker.js, manifest.json, and three stub files src/content/behaviors-site.js, src/content/behaviors-watch.js, src/content/behaviors-extra.js.

1) src/shared/behavior.js: IIFE exposing globalThis.YCB.behavior (style of matching.js/profiles.js; no chrome.*; unit-testable). Exact API:
   - IDS: the 21 ids from options.js BEHAVIORS: homeFeed, videoSidebar, recommended, liveChat, playlist, fundraiser, endScreenFeed, endScreenCards, shorts, comments, mixes, merch, videoInfo, topHeader, notifications, inaptSearch, exploreTrending, moreFromYouTube, subscriptions, autoplay, annotations.
   - normalizeBehavior(raw): plain object id->strict boolean (=== true only); unknown keys dropped; missing ids false.
   - register(spec) where spec = { id, css, marker, action, reset }: registry keyed by id, first registration wins, later duplicates ignored; unknown ids rejected silently.
   - cssBundle(): concatenation of every registered spec's css.
   - tokens(behaviorObj): enabled ids that are also registered.
   - Pure helpers: isMixHref(href) true when href contains 'start_radio=1' or a list id starting with 'RD'; INAPT_SHELF_TITLES = ['people also watched','for you','related to your search','others also watched','explore more','people also search for']; matchesInaptShelfTitle(text) anchored case-insensitive whitespace-squashed match against that list; squash(text).
2) tests/unit/behavior.test.js in the vm-loaded style of profiles.test.js: normalizeBehavior; isMixHref ('/watch?v=x&list=RDABC&start_radio=1' true, 'list=PL123' false, plain watch false); matchesInaptShelfTitle; register + cssBundle + tokens; duplicate-register protection.
3) src/content/blocker.js edits:
   a. injectStyle() retryable: also call it at the top of scheduleScan's callback; parent = document.head || document.documentElement; style content = existing [data-ycb-hidden] rule + NEW '[data-ycb-off]{display:none!important}' + YCB.behavior.cssBundle().
   b. state.behavior; initial chrome.storage.local.get gains 'behavior: {}' and coerces via YCB.behavior.normalizeBehavior.
   c. storage.onChanged accepts changes.behavior: behavior-only change -> re-read storage, update state.behavior, applyBehavior(), scheduleScan(), and NOT clearHidden(); profiles/blockedChannels path unchanged.
   d. applyBehavior(): tokens = YCB.behavior.tokens(state.behavior); write documentElement attribute 'data-ycb-behavior' (space-joined) only when the joined string differs (attribute writes do not re-trigger the childList observer; do not add attributes to the observer config).
   e. scan(): applyBehavior() first; then for each enabled registered spec call spec.marker(ctx) and spec.action(ctx) where ctx = { markOff(node,id) sets data-ycb-off to the id, isMarkedOff(node,id), clearOff(id) removes data-ycb-off wherever its value equals id, squash, isWatchPage, isHomePage, isSearchPage, pauseVideos (reuse the video-pause loop from redirect()) }. The registry keeps a WeakSet per marker so each node is evaluated once per document.
   f. yt-navigate-finish: existing resets PLUS call every registered reset().
4) manifest.json content_scripts (isolated world entry only) js order: matching.js, profiles.js, behavior.js, content/behaviors-site.js, content/behaviors-watch.js, content/behaviors-extra.js, blocker.js LAST (it injects the combined sheet at document_start after all registrations). Create the three module stubs now as minimal IIFEs with a comment 'filled by a separate lane'.
5) Validation: npm test fully green; node --check on every touched file; python3 -c json.load on manifest.json.
6) Final message: the exact API signatures you shipped (the parallel lanes code against this report), plus test results.
`;

const siteTask = `IMPLEMENTATION LANE 2 (site chrome + home). ${COMMON} You write EXACTLY ONE file: src/content/behaviors-site.js (stub exists; overwrite). ${CONTRACT}
Your ids: homeFeed, topHeader, notifications, subscriptions, exploreTrending, moreFromYouTube.
LIVE-DOM FACTS verified today on desktop www.youtube.com (dark, logged out): ytd-masthead#masthead exists; #masthead-container exists; #page-manager margin-top is 56px; ytd-browse[page-subtype="home"] ytd-rich-grid-renderer exists; ytd-feed-filter-chip-bar-renderer exists; #header.ytd-browse exists; ytd-rich-section-renderer ytd-rich-shelf-renderer[is-shorts] exists (not yours, but shape reference); guide anchor hrefs: /, /feed/subscriptions, /feed/you, /feed/history, /channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ, /feed/storefront?bp=ogUCKAU%3D, /channel/UC4R8DWoMoI7CAwX8_LjQHig, /premium, https://music.youtube.com/, https://www.youtubekids.com/?source=youtube_web, /labs, /reporthistory; ytd-guide-section-renderer sections have NO #title in this build - section identity must come from hrefs inside the section. Notification bell NOT found in dump (logged out) -> selector unverified; ship the classic selectors plus the aria-label marker fallback.
Rules: homeFeed - hide ytd-browse[page-subtype="home"] ytd-rich-grid-renderer, ytd-feed-filter-chip-bar-renderer, #header.ytd-browse (all scoped under html[data-ycb-behavior~="homeFeed"]). topHeader - hide ytd-masthead and #masthead-container; layout compensation: html[data-ycb-behavior~="topHeader"] #page-manager { margin-top: 0 !important; } and guide drawer top: 0. notifications - CSS for ytd-masthead ytd-notification-topbar-button-renderer, ytd-masthead #notification-button; PLUS marker fallback: for each direct child of ytd-masthead #buttons, if its aria-label or a descendant aria-label matches /notification/i (squashed) markOff it. subscriptions - CSS ytd-guide-entry-renderer:has(a[href*="/feed/subscriptions"]) and ytd-mini-guide-entry-renderer:has(a[href*="feed/subscriptions"]); guide links only, /feed/subscriptions page stays (decided). exploreTrending - marker pass over ytd-guide-section-renderer: if the section contains a[href*="/feed/trending"] OR a[href*="/feed/explore"] OR a[href*="/feed/storefront"] markOff the SECTION; CSS item fallbacks for ytd-guide-entry-renderer:has(a[href*="/feed/trending"]), :has(a[href*="/feed/explore"]), :has(a[href*="/feed/storefront"]) and the mini-guide twins. moreFromYouTube - marker pass: section containing a[href*="youtube.com/premium"] OR a[href*="music.youtube.com"] OR a[href*="youtubekids.com"] markOff the section; CSS item fallbacks with those three hrefs (entry renderer + mini guide). PRECEDENCE: if a section matches both exploreTrending and moreFromYouTube discriminators, only exploreTrending's marker may mark it (first-match wins) so toggle-off stays exact - implement the check in both markers (skip if already marked with the other id).
`;

const watchTask = `IMPLEMENTATION LANE 3 (watch page). ${COMMON} You write EXACTLY ONE file: src/content/behaviors-watch.js (stub exists; overwrite). ${CONTRACT}
Your ids (all /watch and /live routes; ALWAYS scope under ytd-watch-flexy, never bare ids): videoSidebar - hide #secondary and #secondary-inner (column hide only; NO widening rules). recommended - hide ytd-watch-next-secondary-results-renderer and #related. liveChat - hide ytd-live-chat-frame and #chat-container. playlist - hide ytd-playlist-panel-renderer and #playlist (scoped so /playlist browse pages are untouched). fundraiser - hide ytd-donation-shelf-renderer, ytd-donation-progress-main-renderer (scoped). merch - hide ytd-merch-shelf-renderer, ytd-ticket-shelf-renderer, ytd-offer-shelf-renderer (scoped). videoInfo - FIXED SCOPE: hide only title + views/date rows; keep owner row, subscribe button, action buttons, description. Candidate CSS: ytd-watch-metadata #info-strings, ytd-watch-metadata ytd-video-view-count-renderer, ytd-watch-metadata #above-the-fold #title - BUT you MUST live-verify first (see below) by dumping ytd-watch-metadata structure (direct children ids, #top-row children, where #info-strings/#info sit, where the owner row and #actions sit) and pick the narrowest selectors that hide title+views+date ONLY; if the live DOM contradicts the candidates, adapt and document. endScreenFeed - hide #movie_player .ytp-endscreen-content, .ytp-videowall-still, .ytp-suggestion-set (NOT .ytp-autonav-endscreen; never #movie_player itself). endScreenCards - hide #movie_player .ytp-ce-element and .ytp-ce-covering-overlay. comments - hide ytd-comments#comments, #comments, ytd-comments (all scoped under ytd-watch-flexy).
A prior live dump of the watch page crashed before collecting data, so treat ALL watch selectors as NEEDS-VERIFY: do the live dump yourself (open https://www.youtube.com/watch?v=lTRiuFIWV54 in a NEW tab, ~6s wait), confirm presence of #secondary, #secondary-inner, #related, ytd-watch-next-secondary-results-renderer, ytd-comments#comments, ytd-live-chat-frame, ytd-playlist-panel-renderer, and pick verified containers. If something is absent, ship the closest verified container and leave the guess as an inert comment.
`;

const extraTask = `IMPLEMENTATION LANE 4 (shorts, search, playback). ${COMMON} You write EXACTLY ONE file: src/content/behaviors-extra.js (stub exists; overwrite). ${CONTRACT}
Your ids: shorts, mixes, inaptSearch, autoplay, annotations.
LIVE-DOM FACTS verified today: ytd-rich-section-renderer ytd-rich-shelf-renderer[is-shorts] EXISTS on home; for the query 'lofi hip hop': ytd-reel-item-renderer 0, ytd-playlist-renderer 0, ytd-search-pyv-renderer 0, ytd-compact-playlist-renderer 0 on that watch page, and organic ytd-item-section-renderer sections have NO #title and NO inner ytd-shelf-renderer. Autoplay control NOT captured - live-verify it yourself.
Implement:
shorts - CSS: ytd-shorts, ytd-reel-video-renderer, ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]), ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer, ytd-reel-item-renderer, ytd-rich-item-renderer:has(a[href^="/shorts/"]), ytd-video-renderer:has(a[href^="/shorts/"]) (all html[data-ycb-behavior~="shorts"]-scoped). PLUS action: when enabled AND location.pathname starts with /shorts/, ctx.pauseVideos() every scan (prevents audio leak behind hidden container). NO redirect, NO notice element.
mixes - CSS: ytd-playlist-renderer:has(a[href*="start_radio=1"]), ytd-playlist-renderer:has(a[href*="list=RD"]), ytd-radio-renderer:has(a[href*="start_radio=1"]), ytd-compact-playlist-renderer:has(a[href*="start_radio=1"]), ytd-compact-playlist-renderer:has(a[href*="list=RD"]). NEVER target ytd-playlist-panel-renderer.
inaptSearch - CSS: ytd-reel-item-renderer, ytd-reel-shelf-renderer, plus the two mix rules. PLUS marker pass ONLY when ctx.isSearchPage(): for each ytd-item-section-renderer read header title via first of ('#title', '#header #title', 'ytd-shelf-renderer #title', '#header ytd-shelf-renderer #title'); if YCB.behavior.matchesInaptShelfTitle(squashed title) AND the section contains ytd-shelf-renderer or ytd-search-pyv-renderer or ytd-horizontal-card-list-renderer, markOff the section (organic sections have neither title nor shelf - this protects them).
autoplay - SAFETY CONTRACT, mandatory: candidates in order '.ytp-autoplay-button', 'button[data-tooltip-target-id="ytp-autoplay-toggle"]', '.ytp-autonav-toggle-button'; read state from TWO agreeing signals (aria-checked / aria-pressed / label text containing "is on"); if signals disagree or unreadable, DO NOTHING; bail when not on a watch/shorts page, when #movie_player is absent, or when a channel-block redirect is in progress (state.redirected lives in blocker.js, which you cannot read - just proceed carefully: only act when document.querySelector('#movie_player') exists and the player is not hidden); click at most ONCE per document (spec.reset re-arms on yt-navigate-finish). Live-verify the actual control: open a NEW tab to https://www.youtube.com/watch?v=lTRiuFIWV54 (~6s), dump '#movie_player .ytp-chrome-bottom button' attributes (class, data-tooltip-target-id, aria-label, aria-checked, aria-pressed) and adapt to what you measure. Also verify the shorts page container by opening https://www.youtube.com/shorts (any video) - ytd-shorts vs ytd-reel-video-renderer - and adjust the CSS to what exists.
annotations - CSS: #movie_player .ytp-cards-teaser, .ytp-cards-button, .ytp-cards-teaser-box, .ytp-cards-teaser-text, plus legacy .video-annotations and .annotation (harmless no-ops). Keep .ytp-cards-* separate from .ytp-ce-* (end screens are a different id).
`;

const lanes = await runs.all([
  { key: "site", label: "Implement site chrome + home behaviors", agent: AGENT, model, cwd: CWD, task: siteTask },
  { key: "watch", label: "Implement watch page behaviors", agent: AGENT, model, cwd: CWD, task: watchTask },
  { key: "extra", label: "Implement shorts/search/playback behaviors", agent: AGENT, model, cwd: CWD, task: extraTask },
]);
const plumbing = await runs.run("plumbing", { label: "Implement behavior registry + blocker plumbing", agent: AGENT, model, cwd: CWD, task: plumbingTask });
return { plumbing: plumbing.output, lanes };
