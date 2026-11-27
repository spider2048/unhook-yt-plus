/*
 * Live demo in a real Chrome window, using the chrome-devtools-mcp profile
 * (/home/spider/.cache/chrome-devtools-mcp/chrome-profile) with this extension
 * force-loaded at startup.
 *
 * Chrome only loads unpacked extensions at launch, so we spawn Chrome with
 * --load-extension, then attach over CDP to drive it.
 *
 * Run: node scripts/demo.mjs
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EXT = path.resolve(import.meta.dirname, "..");
const SHOTS = path.join(EXT, "demo-shots");
const CHROME = process.env.CHROME_PATH || "/usr/bin/brave-browser";
const PROFILE = process.env.PROFILE || "/home/spider/.cache/ycb-brave-profile";
const PORT = Number(process.env.CDP_PORT || 9223);
const KEEP_OPEN_MS = Number(process.env.KEEP_OPEN_MS || 10 * 60 * 1000);
const CHROME_LOG = "/tmp/ycb-browser.log";

fs.mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(pathname) {
  const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`);
  if (!res.ok) throw new Error(`CDP ${pathname} -> ${res.status}`);
  return res.json();
}

async function waitForChrome(timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      await httpJson("/json/version");
      return;
    } catch {
      await pause(300);
    }
  }
  throw new Error("Chrome did not expose a CDP endpoint");
}

async function extensionIdFromTargets() {
  for (let i = 0; i < 60; i += 1) {
    const targets = await httpJson("/json/list");
    const hit = targets.find((t) => typeof t.url === "string" && t.url.includes("/src/background/service-worker.js"));
    if (hit) return new URL(hit.url).host;
    await pause(250);
  }
  const targets = await httpJson("/json/list");
  log("chrome-extension targets seen:", targets.filter((t) => t.url?.startsWith("chrome-extension://")).map((t) => t.url).join(", ") || "(none)");
  return null;
}

async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  log("screenshot", path.relative(EXT, file));
}

async function waitForFeed(page) {
  await page.waitForSelector("ytd-rich-item-renderer", { timeout: 45000 });
  await page.mouse.wheel(0, 500);
  await pause(1200);
}

async function harvestCard(page) {
  return page.evaluate(() => {
    for (const card of [...document.querySelectorAll("ytd-rich-item-renderer")]) {
      const hrefs = [...card.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
      const channelHref = hrefs.find((h) => /^\/@[\w.-]{3,30}/.test(h) || /^\/channel\/UC[\w-]{22}/.test(h));
      const watchHref = hrefs.find((h) => /^\/watch\?v=/.test(h));
      if (!channelHref || !watchHref) continue;
      const name = (card.querySelector("#channel-name")?.textContent || "").replace(/\s+/g, " ").trim();
      return { channelHref, watchHref, name, handle: (channelHref.match(/^\/@([\w.-]+)/) || [])[1] || null };
    }
    return null;
  });
}

const chrome = spawn(
  CHROME,
  [
    `--user-data-dir=${PROFILE}`,
    `--load-extension=${EXT}`,
    `--disable-extensions-except=${EXT}`,
    `--remote-debugging-port=${PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-position=80,40",
    "--window-size=1460,1000",
    "--lang=en-US",
    "--disable-features=Translate",
    "--enable-logging=stderr",
    "--log-level=0",
    "about:blank"
  ],
  { detached: true, stdio: ["ignore", "ignore", fs.openSync(CHROME_LOG, "a")] }
);
chrome.unref();
log("spawned", path.basename(CHROME), "pid", chrome.pid, "profile", PROFILE, "extension", EXT, "log", CHROME_LOG);

let browser;
try {
  await waitForChrome();
  const extId = await extensionIdFromTargets();
  log("extension target:", extId || "(none seen yet)");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const context = browser.contexts()[0];

  // ---------- 1. settings page: locked gate ----------
  const ui = await context.newPage();
  await ui.addInitScript(() => {
    const digest = SubtleCrypto.prototype.digest;
    SubtleCrypto.prototype.digest = function (alg, data) {
      try {
        const text = new TextDecoder().decode(data);
        if (/^(?:[A-HJ-NP-Z2-9]{32}|[A-HJ-NP-Z2-9]{64})$/.test(text)) window.__ycbCode = text;
      } catch (e) {}
      return digest.call(this, alg, data);
    };
  });
  const settingsUrl = `chrome-extension://${extId}/src/options/options.html`;
  log("settings page:", settingsUrl);
  await ui.goto(settingsUrl, { timeout: 20000 });
  await ui.waitForSelector("#gate-canvas", { timeout: 15000 });
  const box = await ui.locator("#gate-canvas").boundingBox();
  log("gate up: canvas", `${Math.round(box.width)}x${Math.round(box.height)}`, "px, add-channel inputs visible:", await ui.locator("#add-input").count());
  await shot(ui, "01-settings-locked");
  await pause(3500);

  // ---------- 2. solve the captcha ----------
  const code = await ui.waitForFunction(() => window.__ycbCode, null, { timeout: 20000 }).then((h) => h.jsonValue());
  log("captcha:", code.length, "chars, typing it");
  await ui.click("#gate-input");
  await ui.type("#gate-input", code, { delay: 60 });
  await pause(400);
  await ui.click("#gate-submit");
  await ui.waitForSelector("#add-form", { timeout: 15000 });
  log("unlocked, settings form present");
  await shot(ui, "02-settings-unlocked");
  await pause(2500);

  // ---------- 3. live home feed before ----------
  const feed = await context.newPage();
  log("opening youtube.com home");
  await feed.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForFeed(feed);
  await pause(1500);
  const target = await harvestCard(feed);
  if (!target) throw new Error("no channel card found on the live feed");
  log("picked channel:", JSON.stringify(target.name), "->", target.handle ? "@" + target.handle : target.channelHref);
  log("cards hidden so far:", await feed.locator("ytd-rich-item-renderer[data-ycb-hidden]").count());
  await shot(feed, "03-feed-before");
  await pause(2500);

  // ---------- 4. add it through the UI ----------
  await ui.bringToFront();
  const entry = target.handle ? `@${target.handle}` : target.channelHref;
  log("adding", entry, "in the settings UI");
  await ui.fill("#add-input", entry);
  await ui.press("#add-input", "Enter");
  await ui.waitForSelector("#list .channel", { timeout: 10000 });
  log("list now:", (await ui.locator("#list .channel").allTextContents()).join(" | "));
  log("stored:", JSON.stringify(await ui.evaluate(() => chrome.storage.local.get("blockedChannels"))));
  await shot(ui, "04-channel-added");
  await pause(2000);

  // ---------- 5. home feed after ----------
  await feed.bringToFront();
  log("reloading the home feed");
  await feed.reload({ waitUntil: "domcontentloaded" });
  await waitForFeed(feed);
  await pause(2500);
  const hidden = await feed.locator("ytd-rich-item-renderer[data-ycb-hidden]").count();
  log("cards hidden after blocking:", hidden);
  await shot(feed, "05-feed-after");
  if (hidden === 0) log("WARNING: none of the reloaded cards belonged to the blocked channel");

  // ---------- 6. playback redirect ----------
  log("opening their video", target.watchHref);
  await feed.goto(`https://www.youtube.com${target.watchHref}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await feed.waitForURL(/blocked\.html/, { timeout: 25000 });
  await feed.waitForSelector("#channel");
  log("redirected to", feed.url().replace(/^chrome-extension:\/\/[a-p]+/, "").replace(/\?.*/, "").replace(/\/[^/]+$/, "/blocked.html"));
  log("page says:", JSON.stringify(await feed.locator("h1").innerText()), "channel:", JSON.stringify(await feed.locator("#channel").innerText()));
  await shot(feed, "06-blocked");
  await feed.bringToFront();

  log("DEMO OK. Chrome stays open on the MCP profile; close the window when done.");
} catch (error) {
  log("DEMO FAILED:", error.message);
  const page = browser?.contexts()[0]?.pages().at(-1);
  if (page) await shot(page, "99-failure").catch(() => {});
  process.exitCode = 1;
}

await pause(KEEP_OPEN_MS);
await browser?.close().catch(() => {});
log("demo finished, leaving Chrome running");
