/*
 * Behavior lane 2 - site chrome + home feed.
 *
 * Ids owned here: homeFeed, topHeader, notifications, subscriptions,
 *                 exploreTrending, moreFromYouTube.
 *
 * Live-DOM notes (www.youtube.com desktop, dark, logged out, measured 2026-11-27):
 *  - ytd-masthead#masthead sits inside #masthead-container (position:fixed,
 *    height 56px); #page-manager is pushed down by margin-top: 56px and
 *    #guide is position:fixed with top: 56px. Hiding the header therefore
 *    needs both compensations.
 *  - The feed filter chip bar lives INSIDE ytd-rich-grid-renderer > div#header,
 *    so hiding the grid already removes it; the explicit rule is kept as a
 *    fallback for builds where the chip bar is hoisted.
 *  - A second, empty div#header.ytd-browse is a direct child of ytd-browse.
 *    Both #header rules are scoped to the home browse so channel/search pages
 *    keep their own headers.
 *  - ytd-guide-section-renderer has no #title in this build, so a section is
 *    identified by the hrefs of the links inside it.
 *  - The notification bell does not render while logged out. The tag
 *    ytd-notification-topbar-button-renderer IS registered in customElements,
 *    so the classic selectors are correct for this build; the aria-label
 *    marker is the fallback for markup changes. Measured masthead aria-labels
 *    (logged out): Back, Guide, Skip navigation, Search, Search with your
 *    voice, tooltip, Settings, Sign in - none match /notification/i, exactly
 *    as expected without an account.
 *  - Mini guide entries only instantiate after the guide is collapsed
 *    (ytd-mini-guide-renderer starts with disable-upgrade/hidden). Measured
 *    after collapsing: 4 entries (/, /shorts/, /feed/subscriptions, /feed/you),
 *    so only the mini-guide subscriptions selector is live-confirmed; the
 *    mini-guide explore/premium twins exist only for signed-in/newer builds
 *    and are inert here (each href is guarded by :has(), so a miss is a no-op).
 *
 * Everything here is declaration-only (root-attribute-gated CSS + marker
 * attributes). No inline styles, no layout writes beyond the two documented
 * compensations for hiding the masthead.
 */
(function () {
  "use strict";

  var YCB = globalThis.YCB || (globalThis.YCB = {});
  var registry = YCB.behavior;
  /* manifest loads src/shared/behavior.js first; stay inert if it is absent. */
  if (!registry || typeof registry.register !== "function") return;

  var GUIDE_NEEDLES = {
    exploreTrending: ["/feed/trending", "/feed/explore", "/feed/storefront"],
    moreFromYouTube: ["music.youtube.com", "youtubekids.com", "/premium"]
  };

  var NOTIFICATION_RE = /notification/i;

  /* Root-attribute gated rule. Every selector must go through this so the
     registry contract stays uniform and nothing is hidden while disabled. */
  function rule(id, selector, decl) {
    return (
      'html[data-ycb-behavior~="' +
      id +
      '"] ' +
      selector +
      " { " +
      (decl || "display: none !important") +
      " }"
    );
  }

  function cssFor(id, selectors, decl) {
    var out = [];
    for (var i = 0; i < selectors.length; i += 1) out.push(rule(id, selectors[i], decl));
    return out.join("\n");
  }

  function squashText(ctx, value) {
    var text = String(value == null ? "" : value);
    if (ctx && typeof ctx.squash === "function") text = ctx.squash(text);
    return text.replace(/\s+/g, " ").trim().toLowerCase();
  }

  /* data-ycb-off holds the id of the behavior that marked the node. */
  function markIds(node) {
    var value = node && node.getAttribute ? node.getAttribute("data-ycb-off") : null;
    return value ? value.split(/\s+/) : [];
  }

  function markedWith(node, id) {
    return markIds(node).indexOf(id) !== -1;
  }

  function markOff(ctx, node, id) {
    if (markedWith(node, id)) return;
    if (ctx && typeof ctx.isMarkedOff === "function" && ctx.isMarkedOff(node, id)) return;
    ctx.markOff(node, id);
  }

  function sectionHasHref(section, needles) {
    var anchors = section.querySelectorAll("a[href]");
    for (var i = 0; i < anchors.length; i += 1) {
      var href = anchors[i].getAttribute("href") || "";
      if (!href) continue;
      for (var j = 0; j < needles.length; j += 1) {
        if (href.indexOf(needles[j]) !== -1) return true;
      }
    }
    return false;
  }

  /* Guide sections are never titled in this build: identify them by href.
     If a section is already claimed by the rival id, leave it alone so
     toggling one behavior off never un-hides a section the other owns
     (exploreTrending registers first, so it wins first-evaluation). */
  function guideSectionMarker(id, rivalId) {
    return function (ctx) {
      var sections = document.querySelectorAll("ytd-guide-section-renderer");
      for (var i = 0; i < sections.length; i += 1) {
        var section = sections[i];
        if (rivalId && markedWith(section, rivalId)) continue;
        if (!sectionHasHref(section, GUIDE_NEEDLES[id])) continue;
        markOff(ctx, section, id);
      }
    };
  }

  function labelsMatch(ctx, node, re) {
    var labels = [];
    if (node.getAttribute && node.hasAttribute("aria-label")) {
      labels.push(node.getAttribute("aria-label"));
    }
    var nested = node.querySelectorAll("[aria-label]");
    for (var i = 0; i < nested.length; i += 1) labels.push(nested[i].getAttribute("aria-label"));
    for (var j = 0; j < labels.length; j += 1) {
      if (re.test(squashText(ctx, labels[j]))) return true;
    }
    return false;
  }

  /* Fallback for the notification bell: whatever occupies the bell slot in
     the masthead button strip and calls itself a notification. */
  function notificationMarker(ctx) {
    var buttons = document.querySelectorAll("ytd-masthead #buttons > *");
    for (var i = 0; i < buttons.length; i += 1) {
      var node = buttons[i];
      if (!labelsMatch(ctx, node, NOTIFICATION_RE)) continue;
      markOff(ctx, node, "notifications");
    }
  }

  registry.register({
    id: "homeFeed", group: "home",
    css: [
      cssFor("homeFeed", [
        'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer',
        'ytd-browse[page-subtype="home"] ytd-feed-filter-chip-bar-renderer',
        'ytd-browse[page-subtype="home"] > #header.ytd-browse'
      ]).trim()
    ].join("\n")
  });

  registry.register({
    id: "topHeader", group: "nav",
    css: [
      cssFor("topHeader", ["ytd-masthead", "#masthead-container"]),
      /* layout compensation for the removed 56px toolbar */
      rule("topHeader", "#page-manager", "margin-top: 0 !important"),
      rule("topHeader", "#guide", "top: 0 !important")
    ].join("\n")
  });

  registry.register({
    id: "notifications", group: "nav",
    css: cssFor("notifications", [
      "ytd-masthead ytd-notification-topbar-button-renderer",
      "ytd-masthead #notification-button"
    ]),
    marker: notificationMarker
  });

  registry.register({
    id: "subscriptions", group: "nav",
    css: cssFor("subscriptions", [
      'ytd-guide-entry-renderer:has(a[href*="/feed/subscriptions"])',
      'ytd-mini-guide-entry-renderer:has(a[href*="/feed/subscriptions"])'
    ])
  });

  registry.register({
    id: "exploreTrending", group: "nav",
    css: cssFor("exploreTrending", [
      'ytd-guide-entry-renderer:has(a[href*="/feed/trending"])',
      'ytd-guide-entry-renderer:has(a[href*="/feed/explore"])',
      'ytd-guide-entry-renderer:has(a[href*="/feed/storefront"])',
      'ytd-mini-guide-entry-renderer:has(a[href*="/feed/trending"])',
      'ytd-mini-guide-entry-renderer:has(a[href*="/feed/explore"])',
      'ytd-mini-guide-entry-renderer:has(a[href*="/feed/storefront"])'
    ]),
    marker: guideSectionMarker("exploreTrending", "moreFromYouTube")
  });

  /* home/search hover highlight: YouTube draws a colored rounded rectangle
   * around the hovered card (ytSpecTouchFeedbackShapeHoverEffect/Fill divs,
   * ~13% opacity tint, the Fill variant slightly larger so it "expands a
   * little"). Live-verified via a computed-style dump during card hover. */
  registry.register({
    id: "hoverHighlight", group: "home",
    css: cssFor("hoverHighlight", [
      ".ytSpecTouchFeedbackShapeHoverEffect",
      ".ytSpecTouchFeedbackShapeFill",
      /* class-name variants across YouTube's polymer/view-model migrations */
      '[class*="TouchFeedbackShape"]',
      '[class*="touch-feedback-shape"]'
    ])
  });

  registry.register({
    id: "moreFromYouTube", group: "nav",
    css: cssFor("moreFromYouTube", [
      'ytd-guide-entry-renderer:has(a[href*="music.youtube.com"])',
      'ytd-guide-entry-renderer:has(a[href*="youtubekids.com"])',
      'ytd-guide-entry-renderer:has(a[href*="/premium"])',
      'ytd-mini-guide-entry-renderer:has(a[href*="music.youtube.com"])',
      'ytd-mini-guide-entry-renderer:has(a[href*="youtubekids.com"])',
      'ytd-mini-guide-entry-renderer:has(a[href*="/premium"])'
    ]),
    marker: guideSectionMarker("moreFromYouTube", "exploreTrending")
  });
})();
