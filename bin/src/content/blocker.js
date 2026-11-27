/*
 * Isolated-world content script.
 *
 * Two jobs:
 *  1. Home feed: hide any card whose channel is in the blocked list.
 *  2. Watch pages: redirect to blocked.html as soon as the channel is known.
 *
 * Channel identity comes from channel links in the DOM, plus an early hint
 * posted by main-world.js (which can read YouTube's player data).
 */
(function () {
  "use strict";

  var matching = globalThis.YCB && globalThis.YCB.matching;
  var profilesMod = globalThis.YCB && globalThis.YCB.profiles;
  var behaviorMod = globalThis.YCB && globalThis.YCB.behavior;
  if (!matching || !profilesMod || !behaviorMod) return;

  var HIDDEN_ATTR = "data-ycb-hidden";
  var OFF_ATTR = "data-ycb-off";
  var BEHAVIOR_ATTR = "data-ycb-behavior";
  var MAIN_WORLD_TAG = "ycb-channel";
  /* /watch?v=… has no trailing slash in its pathname, so accept both forms. */
  var WATCH_PATH_RE = /^\/(?:watch|live|shorts)(?:\/|$)/;
  var CHANNEL_PATH_RE = /^\/(?:@[A-Za-z0-9._-]{3,30}|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)(?:\/|$)/;

  var state = {
    profiles: [],
    behavior: {},
    behaviorGroups: {},
    showBlockButtons: true,
    ready: false,
    redirected: false,
    hint: null,
    playlistHint: null
  };

  /* Channel entries that apply to one surface right now. */
  function entriesFor(surface) {
    return profilesMod.entriesForSurface(state.profiles, surface);
  }

  /* ------------------------------------------------------------- behavior */

  function pauseVideos() {
    var videos = document.querySelectorAll("video");
    for (var i = 0; i < videos.length; i += 1) {
      try {
        videos[i].pause();
      } catch (error) {
        /* ignore */
      }
    }
  }

  /* data-ycb-off holds a space-separated list of behavior ids that marked
   * the node; a node can legitimately be claimed by two ids. */
  function offIds(node) {
    var value = node && node.getAttribute ? node.getAttribute(OFF_ATTR) : "";
    return value ? value.split(/\s+/) : [];
  }

  function markOff(node, id) {
    if (!node || !node.setAttribute) return;
    var ids = offIds(node);
    if (ids.indexOf(id) !== -1) return;
    ids.push(id);
    node.setAttribute(OFF_ATTR, ids.join(" "));
  }

  function isMarkedOff(node, id) {
    return offIds(node).indexOf(id) !== -1;
  }

  function clearOff(id) {
    var nodes = document.querySelectorAll("[" + OFF_ATTR + "]");
    for (var i = 0; i < nodes.length; i += 1) {
      var ids = offIds(nodes[i]);
      var index = ids.indexOf(id);
      if (index === -1) continue;
      ids.splice(index, 1);
      if (ids.length) nodes[i].setAttribute(OFF_ATTR, ids.join(" "));
      else nodes[i].removeAttribute(OFF_ATTR);
    }
  }

  function applyBehavior() {
    var tokens = behaviorMod.tokens(state.behavior, state.behaviorGroups).join(" ");
    var root = document.documentElement;
    if (!root) return;
    if ((root.getAttribute(BEHAVIOR_ATTR) || "") === tokens) return;
    if (tokens) root.setAttribute(BEHAVIOR_ATTR, tokens);
    else root.removeAttribute(BEHAVIOR_ATTR);
  }

  function behaviorCtx() {
    return {
      markOff: markOff,
      isMarkedOff: isMarkedOff,
      clearOff: clearOff,
      squash: behaviorMod.squash,
      isWatchPage: isWatchPage,
      isHomePage: isHomePage,
      isSearchPage: isSearchPage,
      pauseVideos: pauseVideos
    };
  }

  function runBehaviorPasses() {
    var specs = behaviorMod.enabledSpecs(state.behavior, state.behaviorGroups);
    if (!specs.length) return;
    var ctx = behaviorCtx();
    for (var i = 0; i < specs.length; i += 1) {
      try {
        if (specs[i].marker) specs[i].marker(ctx);
        if (specs[i].action) specs[i].action(ctx);
      } catch (error) {
        /* one broken pass must not stop the others */
      }
    }
  }

  /* ------------------------------------------------------------ blocklist */

  function closeProfileDialog() {
    var existing = document.getElementById(DIALOG_ID);
    if (existing) existing.remove();
  }

  function showProfileDialog(anchorRect, channel) {
    closeProfileDialog();
    if (!channel || (!channel.id && !channel.handle && !channel.name)) {
      toast("No channel found to block here.");
      return;
    }
    chrome.storage.local.get({ profiles: null }, function (stored) {
      var profiles = profilesMod.migrate(stored);
      if (!profiles.length) return;
      var dialog = document.createElement("div");
      dialog.id = DIALOG_ID;
      dialog.className = "ycb-dialog";
      var title = document.createElement("div");
      title.className = "ycb-dialog-title";
      title.appendChild(document.createTextNode("Add "));
      var strong = document.createElement("strong");
      strong.textContent = matching.describeEntry(channel);
      title.appendChild(strong);
      title.appendChild(document.createTextNode(" to:"));
      dialog.appendChild(title);

      profiles.forEach(function (profile) {
        var row = document.createElement("button");
        row.type = "button";
        row.className = "ycb-dialog-row";
        var name = document.createElement("span");
        name.textContent = profile.name;
        if (profile.enabled === false) {
          var tag = document.createElement("span");
          tag.className = "off-tag";
          tag.textContent = "off";
          name.appendChild(document.createTextNode(" "));
          name.appendChild(tag);
        }
        var count = document.createElement("span");
        count.className = "count";
        count.textContent = String(profile.channels.length);
        row.appendChild(name);
        row.appendChild(count);
        row.addEventListener("click", function () {
          addToProfile(profile.id, channel);
          closeProfileDialog();
        });
        dialog.appendChild(row);
      });

      (document.body || document.documentElement).appendChild(dialog);
      var vw = window.innerWidth, vh = window.innerHeight;
      var dw = dialog.offsetWidth, dh = dialog.offsetHeight;
      var left = anchorRect ? anchorRect.left : (vw - dw) / 2;
      var top = anchorRect ? anchorRect.bottom + 6 : (vh - dh) / 3;
      left = Math.max(8, Math.min(left, vw - dw - 8));
      if (top + dh > vh - 8) top = Math.max(8, (anchorRect ? anchorRect.top : vh / 2) - dh - 6);
      dialog.style.left = Math.round(left) + "px";
      dialog.style.top = Math.round(top) + "px";

      setTimeout(function () {
        document.addEventListener("mousedown", dialogOutside, true);
        document.addEventListener("keydown", dialogEscape, true);
      }, 0);
    });
  }

  function dialogOutside(event) {
    var dialog = document.getElementById(DIALOG_ID);
    if (dialog && !dialog.contains(event.target)) {
      closeProfileDialog();
      document.removeEventListener("mousedown", dialogOutside, true);
      document.removeEventListener("keydown", dialogEscape, true);
    }
  }

  function dialogEscape(event) {
    if (event.key === "Escape") {
      closeProfileDialog();
      document.removeEventListener("mousedown", dialogOutside, true);
      document.removeEventListener("keydown", dialogEscape, true);
    }
  }

  function addToProfile(profileId, channel) {
    chrome.storage.local.get({ profiles: null }, function (stored) {
      var profiles = profilesMod.migrate(stored);
      var profile = profiles.filter(function (p) { return p.id === profileId; })[0];
      if (!profile) return;
      var result = matching.addEntry(profile.channels, channel);
      if (!result.added) {
        toast(matching.describeEntry(channel) + " is already in \"" + profile.name + "\".");
        return;
      }
      profile.channels = result.list;
      chrome.storage.local.set({ profiles: profiles }, function () {
        toast("Added " + matching.describeEntry(channel) + " to profile \"" + profile.name + "\".");
      });
    });
  }

  function toast(text) {
    var existing = document.getElementById(TOAST_ID);
    if (existing) existing.remove();
    var node = document.createElement("div");
    node.id = TOAST_ID;
    node.textContent = text;
    (document.body || document.documentElement).appendChild(node);
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 2600);
  }

  function firstEnabledProfile(profiles) {
    for (var i = 0; i < profiles.length; i += 1) {
      if (profiles[i].enabled !== false) return profiles[i];
    }
    return profiles[0] || null;
  }

  function addToBlocklist(channel) {
    if (!channel || (!channel.id && !channel.handle && !channel.name)) {
      toast("No channel found to block here.");
      return;
    }
    chrome.storage.local.get({ profiles: null, blockedChannels: [] }, function (stored) {
      var profiles = profilesMod.migrate(stored);
      var profile = firstEnabledProfile(profiles);
      if (!profile) return;
      var result = matching.addEntry(profile.channels, channel);
      if (!result.added) {
        toast(matching.describeEntry(channel) + " is already in \"" + profile.name + "\".");
        return;
      }
      profile.channels = result.list;
      chrome.storage.local.set({ profiles: profiles }, function () {
        toast("Added " + matching.describeEntry(channel) + " to profile \"" + profile.name + "\".");
      });
    });
  }

  function currentChannelForMenu() {
    if (isWatchPage()) return mergedChannel() || channelPageChannel();
    if (/^\/playlist(?:\/|$)/.test(location.pathname)) return playlistChannel();
    return channelPageChannel();
  }

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== "ycb-add-current-channel") return;
    showProfileDialog(null, currentChannelForMenu());
  });

  /* --------------------------------------------------------- card buttons */

  var BLOCK_BUTTON_CARD_RE = null;

  function removeBlockButtons() {
    var buttons = document.querySelectorAll(".ycb-block-btn");
    for (var i = 0; i < buttons.length; i += 1) {
      var card = buttons[i].closest(BLOCK_CARD_SEL);
      if (card) card.removeAttribute(BUTTON_ATTR);
      buttons[i].remove();
    }
  }

  function addBlockButtons() {
    if (!state.showBlockButtons) {
      removeBlockButtons();
      return;
    }
    var cards = document.querySelectorAll(BLOCK_CARD_SEL);
    for (var i = 0; i < cards.length; i += 1) {
      var card = cards[i];
      if (card.getAttribute(BUTTON_ATTR) === "1") {
        /* YouTube re-renders card innards on hover; if our pill was wiped
         * out, drop the stale marker so the next pass re-adds it. */
        if (card.querySelector(".ycb-block-btn")) continue;
        card.removeAttribute(BUTTON_ATTR);
      }
      if (card.getAttribute(HIDDEN_ATTR) === "1") continue;
      var channel = cardChannel(card);
      if (!channel) continue;
      /* The pill lives next to the channel link, NOT on the thumbnail:
       * YouTube's hover preview overlays the whole thumbnail area and
       * swallows clicks there (user report: button not clickable). */
      var anchor = firstIn(card, [
        'a[href^="/@"]',
        'a[href^="/channel/"]',
        /* view-model lockups: the byline is a plain span, no link */
        ".ytContentMetadataViewModelMetadataRow span",
        "ytd-channel-name span",
        "#channel-name span"
      ]);
      if (!anchor) continue;
      card.setAttribute(BUTTON_ATTR, "1");
      /* one pill per card: both ancestors and descendants must be marked so
       * nested renderers (home rich item wrapping a lockup) never add their
       * own pill (user report: two block buttons) */
      var ancestor = card.parentElement;
      while (ancestor) {
        if (ancestor.setAttribute && BLOCK_CARD_SEL.indexOf(ancestor.tagName.toLowerCase()) !== -1) {
          ancestor.setAttribute(BUTTON_ATTR, "1");
        }
        ancestor = ancestor.parentElement;
      }
      var nested = card.querySelectorAll(BLOCK_CARD_SEL);
      for (var j = 0; j < nested.length; j += 1) nested[j].setAttribute(BUTTON_ATTR, "1");
      var button = document.createElement("button");
      button.type = "button";
      button.className = "ycb-block-btn";
      button.textContent = "Block";
      button.title = "Add channel to blocklist";
      button.setAttribute("data-ycb-id", channel.id || "");
      button.setAttribute("data-ycb-handle", channel.handle || "");
      button.setAttribute("data-ycb-name", channel.name || "");
      /* name-only pills must carry the name so the dialog add works */
      if (!channel.id && !channel.handle) button.setAttribute("data-ycb-name-only", "1");
      anchor.insertAdjacentElement("afterend", button);
    }
  }

  document.addEventListener("click", function (event) {
    var button = event.target && event.target.closest ? event.target.closest(".ycb-block-btn") : null;
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    var rect = button.getBoundingClientRect();
    showProfileDialog(
      { left: rect.left, top: rect.top, bottom: rect.bottom },
      {
        id: button.getAttribute("data-ycb-id") || null,
        handle: button.getAttribute("data-ycb-handle") || null,
        name: button.getAttribute("data-ycb-name") || null
      }
    );
  }, true);

  function resetBehaviorPasses() {
    var specs = behaviorMod.allSpecs();
    for (var i = 0; i < specs.length; i += 1) {
      if (!specs[i].reset) continue;
      try {
        specs[i].reset();
      } catch (error) {
        /* ignore */
      }
    }
  }

  var scanTimer = 0;
  var styleInjected = false;

  /* One static sheet for everything: channel-block card hiding, the behavior
   * marker attribute, and every behavior's attribute-gated rules. All rule
   * sets are registered by the time blocker.js runs (manifest order), so the
   * bundle is complete on first injection. */
  var BUTTON_ATTR = "data-ycb-btn";
  var TOAST_ID = "ycb-toast";
  var DIALOG_ID = "ycb-profile-dialog";
  var BLOCK_CARD_SEL = "ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-rich-item-renderer, yt-lockup-view-model";

  function styleText() {
    return [
      "[" + HIDDEN_ATTR + "]{display:none!important}",
      "[" + OFF_ATTR + "]{display:none!important}",
      behaviorMod.cssBundle(),
      /* card block button: hover-revealed pill on the thumbnail */
      /* always visible, inline next to the channel link: YouTube's hover
       * preview overlays the whole thumbnail area and would swallow clicks
       * on a thumbnail-corner pill (user report). */
      ".ycb-block-btn{display:inline-block;margin-left:6px;padding:3px 9px;" +
        "border:none;border-radius:999px;vertical-align:middle;align-self:flex-start;" +
        "flex-shrink:0;height:auto;line-height:1.4;" +
        "background:rgba(8,10,14,.85);color:#e9ecf1;font:600 11px/1.4 system-ui,sans-serif;" +
        "cursor:pointer}",
      ".ycb-block-btn[data-ycb-added]{color:#7ee2a8}",
      "/* toast */",
      "#" + TOAST_ID + "{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);" +
        "z-index:99999;background:rgba(8,10,14,.94);border:1px solid #2b313a;color:#e9ecf1;" +
        "padding:10px 16px;border-radius:10px;font:500 13px/1.4 system-ui,sans-serif;" +
        "box-shadow:0 10px 28px rgba(0,0,0,.45)}",
      /* profile picker dialog */
      ".ycb-dialog{position:fixed;z-index:100000;min-width:230px;max-width:300px;" +
        "background:#171a1f;border:1px solid #2b313a;border-radius:12px;padding:10px;" +
        "box-shadow:0 14px 40px rgba(0,0,0,.5);font:500 13px/1.4 system-ui,sans-serif;color:#e9ecf1}",
      ".ycb-dialog-title{padding:4px 8px 8px;color:#a2abba;font-size:12px}" +
        ".ycb-dialog-title strong{color:#e9ecf1}",
      ".ycb-dialog-row{display:flex;width:100%;align-items:center;justify-content:space-between;" +
        "gap:10px;padding:8px 10px;border:none;border-radius:8px;background:transparent;" +
        "color:#e9ecf1;font:inherit;font-size:13px;text-align:left;cursor:pointer}",
      ".ycb-dialog-row:hover{background:#1f242b}",
      ".ycb-dialog-row .count{color:#a2abba;font-size:12px}",
      ".ycb-dialog-row .off-tag{color:#a2abba;font-size:11px;font-style:italic}"
    ].filter(Boolean).join("\n");
  }

  function injectStyle() {
    if (styleInjected) return;
    var parent = document.head || document.documentElement;
    if (!parent) return; /* retried from scheduleScan */
    var style = document.createElement("style");
    style.id = "ycb-style";
    style.textContent = styleText();
    parent.appendChild(style);
    styleInjected = true;
  }

  function isWatchPage() {
    return WATCH_PATH_RE.test(location.pathname);
  }

  function isHomePage() {
    if (location.pathname === "/") return true;
    return !!document.querySelector('ytd-browse[page-subtype="home"]');
  }

  function isSearchPage() {
    return location.pathname === "/results";
  }

  function cardChannel(card) {
    var link = card.querySelector(
      "#channel-name a[href], a#avatar-link[href], ytd-channel-name a[href], " +
      'a[href^="/@"], a[href^="/channel/"]'
    );
    if (link) {
      var fromHref = matching.channelFromHref(link.getAttribute("href"));
      if (fromHref) {
        var nameNode = firstIn(card, [
          "#channel-name a",
          "#channel-name yt-formatted-string",
          "ytd-channel-name yt-formatted-string",
          "#channel-title a",
          "#channel-title"
        ]);
        var name = nameNode ? squash(nameNode.textContent) : squash(link.textContent);
        return { id: fromHref.id, handle: fromHref.handle, name: name || fromHref.name };
      }
    }
    /* View-model lockups (home feed, live-verified) have NO channel link at
     * all: the byline is a plain text span. Fall back to a name-only
     * identity; matching is then name-vs-name (exact, case-insensitive). */
    var nameSpan = firstIn(card, [
      ".ytContentMetadataViewModelMetadataRow span",
      "ytd-channel-name span",
      "#channel-name span",
      "ytd-video-meta-block #channel-name"
    ]);
    if (nameSpan) {
      var spanName = squash(nameSpan.textContent);
      if (spanName) return { id: null, handle: null, name: spanName };
    }
    return null;
  }

  function isBlockedOn(surface, channel) {
    if (!channel) return false;
    var entries = entriesFor(surface);
    for (var i = 0; i < entries.length; i += 1) {
      if (matching.matchesChannel(channel, entries[i])) return true;
    }
    return false;
  }

  function isBlocked(channel) {
    return isBlockedOn("home", channel) || isBlockedOn("search", channel);
  }

  /* Search results wrap each renderer in ytd-item-renderer; hiding the bare
   * renderer leaves a gap, so hide the closest wrapping container when one
   * exists. Both the wrapper and the card get the hidden marker so rescans
   * skip them. */
  function hideCard(card) {
    var target = card.closest(
      "ytd-item-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer"
    ) || card;
    target.setAttribute(HIDDEN_ATTR, "1");
    target.style.setProperty("display", "none", "important");
    card.setAttribute(HIDDEN_ATTR, "1");
  }

  function scanHome() {
    if (!isHomePage()) return;
    var entries = entriesFor("home");
    if (!entries.length) return;
    var cards = document.querySelectorAll("ytd-rich-item-renderer:not([" + HIDDEN_ATTR + "])");
    for (var i = 0; i < cards.length; i += 1) {
      if (matchesAny(entries, cardChannel(cards[i]))) hideCard(cards[i]);
    }
  }

  function watchChannelFromDom() {
    var meta = document.querySelector('meta[itemprop="channelId"]');
    var metaId = meta ? meta.getAttribute("content") : null;

    var owner = document.querySelector(
      "ytd-watch-metadata #owner, ytd-watch-metadata, ytd-video-owner-renderer"
    );
    var link = owner && owner.querySelector(
      '#channel-name a[href], a[href^="/@"], a[href^="/channel/"]'
    );
    var fromHref = link ? matching.channelFromHref(link.getAttribute("href")) : null;

    var nameNode = firstIn(owner, [
      "#channel-name a",
      "#channel-name yt-formatted-string",
      "#channel-name"
    ]);
    var name = nameNode ? squash(nameNode.textContent) : null;

    if (!fromHref && !metaId && !name) return null;
    return {
      id: (fromHref && fromHref.id) || metaId || null,
      handle: (fromHref && fromHref.handle) || null,
      name: name || (fromHref && fromHref.name) || null,
      legacy: (fromHref && fromHref.legacy) || null
    };
  }

  function watchChannelFromShorts() {
    var reel = document.querySelector(
      "ytd-reel-video-renderer[is-active], ytd-shorts ytd-reel-video-renderer"
    );
    if (!reel) return null;
    var link = reel.querySelector('a[href^="/@"], a[href^="/channel/"]');
    if (!link) return null;
    var fromHref = matching.channelFromHref(link.getAttribute("href"));
    if (!fromHref) return null;
    var nameNode = firstIn(reel, ["#channel-name a", "#channel-name yt-formatted-string", "#channel-name"]);
    return {
      id: fromHref.id,
      handle: fromHref.handle,
      name: nameNode ? squash(nameNode.textContent) : fromHref.name
    };
  }

  function channelPageChannel() {
    var fromPath = matching.channelFromHref(location.pathname);
    if (!fromPath) return null;
    var nameNode = firstIn(document, [
      "#page-header #channel-title a",
      "#page-header #channel-title yt-formatted-string",
      "#page-header #channel-title",
      "ytd-channel-name yt-formatted-string",
      "#channel-title"
    ]);
    var name = nameNode ? squash(nameNode.textContent) : null;
    return {
      id: fromPath.id,
      handle: fromPath.handle,
      name: name || fromPath.name,
      legacy: fromPath.legacy || null
    };
  }

  /* /playlist pages: the owner channel comes from DOM anchors when the page
   * shows them (signed-in), plus a hint from main-world.js reading
   * ytInitialData. Neither source alone is guaranteed, so merge both. */
  function playlistChannel() {
    var dom = null;
    var header = document.querySelector(
      "ytd-playlist-header-renderer, ytd-playlist-header-view-model, ytd-browse#header"
    );
    if (header) {
      var anchors = header.querySelectorAll(
        'a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"]'
      );
      for (var i = 0; i < anchors.length; i += 1) {
        var parsed = matching.channelFromHref(anchors[i].getAttribute("href"));
        if (parsed) { dom = parsed; break; }
      }
    }
    var hint = state.playlistHint;
    if (!dom && !hint) return null;
    return {
      id: (dom && dom.id) || (hint && hint.id) || null,
      handle: (dom && dom.handle) || null,
      name: (dom && dom.name) || (hint && hint.name) || null,
      legacy: (dom && dom.legacy) || null
    };
  }

  function checkPlaylistPage() {
    if (state.redirected) return;
    if (!/^\/playlist(?:\/|$)/.test(location.pathname)) return;
    var channel = playlistChannel();
    if (!channel || (!channel.id && !channel.handle && !channel.name)) return;
    var entries = entriesFor("channelPage");
    for (var i = 0; i < entries.length; i += 1) {
      if (!matching.matchesChannel(channel, entries[i])) continue;
      redirect(channel, entries[i], "channel");
      return;
    }
  }

  function currentVideoId() {
    if (location.pathname.indexOf("/shorts/") === 0) {
      return location.pathname.split("/")[2] || null;
    }
    try {
      return new URLSearchParams(location.search).get("v");
    } catch (error) {
      return null;
    }
  }

  function mergedChannel() {
    var dom = location.pathname.indexOf("/shorts/") === 0
      ? watchChannelFromShorts() || watchChannelFromDom()
      : watchChannelFromDom();
    var hint = state.hint;
    var videoId = currentVideoId();
    if (hint && videoId && hint.videoId !== videoId) hint = null;

    if (!dom) return hint ? { id: hint.id, handle: null, name: hint.name } : null;
    return {
      id: dom.id || (hint && hint.id) || null,
      handle: dom.handle || null,
      name: dom.name || (hint && hint.name) || null,
      legacy: dom.legacy || null
    };
  }

  function squash(value) {
    return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
  }

  /* Multi-selector querySelector() matches in document order, so a container
   * beats the precise selectors listed after it. Try them one by one instead. */
  function firstIn(root, selectors) {
    if (!root) return null;
    for (var i = 0; i < selectors.length; i += 1) {
      var node = root.querySelector(selectors[i]);
      if (node) return node;
    }
    return null;
  }

  function labelFor(channel, entry) {
    if (channel && channel.name) return squash(channel.name);
    if (channel && channel.handle) return channel.handle;
    if (channel && channel.id) return channel.id;
    return matching.describeEntry(entry);
  }

  function checkWatch() {
    if (!isWatchPage() || state.redirected) return;
    var channel = mergedChannel();
    if (!channel) return;
    var surface = location.pathname.indexOf("/shorts/") === 0 ? "shorts" : "playback";
    var entries = entriesFor(surface);
    for (var i = 0; i < entries.length; i += 1) {
      if (!matching.matchesChannel(channel, entries[i])) continue;
      redirect(channel, entries[i], "video");
      return;
    }
  }

  function checkChannelPage() {
    if (state.redirected || state.hint || !state.ready) return;
    if (!CHANNEL_PATH_RE.test(location.pathname)) return;
    if (isWatchPage() || isHomePage() || isSearchPage()) return;
    var channel = channelPageChannel();
    if (!channel) return;
    var entries = entriesFor("channelPage");
    for (var i = 0; i < entries.length; i += 1) {
      if (!matching.matchesChannel(channel, entries[i])) continue;
      redirect(channel, entries[i], "channel");
      return;
    }
  }

  function redirect(channel, entry, kind) {
    if (state.redirected) return;
    state.redirected = true;
    pauseVideos();

    var url = chrome.runtime.getURL("src/blocked/blocked.html") +
      "?ch=" + encodeURIComponent(labelFor(channel, entry)) +
      "&id=" + encodeURIComponent((channel && channel.id) || "") +
      "&kind=" + kind;
    location.replace(url);
  }

  function matchesAny(entries, channel) {
    if (!channel) return false;
    for (var i = 0; i < entries.length; i += 1) {
      if (matching.matchesChannel(channel, entries[i])) return true;
    }
    return false;
  }

  function scanSearch() {
    if (!isSearchPage()) return;
    var entries = entriesFor("search");
    if (!entries.length) return;
    /* yt-lockup-view-model is the current renderer for most /results cards,
     * including videos inside playlist shelves (user report: 301 diaries). */
    var cards = document.querySelectorAll(
      "ytd-video-renderer:not([" + HIDDEN_ATTR + "]), " +
      "ytd-channel-renderer:not([" + HIDDEN_ATTR + "]), " +
      "ytd-reel-item-renderer:not([" + HIDDEN_ATTR + "]), " +
      "ytd-playlist-renderer:not([" + HIDDEN_ATTR + "]), " +
      "yt-lockup-view-model:not([" + HIDDEN_ATTR + "])"
    );
    for (var i = 0; i < cards.length; i += 1) {
      if (matchesAny(entries, cardChannel(cards[i]))) hideCard(cards[i]);
    }
    collapseSearchShelves();
  }

  /* A shelf whose every lockup card is blocked (e.g. all videos from a
   * blocked channel's playlist) collapses to nothing; a shelf with any
   * unblocked content keeps its header and remaining cards. */
  function collapseSearchShelves() {
    var shelves = document.querySelectorAll("ytd-shelf-renderer:not([" + HIDDEN_ATTR + "])");
    for (var i = 0; i < shelves.length; i += 1) {
      var shelf = shelves[i];
      var lockups = shelf.querySelectorAll("yt-lockup-view-model");
      if (!lockups.length) continue;
      var allBlocked = true;
      for (var j = 0; j < lockups.length; j += 1) {
        if (lockups[j].getAttribute(HIDDEN_ATTR) !== "1") {
          allBlocked = false;
          break;
        }
      }
      if (allBlocked) hideCard(shelf);
    }
  }

  function scan() {
    if (!state.ready) return;
    injectStyle();
    applyBehavior();
    if (isWatchPage()) checkWatch();
    else checkChannelPage();
    checkPlaylistPage();
    scanHome();
    scanSearch();
    addBlockButtons();
    runBehaviorPasses();
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () {
      scanTimer = 0;
      injectStyle();
      scan();
    }, 120);
  }

  function clearHidden() {
    var hidden = document.querySelectorAll("[" + HIDDEN_ATTR + "]");
    for (var i = 0; i < hidden.length; i += 1) {
      hidden[i].removeAttribute(HIDDEN_ATTR);
      hidden[i].style.removeProperty("display");
    }
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.__ycb !== MAIN_WORLD_TAG) return;
    if (data.playlistOwner === true) {
      if (typeof data.id !== "string" && typeof data.name !== "string") return;
      state.playlistHint = {
        id: typeof data.id === "string" ? data.id : null,
        name: typeof data.name === "string" ? data.name : null
      };
      scheduleScan();
      return;
    }
    if (typeof data.videoId !== "string" || typeof data.id !== "string") return;
    state.hint = {
      videoId: data.videoId,
      id: data.id,
      name: typeof data.name === "string" ? data.name : null
    };
    checkWatch();
  });

  document.addEventListener("yt-navigate-finish", function () {
    state.redirected = false;
    state.hint = null;
    state.playlistHint = null;
    resetBehaviorPasses();
    scheduleScan();
  });

  document.addEventListener("yt-page-data-updated", scheduleScan);

  injectStyle();

  var STORAGE_DEFAULTS = { profiles: null, blockedChannels: [], behavior: {}, behaviorGroups: {}, showBlockButtons: true };

  chrome.storage.local.get(STORAGE_DEFAULTS, function (stored) {
    state.profiles = profilesMod.migrate(stored);
    state.behavior = behaviorMod.normalizeBehavior(stored.behavior);
    state.behaviorGroups = behaviorMod.normalizeGroups(stored.behaviorGroups);
    state.showBlockButtons = stored.showBlockButtons !== false;
    state.ready = true;
    scan();
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    if (changes.showBlockButtons) {
      state.showBlockButtons = changes.showBlockButtons.newValue !== false;
      if (!state.showBlockButtons) removeBlockButtons();
      scheduleScan();
    }
    if (!changes.profiles && !changes.blockedChannels && !changes.behavior && !changes.behaviorGroups) return;
    chrome.storage.local.get(STORAGE_DEFAULTS, function (fresh) {
      if (changes.profiles || changes.blockedChannels) {
        state.profiles = profilesMod.migrate(fresh);
        clearHidden();
      }
      if (changes.behavior || changes.behaviorGroups) {
        state.behavior = behaviorMod.normalizeBehavior(fresh.behavior);
        state.behaviorGroups = behaviorMod.normalizeGroups(fresh.behaviorGroups);
        /* Ids that just stopped applying (toggle or group switch) must
         * release their DOM marks so the CSS attribute alone un-hides them. */
        var enabled = {};
        var specs = behaviorMod.enabledSpecs(state.behavior, state.behaviorGroups);
        for (var i = 0; i < specs.length; i += 1) enabled[specs[i].id] = true;
        var all = behaviorMod.allSpecs();
        for (var j = 0; j < all.length; j += 1) {
          if (!enabled[all[j].id]) clearOff(all[j].id);
        }
      }
      scheduleScan();
    });
  });

  var observer = new MutationObserver(scheduleScan);
  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } else {
    document.addEventListener("readystatechange", function () {
      if (document.documentElement) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
      scheduleScan();
    });
  }
})();
