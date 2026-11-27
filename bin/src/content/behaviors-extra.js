/*
 * Behavior lane 4 - shorts, search noise, and player behavior.
 *
 * Ids owned here: shorts, mixes, inaptSearch, autoplay, annotations.
 *
 * Live-DOM notes (www.youtube.com desktop, Brave/Chrome 158, logged out,
 * measured 2026-11-27):
 *  - /shorts/<id> renders as ytd-shorts > #shorts-container with
 *    ytd-reel-video-renderer inside; two <video> elements exist. Hiding the
 *    container does NOT stop audio, so the `shorts` behavior carries an
 *    imperative pause pass that runs on every scan while on /shorts/.
 *  - The autoplay control is button.ytp-autonav-toggle with
 *    data-tooltip-target-id="ytp-autonav-toggle-button". It exposes state
 *    ONLY through aria-label ("Autoplay is on" / "Autoplay is off");
 *    aria-checked and aria-pressed are absent. The safety rule is therefore:
 *    click only when the label clearly reads "is on"; do nothing when it
 *    reads "is off" or is unrecognizable. One click per document, re-armed
 *    on yt-navigate-finish via spec.reset.
 *  - .ytp-cards-teaser / .ytp-cards-button exist (info cards); .ytp-ce-element
 *    and .ytp-endscreen-content exist (end screens, owned by watch lane).
 *  - The guide/mini-guide 'Shorts' entry renders WITHOUT an <a> anchor
 *    (JS-only navigation), verified live: hidden by a text marker, not CSS.
 *  - /shorts/<id> pages now REDIRECT to the extension's blocked page
 *    (kind=shorts) once per document, instead of only hiding + pausing.
 *  - Search mixes (ytd-playlist-renderer with start_radio/list=RD) did not
 *    appear in the probe query; those rules are inert until YouTube renders
 *    them and are tagged not-verified.
 *  - CORRECTION after a live 'funny shorts' search: shorts in /results render
 *    as ytm-shorts-lockup-view-model (a view-model component, 30 instances),
 *    NOT as ytd-reel-item-renderer. Rules for that lockup and its
 *    ytd-item-renderer wrapper are verified by holder counts.
 */
(function () {
  "use strict";

  var registry = globalThis.YCB && globalThis.YCB.behavior;
  if (!registry || typeof registry.register !== "function") return;

  function rule(id, selector, decl) {
    return 'html[data-ycb-behavior~="' + id + '"] ' + selector +
      " { " + (decl || "display: none !important") + " }";
  }

  function cssFor(id, selectors, decl) {
    return selectors.map(function (selector) {
      return rule(id, selector, decl);
    }).join("\n");
  }

  /* ------------------------------------------------------------------ *
   * shorts — hide every shorts surface and stop playback on /shorts/.
   * The `shelves` rules reuse ytd-rich-section-renderer wrapping verified
   * in the home dump; the /results rules are not-verified (inert until a
   * query renders shorts/mixes).
   * ------------------------------------------------------------------ */
  registry.register({
    id: "shorts", group: "home",
    css: cssFor("shorts", [
      "ytd-shorts",
      "ytd-shorts #shorts-container",
      "ytd-reel-video-renderer",
      'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
      "ytd-rich-shelf-renderer[is-shorts]",
      "ytd-reel-shelf-renderer",
      "ytd-reel-item-renderer",
      'ytd-rich-item-renderer:has(a[href^="/shorts/"])',
      'ytd-video-renderer:has(a[href^="/shorts/"])',
      /* view-model shelves on /results: header + cards in one element
       * (live-verified: 'Latest Shorts from …', 'Shorts' with 4-10 lockups) */
      "grid-shelf-view-model:has(ytm-shorts-lockup-view-model)",
      /* /results (and other surfaces) render shorts as view-model lockups. */
      "ytm-shorts-lockup-view-model",
      'ytd-item-renderer:has(ytm-shorts-lockup-view-model)',
      /* guide + mini-guide sidebar entries, identified by href (locale-safe). */
      'ytd-guide-entry-renderer:has(a[href^="/shorts"])',
      'ytd-mini-guide-entry-renderer:has(a[href^="/shorts"])'
    ]),
    marker: guideShortsMarker,
    action: function (ctx) {
      if (location.pathname.indexOf("/shorts/") !== 0) return;
      ctx.pauseVideos();
      /* Redirect to the blocked page once per document (reset re-arms on
       * navigation). blocked.html is an extension page, so no loop. */
      if (shortsRedirected) return;
      shortsRedirected = true;
      try {
        location.replace(chrome.runtime.getURL("src/blocked/blocked.html") +
          "?ch=Shorts&kind=shorts");
      } catch (error) {
        /* stay hidden and paused instead */
      }
    },
    reset: function () {
      shortsRedirected = false;
    }
  });

  /* ------------------------------------------------------------------ *
   * Guide/mini-guide "Shorts" entry: live-verified that it renders without
   * any <a> anchor (navigation is JS-only), so the :has(a[href^="/shorts"])
   * CSS rule cannot match it. Identify by entry text instead; localized
   * labels outside English stay visible (under-hide beats over-hide).
   * ------------------------------------------------------------------ */
  var shortsRedirected = false;

  function guideShortsMarker(ctx) {
    var entries = document.querySelectorAll(
      "ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer"
    );
    for (var i = 0; i < entries.length; i += 1) {
      var entry = entries[i];
      if (ctx.isMarkedOff(entry, "shorts")) continue;
      if (entry.querySelector('a[href^="/shorts"]')) {
        ctx.markOff(entry, "shorts");
        continue;
      }
      var label = ctx.squash(entry.textContent).toLowerCase();
      if (label === "shorts") ctx.markOff(entry, "shorts");
    }
    /* the 'Shorts' filter chip in the search/home chip bars */
    var chips = document.querySelectorAll("yt-chip-cloud-chip-renderer");
    for (var j = 0; j < chips.length; j += 1) {
      var chip = chips[j];
      if (ctx.isMarkedOff(chip, "shorts")) continue;
      if (ctx.squash(chip.textContent).toLowerCase() === "shorts") {
        ctx.markOff(chip, "shorts");
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * mixes — YouTube Mix / radio playlists only (list=RD*, start_radio=1).
   * User playlists (list=PL*) and the active queue
   * (ytd-playlist-panel-renderer) are deliberately out of scope.
   * not-verified: ytd-radio-renderer is a legacy form.
   * ------------------------------------------------------------------ */
  registry.register({
    id: "mixes", group: "home",
    css: cssFor("mixes", [
      'ytd-playlist-renderer:has(a[href*="start_radio=1"])',
      'ytd-playlist-renderer:has(a[href*="list=RD"])',
      'ytd-radio-renderer:has(a[href*="start_radio=1"])',
      'ytd-compact-playlist-renderer:has(a[href*="start_radio=1"])',
      'ytd-compact-playlist-renderer:has(a[href*="list=RD"])'
    ])
  });

  /* ------------------------------------------------------------------ *
   * inaptSearch — shorts/mixes in /results plus recommendation shelves
   * ("People also watched", "For you", …). A section is marked only when
   * its header title matches AND it contains a shelf/pyv/card renderer,
   * which protects organic sections (verified: they have neither).
   * ------------------------------------------------------------------ */
  function inaptShelfMarker(ctx) {
    var sections = document.querySelectorAll("ytd-item-section-renderer");
    for (var i = 0; i < sections.length; i += 1) {
      var section = sections[i];
      if (ctx.isMarkedOff(section, "inaptSearch")) continue;
      var header = section.querySelector("#title") ||
        section.querySelector("#header #title") ||
        section.querySelector("ytd-shelf-renderer #title") ||
        section.querySelector("#header ytd-shelf-renderer #title");
      if (!header) continue;
      if (!registry.matchesInaptShelfTitle(header.textContent)) continue;
      var isShelfSection = section.querySelector("ytd-shelf-renderer") ||
        section.querySelector("ytd-search-pyv-renderer") ||
        section.querySelector("ytd-horizontal-card-list-renderer");
      if (!isShelfSection) continue;
      ctx.markOff(section, "inaptSearch");
    }
    /* Live correction (user tab, '301 diaries' query): a noise shelf can carry
     * BOTH a #title (the playlist name, e.g. "301 Diaries dark confessions")
     * and a #subtitle ("People also search for"). The first matching label
     * must win, so evaluate title and subtitle independently. */
    var shelves = document.querySelectorAll("ytd-shelf-renderer");
    for (var j = 0; j < shelves.length; j += 1) {
      var shelf = shelves[j];
      var labels = shelf.querySelectorAll("#title, #dismissible yt-formatted-string#subtitle, #subtitle");
      var matched = false;
      for (var k = 0; k < labels.length; k += 1) {
        if (registry.matchesInaptShelfTitle(labels[k].textContent)) {
          matched = true;
          break;
        }
      }
      if (!matched) continue;
      var wrapper = shelf.closest("ytd-item-section-renderer") || shelf;
      ctx.markOff(wrapper, "inaptSearch");
    }
  }

  registry.register({
    id: "inaptSearch", group: "home",
    css: cssFor("inaptSearch", [
      "ytd-reel-item-renderer",
      "ytd-reel-shelf-renderer",
      "ytm-shorts-lockup-view-model",
      'ytd-item-renderer:has(ytm-shorts-lockup-view-model)',
      'ytd-playlist-renderer:has(a[href*="start_radio=1"])',
      'ytd-playlist-renderer:has(a[href*="list=RD"])',
      'ytd-radio-renderer:has(a[href*="start_radio=1"])'
    ]),
    marker: inaptShelfMarker
  });

  /* autoplay is intentionally not implemented here: the user discarded it
   * (another extension handles it better). The id stays in the registry's
   * IDS list but nothing registers a spec, so the toggle can never enable. */

  /* ------------------------------------------------------------------ *
   * hoverPreviews — stop the inline player that autoplays when a thumbnail
   * is hovered. CSS hides ytd-video-preview (the whole hover player); the
   * action pass pauses any video inside it so a hidden preview cannot leak
   * audio while YouTube tears it down.
   * ------------------------------------------------------------------ */
  registry.register({
    id: "hoverPreviews", group: "watch",
    css: cssFor("hoverPreviews", [
      "ytd-video-preview",
      "ytd-video-preview #inline-preview-player"
    ]) + "\n" +
      /* with previews off, thumbnails stay visible but are not interactive:
       * no hover player and no click-through onto it. Titles stay clickable.
       * Covers both renderer generations: a#thumbnail (polymer) and the
       * view-model lockup anchors (home/search/shorts, live-verified: home
       * lockups use a.ytLockupViewModelContentImage, shorts use
       * ytm-shorts-lockup-view-model). */
      rule("hoverPreviews", "a#thumbnail",
        "pointer-events: none !important") + "\n" +
      rule("hoverPreviews", "ytd-thumbnail a",
        "pointer-events: none !important") + "\n" +
      rule("hoverPreviews", "yt-lockup-view-model a.ytLockupViewModelContentImage",
        "pointer-events: none !important") + "\n" +
      rule("hoverPreviews", "ytm-shorts-lockup-view-model a",
        "pointer-events: none !important"),
    action: function () {
      var preview = document.querySelector("ytd-video-preview");
      if (!preview) return;
      var videos = preview.querySelectorAll("video");
      for (var i = 0; i < videos.length; i += 1) {
        try {
          if (!videos[i].paused) videos[i].pause();
        } catch (error) {
          /* ignore */
        }
      }
    }
  });

  /* ------------------------------------------------------------------ *
   * squareThumbnails — reduce YouTube's rounded-corner thumbnails.
   * Live-verified: the radius lives on a#thumbnail (12px) everywhere a
   * thumbnail renders; 4px keeps a hint of rounding instead of a hard 0.
   * The player and page furniture are deliberately untouched.
   * ------------------------------------------------------------------ */
  registry.register({
    id: "squareThumbnails", group: "home",
    css: cssFor("squareThumbnails", [
      "a#thumbnail",
      "ytd-thumbnail",
      "ytd-mini-thumbnail-renderer",
      "ytm-shorts-lockup-view-model .shortsLockupViewModelHost"
    ], "border-radius: 4px !important")
  });

  /* ------------------------------------------------------------------ *
   * annotations — legacy annotations are gone from YouTube (2019), so this
   * maps to the modern info-card teasers in the player. End-screen cards
   * (.ytp-ce-*) are a separate behavior (endScreenCards). Legacy rules are
   * kept as free no-ops in case annotations ever reappear.
   * ------------------------------------------------------------------ */
  registry.register({
    id: "annotations", group: "watch",
    css: cssFor("annotations", [
      "#movie_player .ytp-cards-teaser",
      "#movie_player .ytp-cards-button",
      "#movie_player .ytp-cards-teaser-box",
      "#movie_player .ytp-cards-teaser-text",
      "#movie_player .video-annotations",
      "#movie_player .annotation"
    ])
  });
})();
