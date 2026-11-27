/*
 * Pure channel-matching helpers shared by the content script, the options page
 * and the unit tests. No chrome.* access here so it stays trivially testable.
 *
 * An entry is { handle: "@name" | null, id: "UC..." | null, name: "Display name" | null }.
 * Only the field the user supplied is set; matching succeeds on any set field.
 */
(function (root) {
  "use strict";

  if (root.YCB && root.YCB.matching) return;

  var ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
  var ID_LIKE_RE = /^UC[A-Za-z0-9_-]+$/;
  var HANDLE_RE = /^@[A-Za-z0-9._-]{3,30}$/;
  var HANDLE_IN_PATH = /^\/(@[A-Za-z0-9._-]{3,30})(?:\/|$)/;
  var ID_IN_PATH = /^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/;
  var LEGACY_IN_PATH = /^\/(?:c|user)\/([^/?#]+)/;
  var YOUTUBE_HOST_RE = /^(?:www\.|m\.)?youtube\.com$/;

  function text(value) {
    return value == null ? "" : String(value);
  }

  function norm(value) {
    return text(value).replace(/\s+/g, " ").trim().toLowerCase();
  }

  function normHandle(value) {
    return norm(value).replace(/^@/, "");
  }

  /**
   * Turn free-form user input into an entry.
   * Accepts a full channel URL, a bare @handle, a bare UC… channel ID, or a
   * plain channel name (matched exactly, case-insensitively).
   */
  function parseChannelInput(raw) {
    var input = text(raw).trim();
    if (!input) return { ok: false, error: "empty" };

    var looksLikeUrl = /^https?:\/\//i.test(input) || /^(?:www\.|m\.)?youtube\.com\//i.test(input);
    if (looksLikeUrl) {
      var url;
      try {
        url = new URL(/^https?:\/\//i.test(input) ? input : "https://" + input);
      } catch (e) {
        return { ok: false, error: "url" };
      }
      if (!YOUTUBE_HOST_RE.test(url.hostname.toLowerCase())) {
        return { ok: false, error: "host" };
      }
      var path = url.pathname;
      var match = HANDLE_IN_PATH.exec(path);
      if (match) return { ok: true, entry: entryFromHandle(match[1]) };
      match = ID_IN_PATH.exec(path);
      if (match) return { ok: true, entry: entryFromId(match[1]) };
      match = LEGACY_IN_PATH.exec(path);
      if (match) return { ok: true, entry: entryFromName(safeDecode(match[1])) };
      return { ok: false, error: "path" };
    }

    if (HANDLE_RE.test(input)) return { ok: true, entry: entryFromHandle(input) };
    if (ID_RE.test(input)) return { ok: true, entry: entryFromId(input) };
    if (ID_LIKE_RE.test(input)) return { ok: false, error: "id" };
    if (input.length < 2 || input.length > 80) return { ok: false, error: "name" };
    return { ok: true, entry: entryFromName(input) };
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch (e) {
      return value;
    }
  }

  function entryFromHandle(handle) {
    return { handle: "@" + text(handle).trim().replace(/^@/, ""), id: null, name: null };
  }

  function entryFromId(id) {
    return { handle: null, id: String(id), name: null };
  }

  function entryFromName(name) {
    return { handle: null, id: null, name: text(name).trim() };
  }

  /**
   * Read the channel identity out of a link seen on a YouTube page.
   * Returns null for anything that is not a channel link.
   */
  function channelFromHref(href) {
    var raw = text(href).trim();
    if (!raw) return null;
    var path;
    try {
      path = new URL(raw, "https://www.youtube.com").pathname;
    } catch (e) {
      return null;
    }
    var match = HANDLE_IN_PATH.exec(path);
    if (match) return { handle: "@" + text(match[1]).replace(/^@/, ""), id: null, name: null };
    match = ID_IN_PATH.exec(path);
    if (match) return { handle: null, id: match[1], name: null };
    match = LEGACY_IN_PATH.exec(path);
    if (match) return { handle: null, id: null, name: safeDecode(match[1]) };
    return null;
  }

  /** True when a channel seen on a page is covered by a stored entry. */
  function matchesChannel(channel, entry) {
    if (!channel || !entry) return false;
    if (entry.id && channel.id && entry.id === channel.id) return true;
    if (entry.handle && channel.handle && normHandle(entry.handle) === normHandle(channel.handle)) return true;
    if (entry.name && channel.name && norm(entry.name) === norm(channel.name)) return true;
    if (entry.name && channel.legacy && norm(entry.name) === norm(channel.legacy)) return true;
    return false;
  }

  function entryKey(entry) {
    if (!entry) return "";
    if (entry.id) return "id:" + entry.id;
    if (entry.handle) return "handle:" + normHandle(entry.handle);
    if (entry.name) return "name:" + norm(entry.name);
    return "";
  }

  /** Add an entry unless an equivalent one is already stored. */
  function addEntry(list, entry) {
    var current = normalizeList(list);
    var key = entryKey(entry);
    if (!key) return { list: current, added: false };
    if (current.some(function (existing) { return entryKey(existing) === key; })) {
      return { list: current, added: false };
    }
    return { list: current.concat([entry]), added: true };
  }

  function removeEntry(list, key) {
    return normalizeList(list).filter(function (entry) { return entryKey(entry) !== key; });
  }

  /** Storage is user-writable, so every read goes through this. */
  function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var raw = list[i];
      if (!raw || typeof raw !== "object") continue;
      var handle = typeof raw.handle === "string" && HANDLE_RE.test(raw.handle.trim())
        ? "@" + raw.handle.trim().replace(/^@/, "")
        : null;
      var id = typeof raw.id === "string" && ID_RE.test(raw.id.trim()) ? raw.id.trim() : null;
      var name = !handle && !id && typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 80)
        : null;
      if (!handle && !id && !name) continue;
      var entry = { handle: handle, id: id, name: name };
      var key = entryKey(entry);
      if (seen[key]) continue;
      seen[key] = true;
      out.push(entry);
    }
    return out;
  }

  function describeEntry(entry) {
    if (!entry) return "";
    if (entry.handle) return entry.handle;
    if (entry.name) return entry.name;
    if (entry.id) return entry.id;
    return "";
  }

  function entryKind(entry) {
    if (!entry) return "";
    if (entry.handle) return "handle";
    if (entry.id) return "channel id";
    return "name";
  }

  root.YCB = root.YCB || {};
  root.YCB.matching = {
    parseChannelInput: parseChannelInput,
    channelFromHref: channelFromHref,
    matchesChannel: matchesChannel,
    entryKey: entryKey,
    addEntry: addEntry,
    removeEntry: removeEntry,
    normalizeList: normalizeList,
    describeEntry: describeEntry,
    entryKind: entryKind,
    norm: norm,
    normHandle: normHandle
  };
})(globalThis);
