/*
 * Runs in the page's MAIN world at document_start, before YouTube's scripts.
 * Its only job is to surface the current video's channel as early as possible,
 * because the DOM-based check in blocker.js can lag behind playback.
 *
 * It reads page globals (allowed only in MAIN world) and posts a plain object
 * back to the isolated content script. It never uses chrome.* APIs.
 */
(function () {
  "use strict";

  var EVENT_TAG = "ycb-channel";
  var WATCH_PATH_RE = /^\/(?:watch|shorts)(?:\/|$)/;
  var lastSent = "";

  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;

  function describe(playerResponse) {
    var details = playerResponse && playerResponse.videoDetails;
    if (!details || !details.videoId || !details.channelId) return null;
    return {
      videoId: String(details.videoId),
      id: String(details.channelId),
      name: typeof details.author === "string" ? details.author : null
    };
  }

  function fromFlexy() {
    try {
      var flexy = document.querySelector("ytd-watch-flexy");
      if (!flexy) return null;
      var data = flexy.playerData || (flexy.__data && flexy.__data.playerData);
      return describe(data);
    } catch (error) {
      return null;
    }
  }

  function fromInitialResponse() {
    try {
      return describe(window.ytInitialPlayerResponse);
    } catch (error) {
      return null;
    }
  }

  /* Playlist pages: find the owner channel in ytInitialData. Only signed-in
   * or owner-visible builds expose ownerText; when absent we send nothing and
   * blocker.js falls back to DOM anchors. */
  function playlistOwner() {
    try {
      var data = window.ytInitialData;
      if (!data || typeof data !== "object") return null;
      var found = null;
      var walk = function (node) {
        if (found || !node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          for (var i = 0; i < node.length; i += 1) walk(node[i]);
          return;
        }
        for (var key in node) {
          if (found) return;
          if (key === "ownerText") {
            var value = node[key];
            var runs = value && value.runs;
            var name = runs && runs[0] && typeof runs[0].text === "string" ? runs[0].text : null;
            var browse = node.ownerEndpoint && node.ownerEndpoint.browseEndpoint;
            var id = browse && typeof browse.browseId === "string" && /^UC/.test(browse.browseId)
              ? browse.browseId : null;
            if (name || id) found = { id: id, name: name };
          }
          if (!found) walk(node[key]);
        }
      };
      walk(data);
      return found;
    } catch (error) {
      return null;
    }
  }

  function tick() {
    if (/^\/playlist(?:\/|$)/.test(location.pathname)) {
      var owner = playlistOwner();
      if (!owner) return;
      var ownerKey = "pl|" + (owner.id || "") + "|" + (owner.name || "");
      if (ownerKey === lastSent) return;
      lastSent = ownerKey;
      try {
        window.postMessage({ __ycb: EVENT_TAG, playlistOwner: true, id: owner.id || "", name: owner.name || "" }, location.origin);
      } catch (error) {
        /* ignore */
      }
      return;
    }
    if (!WATCH_PATH_RE.test(location.pathname)) return;
    var info = fromFlexy() || fromInitialResponse();
    if (!info) return;
    var key = info.videoId + "|" + info.id;
    if (key === lastSent) return;
    lastSent = key;
    try {
      window.postMessage({ __ycb: EVENT_TAG, videoId: info.videoId, id: info.id, name: info.name }, location.origin);
    } catch (error) {
      /* postMessage to our own origin cannot realistically fail */
    }
  }

  setInterval(tick, 250);
  document.addEventListener("yt-navigate-finish", tick);
  document.addEventListener("yt-page-data-updated", tick);
  tick();
})();
