/*
 * Options page: a captcha gate that guards the blocked-channel list.
 *
 * The settings markup lives in a <template> and is only cloned into the page
 * after unlocking, so while locked the form is not in the DOM at all.
 * The unlock code is kept only as a SHA-256 hash; the plaintext is drawn once
 * and dropped, so it cannot be read back out of a variable.
 */
(function () {
  "use strict";

  var matching = globalThis.YCB.matching;
  var captcha = globalThis.YCB.captcha;
  var profilesMod = globalThis.YCB.profiles;

  var DEFAULTS = { profiles: null, blockedChannels: [], captchaEnabled: false, captchaLength: 32, unlockMinutes: 5, behavior: {}, showBlockButtons: true };

  /* Unhook-style YouTube behavior toggles. Off by default; content-script
   * wiring lives in src/content/behaviors-*.js. `parent` marks a feature
   * hierarchy: a parent that is ON already hides what its children would,
   * so children render as included/disabled while the parent is active.
   * `group` assigns the toggle to one of the three behavior cards.
   * autoplay is deliberately absent: the user discarded it (another
   * extension handles it better). */
  var BEHAVIORS = [
    { id: "videoSidebar", label: "Hide Video Sidebar", group: "watch" },
    { id: "recommended", label: "Hide Recommended", group: "watch", parent: "videoSidebar" },
    { id: "liveChat", label: "Hide Live Chat", group: "watch", parent: "videoSidebar" },
    { id: "playlist", label: "Hide Playlist", group: "watch", parent: "videoSidebar" },
    { id: "fundraiser", label: "Hide Fundraiser", group: "watch", parent: "videoSidebar" },
    { id: "merch", label: "Hide Merch, Tickets, Offers", group: "watch" },
    { id: "videoInfo", label: "Hide Video Info", group: "watch" },
    { id: "endScreenFeed", label: "Hide End Screen Feed", group: "watch" },
    { id: "endScreenCards", label: "Hide End Screen Cards", group: "watch" },
    { id: "comments", label: "Hide Comments", group: "watch" },
    { id: "hoverPreviews", label: "Disable Hover Previews", group: "watch" },
    { id: "annotations", label: "Disable Annotations", group: "watch" },
    { id: "homeFeed", label: "Hide Home Feed", group: "home" },
    { id: "shorts", label: "Hide Shorts", group: "home" },
    { id: "mixes", label: "Hide Mixes", group: "home" },
    { id: "inaptSearch", label: "Hide Inapt Search Results", group: "home" },
    { id: "squareThumbnails", label: "Square Thumbnails", group: "home" },
    { id: "hoverHighlight", label: "Disable Hover Highlight", group: "home" },
    { id: "blockShiftN", label: "Disable Shift+N (Next video)", group: "watch" },
    { id: "topHeader", label: "Hide Top Header", group: "nav" },
    { id: "notifications", label: "Hide Notifications", group: "nav", parent: "topHeader" },
    { id: "subscriptions", label: "Hide Subscriptions", group: "nav" },
    { id: "exploreTrending", label: "Hide Explore, Trending", group: "nav" },
    { id: "moreFromYouTube", label: "Hide More from YouTube", group: "nav" }
  ];

  var BEHAVIOR_GROUPS = [
    { id: "watch", listId: "behavior-list-watch" },
    { id: "home", listId: "behavior-list-home" },
    { id: "nav", listId: "behavior-list-nav" }
  ];

  var LOCK_KEY = "ycbUnlock";
  var ATTEMPTS_KEY = "ycbAttempts";
  var MAX_ATTEMPTS = 3;
  var COOLDOWN_MS = 60 * 1000;
  var UNLOCK_CHOICES = [1, 5, 15, 60];

  var app = document.getElementById("app");
  var gateTemplate = document.getElementById("gate-template");
  var settingsTemplate = document.getElementById("settings-template");

  var settings = null;
  var timers = { unlock: 0, cooldown: 0 };

  function stopTimers() {
    clearInterval(timers.unlock);
    clearInterval(timers.cooldown);
    timers.unlock = 0;
    timers.cooldown = 0;
  }

  function setMsg(node, text, kind) {
    if (!node) return;
    node.textContent = text || "";
    node.className = "msg" + (kind ? " " + kind : "");
  }

  function formatDuration(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var minutes = Math.floor(total / 60);
    var seconds = total % 60;
    return minutes + ":" + String(seconds).padStart(2, "0");
  }

  function randomInt(max) {
    return Math.floor(Math.random() * max);
  }

  async function sha256Hex(value) {
    var bytes = new TextEncoder().encode(value);
    var digest = await crypto.subtle.digest("SHA-256", bytes);
    var view = new Uint8Array(digest);
    var out = "";
    for (var i = 0; i < view.length; i += 1) out += view[i].toString(16).padStart(2, "0");
    return out;
  }

  async function getUnlock() {
    var stored = await chrome.storage.session.get(LOCK_KEY);
    var unlock = stored[LOCK_KEY];
    if (!unlock || typeof unlock.until !== "number" || unlock.until <= Date.now()) return null;
    return unlock;
  }

  async function getCooldownUntil() {
    var stored = await chrome.storage.session.get(ATTEMPTS_KEY);
    var attempts = stored[ATTEMPTS_KEY];
    if (!attempts || typeof attempts.until !== "number") return 0;
    return attempts.until > Date.now() ? attempts.until : 0;
  }

  async function recordFailure() {
    var stored = await chrome.storage.session.get(ATTEMPTS_KEY);
    var previous = stored[ATTEMPTS_KEY];
    var count = previous && typeof previous.attempts === "number" ? previous.attempts : 0;
    var next = count + 1;
    if (next >= MAX_ATTEMPTS) {
      var until = Date.now() + COOLDOWN_MS;
      await chrome.storage.session.set({ [ATTEMPTS_KEY]: { attempts: 0, until: until } });
      return { cooldownUntil: until, remaining: 0 };
    }
    await chrome.storage.session.set({ [ATTEMPTS_KEY]: { attempts: next, until: 0 } });
    return { cooldownUntil: 0, remaining: MAX_ATTEMPTS - next };
  }

  function normalizeBehavior(raw) {
    var out = {};
    for (var i = 0; i < BEHAVIORS.length; i += 1) {
      out[BEHAVIORS[i].id] = !!(raw && raw[BEHAVIORS[i].id] === true);
    }
    return out;
  }

  async function loadSettings() {
    var stored = await chrome.storage.local.get(DEFAULTS);
    return {
      profiles: profilesMod.migrate(stored),
      selected: 0,
      captchaEnabled: stored.captchaEnabled === true,
      showBlockButtons: stored.showBlockButtons !== false,
      captchaLength: captcha.pickLength(stored.captchaLength),
      unlockMinutes: UNLOCK_CHOICES.indexOf(Number(stored.unlockMinutes)) >= 0
        ? Number(stored.unlockMinutes)
        : 5,
      behavior: normalizeBehavior(stored.behavior)
    };
  }

  function currentProfile() {
    if (!settings.profiles.length) {
      settings.profiles.push(profilesMod.newProfile("Default"));
      settings.selected = 0;
    }
    if (settings.selected >= settings.profiles.length) settings.selected = settings.profiles.length - 1;
    return settings.profiles[settings.selected];
  }

  function saveSettings() {
    return chrome.storage.local.set({
      profiles: settings.profiles,
      captchaEnabled: settings.captchaEnabled,
      showBlockButtons: settings.showBlockButtons,
      captchaLength: settings.captchaLength,
      unlockMinutes: settings.unlockMinutes,
      behavior: settings.behavior
    });
  }

  /* ---------------------------------------------------------------- drawing */

  function drawCaptcha(canvas, code) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cols = 8;
    var rows = Math.ceil(code.length / cols);
    var cellW = 50;
    var cellH = 52;
    var padX = 22;
    var padY = 20;
    var width = padX * 2 + cols * cellW;
    var height = padY * 2 + rows * cellH;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.setAttribute("aria-label", "Image containing a " + code.length + " character unlock code.");

    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#11141b");
    background.addColorStop(1, "#0c0f14");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(140, 170, 205, 0.06)";
    ctx.lineWidth = 1;
    for (var gx = 0.5; gx < width; gx += 26) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, height);
      ctx.stroke();
    }
    for (var gy = 0.5; gy < height; gy += 26) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(width, gy);
      ctx.stroke();
    }

    var noiseColors = ["rgba(108, 178, 255, 0.16)", "rgba(255, 138, 138, 0.12)", "rgba(126, 226, 168, 0.12)"];
    for (var n = 0; n < 7; n += 1) {
      ctx.beginPath();
      ctx.strokeStyle = noiseColors[n % noiseColors.length];
      ctx.lineWidth = 1 + Math.random() * 1.4;
      ctx.moveTo(randomInt(width), randomInt(height));
      ctx.bezierCurveTo(
        randomInt(width), randomInt(height),
        randomInt(width), randomInt(height),
        randomInt(width), randomInt(height)
      );
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(200, 215, 235, 0.22)";
    for (var d = 0; d < 420; d += 1) {
      ctx.fillRect(randomInt(width), randomInt(height), 1, 1);
    }

    var glyphColors = ["#eaf1fb", "#cfe3fb", "#f2e8d6", "#bdd7f5"];
    ctx.font = '600 34px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (var i = 0; i < code.length; i += 1) {
      var col = i % cols;
      var row = Math.floor(i / cols);
      var x = padX + col * cellW + cellW / 2 + (Math.random() * 8 - 4);
      var y = padY + row * cellH + cellH / 2 + (Math.random() * 10 - 5);

      if (col > 0 && col % 4 === 0) {
        ctx.save();
        ctx.fillStyle = "rgba(150, 175, 205, 0.18)";
        ctx.fillRect(padX + col * cellW - 4, y - 15, 1, 30);
        ctx.restore();
      }

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.random() * 0.2 - 0.1);
      ctx.fillStyle = glyphColors[randomInt(glyphColors.length)];
      ctx.globalAlpha = 0.84 + Math.random() * 0.16;
      ctx.fillText(code.charAt(i), 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------- gate */

  function renderGate() {
    stopTimers();
    if (!settings.captchaEnabled) {
      renderSettings();
      return;
    }
    app.replaceChildren(gateTemplate.content.cloneNode(true));

    var canvas = app.querySelector("#gate-canvas");
    var form = app.querySelector("#gate-form");
    var input = app.querySelector("#gate-input");
    var submit = app.querySelector("#gate-submit");
    var msg = app.querySelector("#gate-msg");
    var lengthNode = app.querySelector("#gate-length");

    var challenge = "";
    var busy = false;
    var cooldownUntil = 0;

    if (lengthNode) lengthNode.textContent = String(settings.captchaLength);

    function newChallenge() {
      var code = captcha.generateCode(settings.captchaLength);
      drawCaptcha(canvas, code);
      challenge = sha256Hex(captcha.normalizeAnswer(code));
      input.value = "";
    }

    function setFormEnabled(enabled) {
      input.disabled = !enabled;
      submit.disabled = !enabled;
    }

    function startCooldown(until) {
      cooldownUntil = until;
      stopTimers();
      setFormEnabled(false);
      var tick = function () {
        if (!app.querySelector("#gate-msg")) {
          stopTimers();
          return;
        }
        var left = cooldownUntil - Date.now();
        if (left <= 0) {
          cooldownUntil = 0;
          stopTimers();
          setFormEnabled(true);
          setMsg(msg, "Cooldown over. Here is a new code.", "");
          newChallenge();
          input.focus();
          return;
        }
        setMsg(msg, "Too many attempts. Wait " + Math.ceil(left / 1000) + "s.", "error");
      };
      tick();
      timers.cooldown = setInterval(tick, 500);
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (busy || cooldownUntil > Date.now()) return;
      var answer = input.value;
      if (!captcha.normalizeAnswer(answer)) {
        setMsg(msg, "Type the code first.", "error");
        input.focus();
        return;
      }
      busy = true;
      setFormEnabled(false);
      try {
        var expected = await challenge;
        var hash = await sha256Hex(captcha.normalizeAnswer(answer));
        if (expected && hash === expected) {
          await chrome.storage.session.set({
            [LOCK_KEY]: { until: Date.now() + settings.unlockMinutes * 60 * 1000 }
          });
          await chrome.storage.session.remove(ATTEMPTS_KEY);
          renderSettings();
          return;
        }
        var failure = await recordFailure();
        if (failure.cooldownUntil) {
          startCooldown(failure.cooldownUntil);
          return;
        }
        newChallenge();
        setMsg(msg, "Incorrect. " + failure.remaining + " attempt" +
          (failure.remaining === 1 ? "" : "s") + " left before a cooldown.", "error");
        setFormEnabled(true);
        input.focus();
      } finally {
        busy = false;
      }
    });

    app.querySelector("#gate-new").addEventListener("click", function () {
      if (cooldownUntil > Date.now()) return;
      newChallenge();
      setMsg(msg, "New code generated.", "");
      input.focus();
    });

    canvas.addEventListener("click", function () {
      if (cooldownUntil > Date.now()) return;
      newChallenge();
      setMsg(msg, "New code generated.", "");
      input.focus();
    });

    newChallenge();
    input.focus();

    getCooldownUntil().then(function (until) {
      if (until) startCooldown(until);
    });
  }

  /* --------------------------------------------------------------- settings */

  function channelRow(entry) {
    var li = document.createElement("li");

    var chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = matching.entryKind(entry);

    var label = document.createElement("span");
    label.className = "channel";
    label.textContent = matching.describeEntry(entry);

    var remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", "Remove " + matching.describeEntry(entry));
    remove.addEventListener("click", function () {
      var profile = currentProfile();
      var key = matching.entryKey(entry);
      profile.channels = matching.removeEntry(profile.channels, key);
      saveSettings();
      renderList();
      setMsg(app.querySelector("#add-msg"), "Removed " + matching.describeEntry(entry) + ".", "");
    });

    li.appendChild(chip);
    li.appendChild(label);
    li.appendChild(remove);
    return li;
  }

  function renderList() {
    var list = app.querySelector("#list");
    var empty = app.querySelector("#list-empty");
    if (!list || !empty) return;
    var profile = currentProfile();
    list.replaceChildren();
    profile.channels.forEach(function (entry) {
      list.appendChild(channelRow(entry));
    });
    empty.hidden = profile.channels.length > 0;
  }

  function renderProfileEditor() {
    var profile = currentProfile();
    var title = app.querySelector("#profile-title");
    var name = app.querySelector("#profile-name");
    var enabled = app.querySelector("#profile-enabled");
    if (title) title.textContent = profile.name;
    if (name) name.value = profile.name;
    if (enabled) enabled.checked = !!profile.enabled;
  }

  function renderProfileBar() {
    var tabs = app.querySelector("#profile-tabs");
    if (!tabs) return;
    var profile = currentProfile();
    var channelsName = app.querySelector("#channels-profile-name");
    if (channelsName) channelsName.textContent = profile.name;
    tabs.replaceChildren();

    function tabButton(label, index) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "profile-tab";
      button.setAttribute("role", "tab");
      button.textContent = label;
      button.setAttribute("aria-selected", index === settings.selected ? "true" : "false");
      if (index === settings.selected) button.classList.add("is-active");
      button.addEventListener("click", function () {
        if (settings.selected === index) return;
        settings.selected = index;
        renderProfileBar();
        renderProfileEditor();
        renderList();
        renderSurfaceOptions();
      });
      return button;
    }

    settings.profiles.forEach(function (p, index) {
      var label = p.name + " (" + p.channels.length + ")";
      if (!p.enabled) {
        var strike = document.createElement("s");
        strike.textContent = label;
        var wrap = document.createElement("span");
        wrap.appendChild(strike);
        var off = document.createElement("span");
        off.className = "tab-off";
        off.textContent = " off";
        wrap.appendChild(off);
        var button = tabButton("", index);
        button.appendChild(wrap);
        tabs.appendChild(button);
        return;
      }
      tabs.appendChild(tabButton(label, index));
    });

    var add = document.createElement("button");
    add.type = "button";
    add.className = "profile-tab profile-tab-add";
    add.textContent = "+";
    add.setAttribute("aria-label", "New profile");
    add.addEventListener("click", function () {
      var name = window.prompt("Name for the new profile:", "Profile " + (settings.profiles.length + 1));
      if (name === null) return;
      settings.profiles.push(profilesMod.newProfile(name));
      settings.selected = settings.profiles.length - 1;
      saveSettings();
      renderProfileBar();
      renderProfileEditor();
      renderList();
      renderSurfaceOptions();
    });
    tabs.appendChild(add);
  }

  function renderSurfaceOptions() {
    var profile = currentProfile();
    for (var i = 0; i < profilesMod.SURFACES.length; i += 1) {
      var surface = profilesMod.SURFACES[i];
      var box = app.querySelector("#opt-" + surface);
      if (!box) continue;
      box.checked = profile.options[surface] !== false;
    }
  }

  /* ---------------------------------------------------- YouTube behavior UI */

  function behaviorRow(item, parentOn) {
    var li = document.createElement("li");
    if (parentOn) li.className = "behavior-child behavior-included";
    else if (item.parent) li.className = "behavior-child";

    var label = document.createElement("label");
    label.className = "behavior-row";

    var span = document.createElement("span");
    span.className = "behavior-label";
    span.textContent = item.label;

    var box = document.createElement("input");
    box.type = "checkbox";
    box.className = "switch";
    box.checked = settings.behavior[item.id] === true;
    if (parentOn) {
      box.disabled = true;
      box.setAttribute("aria-label", item.label + " (already covered by the parent toggle)");
    }
    box.addEventListener("change", function (event) {
      settings.behavior[item.id] = !!event.target.checked;
      saveSettings();
      /* flipping a parent re-nests its children */
      if (BEHAVIORS.some(function (other) { return other.parent === item.id; })) {
        renderBehavior();
      }
    });

    label.appendChild(span);
    if (parentOn) {
      var note = document.createElement("span");
      note.className = "behavior-note";
      note.textContent = "included";
      label.appendChild(note);
    }
    label.appendChild(box);
    li.appendChild(label);
    return li;
  }

  function groupSelectState(groupId) {
    var items = BEHAVIORS.filter(function (item) { return item.group === groupId; });
    var on = items.filter(function (item) { return settings.behavior[item.id] === true; }).length;
    if (on === 0) return "all-off";
    if (on === items.length) return "all-on";
    return "custom";
  }

  function pillToggleRow() {
    var li = document.createElement("li");
    var label = document.createElement("label");
    label.className = "behavior-row";
    var span = document.createElement("span");
    span.className = "behavior-label";
    span.textContent = "Show block buttons on video cards";
    var box = document.createElement("input");
    box.type = "checkbox";
    box.className = "switch";
    box.checked = settings.showBlockButtons !== false;
    box.addEventListener("change", function (event) {
      settings.showBlockButtons = !!event.target.checked;
      saveSettings();
    });
    label.appendChild(span);
    label.appendChild(box);
    li.appendChild(label);
    return li;
  }

  function renderBehavior() {
    BEHAVIOR_GROUPS.forEach(function (group) {
      var list = app.querySelector("#" + group.listId);
      if (!list) return;
      var select = app.querySelector("#" + "group-select-" + group.id);
      if (select) select.value = groupSelectState(group.id);
      list.replaceChildren();
      BEHAVIORS.forEach(function (item) {
        if (item.group !== group.id) return;
        var parentOn = item.parent && settings.behavior[item.parent] === true;
        if (parentOn) {
          /* children of an enabled parent are rendered right under it */
          return;
        }
        list.appendChild(behaviorRow(item, false));
        if (!item.parent && settings.behavior[item.id] === true) {
          BEHAVIORS.forEach(function (child) {
            if (child.parent === item.id) list.appendChild(behaviorRow(child, true));
          });
        }
      });
      if (group.id === "home") list.appendChild(pillToggleRow());
    });
  }

  function bindGroupSelects() {
    BEHAVIOR_GROUPS.forEach(function (group) {
      var select = app.querySelector("#group-select-" + group.id);
      if (!select) return;
      select.addEventListener("change", function (event) {
        var value = event.target.value;
        if (value !== "all-on" && value !== "all-off") return;
        BEHAVIORS.forEach(function (item) {
          if (item.group === group.id) settings.behavior[item.id] = value === "all-on";
        });
        saveSettings();
        renderBehavior();
      });
    });
  }

  function sectionFromHash() {
    var hash = (location.hash || "").replace("#", "");
    var items = app.querySelectorAll(".side-item");
    for (var i = 0; i < items.length; i += 1) {
      if (items[i].getAttribute("data-nav") === hash) return hash;
    }
    return "behavior"; /* default landing section */
  }

  function activateSection(section) {
    var panels = app.querySelectorAll(".panel");
    for (var i = 0; i < panels.length; i += 1) {
      panels[i].hidden = panels[i].getAttribute("data-panel") !== section;
    }
    var items = app.querySelectorAll(".side-item");
    for (var j = 0; j < items.length; j += 1) {
      items[j].classList.toggle("is-active", items[j].getAttribute("data-nav") === section);
    }
  }

  function bindNav() {
    var items = app.querySelectorAll(".side-item");
    for (var i = 0; i < items.length; i += 1) {
      (function (button) {
        button.addEventListener("click", function () {
          var target = button.getAttribute("data-nav");
          activateSection(target);
          if (location.hash !== "#" + target) {
            history.replaceState(null, "", "#" + target);
          }
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
      })(items[i]);
    }
  }

  function errorMessage(code) {
    if (code === "empty") return "Type a channel handle, URL, or name.";
    if (code === "id") return "Channel IDs start with UC followed by 22 characters.";
    if (code === "name") return "Names must be 2 to 80 characters.";
    if (code === "url" || code === "host" || code === "path") {
      return "Use a YouTube channel URL such as https://www.youtube.com/@handle.";
    }
    return "Could not read that channel.";
  }

  function renderSettings() {
    stopTimers();
    app.replaceChildren(settingsTemplate.content.cloneNode(true));

    var addForm = app.querySelector("#add-form");
    var addInput = app.querySelector("#add-input");
    var addMsg = app.querySelector("#add-msg");
    var lengthSelect = app.querySelector("#captcha-length");
    var minutesSelect = app.querySelector("#unlock-minutes");

    renderProfileBar();
    renderProfileEditor();
    renderList();
    renderSurfaceOptions();
    renderBehavior();
    bindGroupSelects();
    bindNav();
    activateSection(sectionFromHash());
    window.addEventListener("hashchange", function () {
      if (app.querySelector(".side-item")) activateSection(sectionFromHash());
    });

    var profileEditForm = app.querySelector("#profile-edit-form");
    profileEditForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var nameInput = app.querySelector("#profile-name");
      var profile = currentProfile();
      var next = nameInput.value.trim().slice(0, 60);
      if (!next) {
        nameInput.value = profile.name;
        setMsg(app.querySelector("#add-msg"), "Profile name cannot be empty.", "error");
        return;
      }
      profile.name = next;
      saveSettings();
      renderProfileBar();
      renderProfileEditor();
      setMsg(app.querySelector("#add-msg"), "Profile renamed to \"" + next + "\".", "ok");
    });

    app.querySelector("#profile-enabled").addEventListener("change", function (event) {
      currentProfile().enabled = !!event.target.checked;
      saveSettings();
      renderProfileBar();
    });

    app.querySelector("#profile-delete").addEventListener("click", function () {
      if (settings.profiles.length <= 1) {
        setMsg(app.querySelector("#add-msg"), "The last profile cannot be deleted.", "error");
        return;
      }
      var profile = currentProfile();
      if (!window.confirm("Delete profile \"" + profile.name + "\" and its " +
        profile.channels.length + " blocked channel(s)?")) return;
      settings.profiles.splice(settings.selected, 1);
      settings.selected = 0;
      saveSettings();
      renderProfileBar();
      renderProfileEditor();
      renderList();
      renderSurfaceOptions();
    });

    for (var i = 0; i < profilesMod.SURFACES.length; i += 1) {
      (function (surface) {
        var box = app.querySelector("#opt-" + surface);
        if (!box) return;
        box.addEventListener("change", function (event) {
          currentProfile().options[surface] = !!event.target.checked;
          saveSettings();
        });
      })(profilesMod.SURFACES[i]);
    }

    addForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var parsed = matching.parseChannelInput(addInput.value);
      if (!parsed.ok) {
        setMsg(addMsg, errorMessage(parsed.error), "error");
        addInput.focus();
        return;
      }
      var profile = currentProfile();
      var result = matching.addEntry(profile.channels, parsed.entry);
      if (!result.added) {
        setMsg(addMsg, "That channel is already blocked in this profile.", "error");
        return;
      }
      profile.channels = result.list;
      saveSettings();
      addInput.value = "";
      renderList();
      renderProfileBar();
      setMsg(addMsg, "Blocked " + matching.describeEntry(parsed.entry) + ".", "ok");
      addInput.focus();
    });

    var captchaSwitch = app.querySelector("#captcha-enabled");
    if (captchaSwitch) {
      captchaSwitch.checked = settings.captchaEnabled === true;
      captchaSwitch.addEventListener("change", function (event) {
        settings.captchaEnabled = !!event.target.checked;
        saveSettings();
      });
    }

    lengthSelect.value = String(settings.captchaLength);
    lengthSelect.addEventListener("change", function () {
      settings.captchaLength = captcha.pickLength(lengthSelect.value);
      saveSettings();
    });

    minutesSelect.value = String(settings.unlockMinutes);
    minutesSelect.addEventListener("change", function () {
      var value = Number(minutesSelect.value);
      settings.unlockMinutes = UNLOCK_CHOICES.indexOf(value) >= 0 ? value : 5;
      saveSettings();
    });

    app.querySelector("#lock-now").addEventListener("click", async function () {
      await chrome.storage.session.remove(LOCK_KEY);
      renderGate();
    });

    if (!settings.captchaEnabled) return; // no gate: skip the lock timer entirely
    getUnlock().then(function (unlock) {
      if (!unlock) {
        renderGate();
        return;
      }
      var tick = function () {
        var node = app.querySelector("#lock-timer");
        if (!node) {
          stopTimers();
          return;
        }
        var left = unlock.until - Date.now();
        if (left <= 0) {
          stopTimers();
          chrome.storage.session.remove(LOCK_KEY).then(renderGate);
          return;
        }
        node.textContent = "Locks in " + formatDuration(left);
      };
      tick();
      timers.unlock = setInterval(tick, 500);
    });
  }

  /* ------------------------------------------------------------------- boot */

  (async function boot() {
    settings = await loadSettings();
    if (!settings.captchaEnabled) {
      renderSettings();
      return;
    }
    var unlock = await getUnlock();
    if (unlock) renderSettings();
    else renderGate();
  })();
})();
