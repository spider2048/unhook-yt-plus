/*
 * Watch-page behaviors (lane 3): /watch, /watch?v=…, /live and /live/…
 *
 * Every behavior below is expressed purely as CSS keyed off the enabled-id
 * tokens on <html data-ycb-behavior="…">; the registry owns that attribute and
 * re-evaluates it when settings change, so there is no per-document state to
 * reset and no marker/action callback is needed.
 *
 * Two hard rules for this file:
 *  1. Every selector is scoped under ytd-watch-flexy, so nothing here can leak
 *     onto /, /results, /playlist, /shorts or channel pages.
 *  2. The player element (#movie_player) is never hidden as a whole — only the
 *     overlay children inside it.
 *
 * Selector status tags come from a live DOM dump of
 * https://www.youtube.com/watch?v=lTRiuFIWV54 (6.5s after load, Chrome 158 /
 * Brave). `verified: N` = measured node count in that dump; `not-verified`
 * means the element did not exist on that page and the rule is the closest
 * known container (inert when absent, correct when YouTube renders it).
 */
(function () {
  "use strict";

  var registry = globalThis.YCB && globalThis.YCB.behavior;
  if (!registry || typeof registry.register !== "function") return;

  /* All ten ids only ever apply inside the watch page shell. */
  var W = "ytd-watch-flexy";
  var P = "#movie_player";

  function css(id, selectors) {
    var head = 'html[data-ycb-behavior~="' + id + '"] ';
    return selectors
      .map(function (selector) {
        return head + selector + " { display: none !important; }";
      })
      .join("\n");
  }

  function reg(id, selectors) {
    registry.register({ id: id, group: "watch", css: css(id, selectors) });
  }

  /* ------------------------------------------------------------------ *
   * videoSidebar — hide the right column, nothing else.
   * The brief is explicit: no widening rules, do not touch the player.
   * verified: #secondary (1), #secondary-inner (1).
   * ------------------------------------------------------------------ */
  reg("videoSidebar", [W + " #secondary", W + " #secondary-inner"]);

  /* ------------------------------------------------------------------ *
   * recommended — the "Up next" list inside the right column.
   * verified: ytd-watch-next-secondary-results-renderer (1, child of
   * #related), #related (2: the live column plus the hidden skeleton host).
   * ------------------------------------------------------------------ */
  reg("recommended", [W + " ytd-watch-next-secondary-results-renderer", W + " #related"]);

  /* ------------------------------------------------------------------ *
   * liveChat — chat / chat replay column block.
   * verified: #chat-container (1, direct child of #secondary-inner),
   * ytd-live-chat-frame#chat (1, inside that container; hidden on a VOD,
   * populated on /live).
   * ------------------------------------------------------------------ */
  reg("liveChat", [W + " ytd-live-chat-frame", W + " #chat-container"]);

  /* ------------------------------------------------------------------ *
   * playlist — the playlist panel beside the player, not browse pages.
   * Scoping under ytd-watch-flexy keeps /playlist?list=… untouched.
   * verified: ytd-playlist-panel-renderer#playlist (1, hidden when no list
   * is active), #playlist (1, same node — kept because ytd-playlist-panel
   * and older layouts use different hosts).
   * ------------------------------------------------------------------ */
  reg("playlist", [W + " ytd-playlist-panel-renderer", W + " #playlist"]);

  /* ------------------------------------------------------------------ *
   * fundraiser — donation shelf / donation progress bar.
   * verified container: #donation-shelf (1, empty slot in #secondary-inner).
   * not-verified: ytd-donation-shelf-renderer (0) and
   * ytd-donation-progress-main-renderer (0) render inside that slot only
   * for fundraisers; both rules are inert when the elements are absent.
   * ------------------------------------------------------------------ */
  reg("fundraiser", [
    W + " ytd-donation-shelf-renderer",
    W + " ytd-donation-progress-main-renderer",
    W + " #donation-shelf"
  ]);

  /* ------------------------------------------------------------------ *
   * merch — merch / ticket / offer shelves.
   * verified: ytd-merch-shelf-renderer (2: one in the (hidden) structured
   * description, one in the description engagement panel).
   * not-verified: ytd-ticket-shelf-renderer (0), ytd-offer-shelf-renderer
   * (0) on a video with no ticketing/offers.
   * ------------------------------------------------------------------ */
  reg("merch", [
    W + " ytd-merch-shelf-renderer",
    W + " ytd-ticket-shelf-renderer",
    W + " ytd-offer-shelf-renderer"
  ]);

  /* ------------------------------------------------------------------ *
   * videoInfo — the ENTIRE metadata block under the player.
   * User report: hiding only #title + ytd-watch-info-text still left the
   * owner row (name, subscriber count, Subscribe), like count and the
   * description teaser visible, so "video info appears". Scope widened to
   * the whole block: ytd-watch-metadata (title, views/date, owner row,
   * actions, description) plus the legacy renderer fallback.
   *
   * Live DOM of ytd-watch-metadata (Chrome 158):
   *   #above-the-fold > #title-row > #title
   *   #top-row > #owner.item | #actions.item
   *   #bottom-row > #description.item
   * verified: ytd-watch-metadata (1), ytd-video-primary-info-renderer
   * (present as an empty legacy slot).
   *
   * Live DOM of ytd-watch-metadata (Chrome 158):
   *   #above-the-fold
   *     #title-row
   *       #title                    <- the title text
   *     #top-row
   *       #owner.item               <- owner row (kept)
   *       #actions.item             <- like/share buttons (kept)
   *     #middle-row                 <- empty on this page
   *     #bottom-row
   *       #description.item
   *         #description-inner
   *           ytd-watch-info-text#ytd-watch-info-text  <- "138M views 6y ago"
   *           ytd-text-inline-expander                 <- description (kept)
   *
   * Corrections versus the brief's candidate rules:
   *  - "ytd-watch-metadata ytd-video-view-count-renderer" matches nothing:
   *    the view-count renderer lives in the legacy
   *    ytd-video-primary-info-renderer, which hangs off
   *    #below > #info (hidden) — not off ytd-watch-metadata.
   *  - "ytd-watch-metadata #info-strings" also matches the legacy block only
   *    (#info-strings is inside ytd-video-primary-info-renderer); on the
   *    current layout the views/date line is ytd-watch-info-text.
   * verified: #above-the-fold #title (1), ytd-watch-info-text (1, 431x20,
   * text "138M views  6y ago  3 products").
   * Double-scoped (W + " ytd-watch-metadata") on purpose: the metadata
   * element is a child of ytd-watch-flexy, and this also keeps every rule in
   * this file inside the watch page.
   * ------------------------------------------------------------------ */
  reg("videoInfo", [
    W + " ytd-watch-metadata",
    /* Legacy layout fallback (pre-refresh metadata under the player). */
    W + " ytd-video-primary-info-renderer"
  ]);

  /* ------------------------------------------------------------------ *
   * endScreenFeed — end-of-video feed stills.
   * verified: .ytp-endscreen-content (1), .ytp-suggestion-set (12).
   * not-verified: .ytp-videowall-still (0; only present on some videos).
   * Deliberately NOT hidden: .ytp-autonav-endscreen (the countdown/cancel
   * chrome, owned by the autoplay behavior) and #movie_player itself.
   * ------------------------------------------------------------------ */
  reg("endScreenFeed", [
    P + " .ytp-endscreen-content",
    P + " .ytp-videowall-still",
    P + " .ytp-suggestion-set"
  ]);

  /* ------------------------------------------------------------------ *
   * endScreenCards — the clickable info cards over the player.
   * verified: .ytp-ce-element (3), .ytp-ce-covering-overlay (2).
   * ------------------------------------------------------------------ */
  reg("endScreenCards", [P + " .ytp-ce-element", P + " .ytp-ce-covering-overlay"]);

  /* ------------------------------------------------------------------ *
   * blockShiftN — swallow the Shift+N "play next video" keybind on watch
   * pages. No CSS: a capturing keydown listener installed once per document
   * (marker guard) prevents the event from ever reaching YouTube's own
   * keyboard handler; scoped to /watch and /live by pathname at press time.
   * ------------------------------------------------------------------ */
  var shiftNBound = false;
  registry.register({
    id: "blockShiftN", group: "watch",
    marker: function () {
      if (shiftNBound) return;
      shiftNBound = true;
      document.addEventListener("keydown", function (event) {
        if (!event.shiftKey || (event.key !== "N" && event.key !== "n")) return;
        if (!/^\/(?:watch|live)(?:\/|$)/.test(location.pathname)) return;
        event.preventDefault();
        event.stopPropagation();
      }, true);
    }
  });

  /* ------------------------------------------------------------------ *
   * comments — the comment section under the player.
   * verified: ytd-comments#comments (1, 923x4065), #comments (1, same node).
   * A second ytd-comments (0x0) exists inside the description engagement
   * panel; it is matched too and is harmless.
   * ------------------------------------------------------------------ */
  reg("comments", [W + " ytd-comments#comments", W + " #comments", W + " ytd-comments"]);
})();
