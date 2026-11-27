/*
 * Behavior registry shared by the content script, the options page and the
 * unit tests. No chrome.* access here so it stays trivially testable.
 *
 * The options page persists `chrome.storage.local.behavior` as an object of
 * 21 boolean ids (all default false). Content-side modules (behaviors-*.js)
 * register one spec per id: a block of CSS rules gated on the root attribute
 * `data-ycb-behavior` plus optional imperative marker/action passes.
 *
 * blocker.js consumes this registry: it syncs the enabled ids onto
 * <html data-ycb-behavior="id1 id2 …"> and runs marker/action passes from its
 * debounced scan. Markers must stay idempotent on their own; the registry
 * simply calls them.
 */
(function (root) {
  "use strict";

  if (root.YCB && root.YCB.behavior) return;

  /* Behavior cards in the options page; a group switch gates all of its
   * toggles at once. */
  var GROUPS = ["watch", "home", "nav"];

  var IDS = [
    "homeFeed",
    "videoSidebar",
    "recommended",
    "liveChat",
    "playlist",
    "fundraiser",
    "endScreenFeed",
    "endScreenCards",
    "shorts",
    "comments",
    "mixes",
    "merch",
    "videoInfo",
    "topHeader",
    "notifications",
    "inaptSearch",
    "exploreTrending",
    "moreFromYouTube",
    "subscriptions",
    "autoplay",
    "annotations",
    "hoverPreviews",
    "squareThumbnails",
    "hoverHighlight",
    "blockShiftN"
  ];

  var specs = Object.create(null);

  function text(value) {
    return value == null ? "" : String(value);
  }

  function squash(value) {
    return text(value).replace(/\s+/g, " ").trim();
  }

  /** Coerce a stored behavior object into {id: strictBoolean}; unknown keys drop. */
  function normalizeBehavior(raw) {
    var out = {};
    var source = raw && typeof raw === "object" ? raw : {};
    for (var i = 0; i < IDS.length; i += 1) {
      out[IDS[i]] = source[IDS[i]] === true;
    }
    return out;
  }

  /**
   * Register a behavior spec: { id, css, marker, action, reset }.
   * css: string of rules; marker(ctx)/action(ctx): imperative passes run from
   * the content-script scan; reset(): called on every yt-navigate-finish.
   * First registration per id wins; unknown ids are rejected.
   */
  function register(spec) {
    if (!spec || typeof spec !== "object") return false;
    var id = spec.id;
    if (IDS.indexOf(id) === -1 || specs[id]) return false;
    specs[id] = {
      id: id,
      group: GROUPS.indexOf(spec.group) !== -1 ? spec.group : null,
      css: typeof spec.css === "string" ? spec.css : "",
      marker: typeof spec.marker === "function" ? spec.marker : null,
      action: typeof spec.action === "function" ? spec.action : null,
      reset: typeof spec.reset === "function" ? spec.reset : null
    };
    return true;
  }

  /** Group state: every group is on unless explicitly false. */
  function normalizeGroups(raw) {
    var out = {};
    var source = raw && typeof raw === "object" ? raw : {};
    for (var i = 0; i < GROUPS.length; i += 1) {
      out[GROUPS[i]] = source[GROUPS[i]] !== false;
    }
    return out;
  }

  function groupOn(groupState, group) {
    if (!group) return true; /* ungrouped specs ignore group switches */
    return !(groupState && groupState[group] === false);
  }

  /** All registered specs. */
  function allSpecs() {
    return IDS.map(function (id) { return specs[id]; }).filter(Boolean);
  }

  /** Specs whose id is enabled in the behavior object AND whose group is on. */
  function enabledSpecs(behaviorObj, groupState) {
    var source = behaviorObj && typeof behaviorObj === "object" ? behaviorObj : {};
    return IDS.filter(function (id) {
      var spec = specs[id];
      return spec && source[id] === true && groupOn(groupState, spec.group);
    }).map(function (id) { return specs[id]; });
  }

  /** Enabled, registered ids, for the root attribute. */
  function tokens(behaviorObj, groupState) {
    return enabledSpecs(behaviorObj, groupState).map(function (spec) { return spec.id; });
  }

  /** Concatenation of every registered spec's CSS. */
  function cssBundle() {
    return allSpecs()
      .map(function (spec) { return spec.css; })
      .filter(Boolean)
      .join("\n");
  }

  var MIX_RADIO_RE = /(?:^|[?&])list=RD(?!$)/;

  /** True when a watch URL points at a YouTube Mix / radio playlist. */
  function isMixHref(href) {
    var value = text(href);
    if (!value) return false;
    if (value.indexOf("start_radio=1") !== -1) return true;
    return MIX_RADIO_RE.test(value);
  }

  var INAPT_SHELF_TITLES = [
    "people also watched",
    "for you",
    "related to your search",
    "others also watched",
    "explore more",
    "people also search for"
  ];

  /** Anchored match of a squashed shelf title against the known noise list. */
  function matchesInaptShelfTitle(rawTitle) {
    var title = squash(rawTitle).toLowerCase();
    if (!title) return false;
    for (var i = 0; i < INAPT_SHELF_TITLES.length; i += 1) {
      if (title === INAPT_SHELF_TITLES[i]) return true;
    }
    return false;
  }

  root.YCB = root.YCB || {};
  root.YCB.behavior = {
    IDS: IDS,
    GROUPS: GROUPS,
    normalizeGroups: normalizeGroups,
    normalizeBehavior: normalizeBehavior,
    register: register,
    allSpecs: allSpecs,
    enabledSpecs: enabledSpecs,
    tokens: tokens,
    cssBundle: cssBundle,
    isMixHref: isMixHref,
    INAPT_SHELF_TITLES: INAPT_SHELF_TITLES,
    matchesInaptShelfTitle: matchesInaptShelfTitle,
    squash: squash
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
