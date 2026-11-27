/*
 * Profile ("block set") model shared by the content script, the options page
 * and the unit tests. No chrome.* access here so it stays trivially testable.
 *
 * A profile is:
 *   { id, name, enabled, channels: [entry], options: {surface: bool} }
 * Surfaces: home, search, shorts, channelPage, playback.
 * The legacy flat `blockedChannels` list migrates into one enabled profile.
 */
(function (root) {
  "use strict";

  if (root.YCB && root.YCB.profiles) return;

  var matching = root.YCB && root.YCB.matching;

  var SURFACES = ["home", "search", "shorts", "channelPage", "playback"];

  function defaultOptions() {
    return { home: true, search: true, shorts: true, channelPage: true, playback: true };
  }

  function uid() {
    return "p" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function text(value) {
    return value == null ? "" : String(value);
  }

  function normalizeOptions(raw) {
    var options = defaultOptions();
    if (raw && typeof raw === "object") {
      for (var i = 0; i < SURFACES.length; i += 1) {
        var surface = SURFACES[i];
        if (raw[surface] === false) options[surface] = false;
        else if (raw[surface] === true) options[surface] = true;
      }
    }
    return options;
  }

  /* Channels may be stored as entries or as raw user input (strings); both
   * are accepted so profiles survive round-trips through forms and storage. */
  function normalizeChannels(raw) {
    if (!matching || !Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length; i += 1) {
      var item = raw[i];
      if (typeof item === "string") {
        var parsed = matching.parseChannelInput(item);
        if (parsed.ok) out = matching.addEntry(out, parsed.entry).list;
      } else if (item && typeof item === "object") {
        out = out.concat(matching.normalizeList([item]));
      }
    }
    return out;
  }

  function normalizeProfile(raw, fallbackName) {
    var rawProfile = raw && typeof raw === "object" ? raw : {};
    var channels = normalizeChannels(rawProfile.channels);
    return {
      id: text(rawProfile.id).trim() || uid(),
      name: text(rawProfile.name).trim().slice(0, 60) || fallbackName,
      enabled: rawProfile.enabled === false ? false : true,
      channels: channels,
      options: normalizeOptions(rawProfile.options)
    };
  }

  /** Normalize an array-ish raw value into a valid profile list. */
  function normalizeProfiles(raw) {
    var list = Array.isArray(raw) ? raw : [];
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      if (!list[i] || typeof list[i] !== "object") continue;
      out.push(normalizeProfile(list[i], "Profile " + (out.length + 1)));
    }
    return out;
  }

  /**
   * Full-storage migration. Prefers stored `profiles`; otherwise folds the
   * legacy flat `blockedChannels` list into one enabled profile so nothing
   * the user already blocked is lost.
   */
  function migrate(stored) {
    var raw = stored || {};
    if (Array.isArray(raw.profiles) && raw.profiles.length) {
      return normalizeProfiles(raw.profiles);
    }
    if (Array.isArray(raw.profiles)) return [];
    var legacy = matching && Array.isArray(raw.blockedChannels)
      ? matching.normalizeList(raw.blockedChannels)
      : [];
    return [{
      id: uid(),
      name: "Default",
      enabled: true,
      channels: legacy,
      options: defaultOptions()
    }];
  }

  /** Union of the channel entries that apply to one surface. */
  function entriesForSurface(profiles, surface) {
    var out = [];
    if (!Array.isArray(profiles)) return out;
    for (var i = 0; i < profiles.length; i += 1) {
      var profile = profiles[i];
      if (!profile || profile.enabled === false) continue;
      if (profile.options && profile.options[surface] === false) continue;
      out = out.concat(Array.isArray(profile.channels) ? profile.channels : []);
    }
    return out;
  }

  /** Union over every surface, for counting / display. */
  function allEntries(profiles) {
    var out = [];
    if (!Array.isArray(profiles)) return out;
    for (var i = 0; i < profiles.length; i += 1) {
      var profile = profiles[i];
      if (!profile || profile.enabled === false) continue;
      out = out.concat(Array.isArray(profile.channels) ? profile.channels : []);
    }
    return out;
  }

  root.YCB = root.YCB || {};
  root.YCB.profiles = {
    SURFACES: SURFACES,
    defaultOptions: defaultOptions,
    normalizeProfile: normalizeProfile,
    normalizeProfiles: normalizeProfiles,
    migrate: migrate,
    entriesForSurface: entriesForSurface,
    allEntries: allEntries,
    newProfile: function (name) {
      return {
        id: uid(),
        name: text(name).trim().slice(0, 60) || "Profile",
        enabled: true,
        channels: [],
        options: defaultOptions()
      };
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
