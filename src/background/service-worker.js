/* Seeds defaults on install, migrates the legacy flat list into a profile,
 * and opens the settings page from the toolbar icon. */

const DEFAULTS = {
  profiles: null,
  blockedChannels: [],
  captchaLength: 32,
  unlockMinutes: 5
};

const ALL_SURFACES = {
  home: true,
  search: true,
  shorts: true,
  channelPage: true,
  playback: true
};

function uid() {
  return "p" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const stored = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set({
    captchaLength: stored.captchaLength === 64 ? 64 : 32,
    unlockMinutes: Number(stored.unlockMinutes) > 0 ? Number(stored.unlockMinutes) : 5
  });
  if (!Array.isArray(stored.profiles)) {
    await chrome.storage.local.set({
      profiles: [{
        id: uid(),
        name: "Default",
        enabled: true,
        channels: Array.isArray(stored.blockedChannels) ? stored.blockedChannels : [],
        options: { ...ALL_SURFACES }
      }]
    });
  }
  console.info("[unhook-yt-plus] installed:", details.reason);
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

/* Context menu: right-click a playing video (works on /watch pages, where a
 * real <video> element exists) to add its channel to the blocklist. */
const ADD_CHANNEL_MENU = "ycb-add-channel";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create(
    {
      id: ADD_CHANNEL_MENU,
      title: "Add channel to blocklist",
      contexts: ["video"]
    },
    () => void chrome.runtime.lastError
  );
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== ADD_CHANNEL_MENU || !tab || typeof tab.id !== "number") return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "ycb-add-current-channel" });
  } catch (error) {
    /* tab without our content script (new tab page, other sites) */
  }
});
