import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const matchingSource = readFileSync(new URL("../../src/shared/matching.js", import.meta.url), "utf8");
const profilesSource = readFileSync(new URL("../../src/shared/profiles.js", import.meta.url), "utf8");
const sandbox = { URL };
vm.createContext(sandbox);
vm.runInContext(matchingSource, sandbox, { filename: "matching.js" });
vm.runInContext(profilesSource, sandbox, { filename: "profiles.js" });
const p = sandbox.YCB.profiles;
const m = sandbox.YCB.matching;
const plain = (value) => JSON.parse(JSON.stringify(value));

test("migrate folds the legacy flat list into one enabled profile", () => {
  const legacy = { blockedChannels: [{ handle: "@301Diaries", id: null, name: null }] };
  const profiles = p.migrate(legacy);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].enabled, true);
  assert.equal(profiles[0].channels.length, 1);
  assert.equal(profiles[0].options.home, true);
  assert.equal(profiles[0].options.channelPage, true);
});

test("migrate prefers stored profiles and normalizes them", () => {
  const stored = {
    blockedChannels: [{ handle: "@legacy", id: null, name: null }],
    profiles: [
      { id: "a", name: "Study", channels: ["@301Diaries"], options: { home: false } },
      { name: "" },
      "garbage"
    ]
  };
  const profiles = p.migrate(stored);
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].name, "Study");
  assert.equal(profiles[0].channels[0].handle, "@301Diaries");
  assert.equal(profiles[0].options.home, false);
  assert.equal(profiles[0].options.search, true);
  assert.equal(profiles[1].name, "Profile 2");
  assert.equal(profiles[1].enabled, true);
});

test("entriesForSurface only pulls from enabled profiles with the surface on", () => {
  const profiles = p.normalizeProfiles([
    { id: "a", name: "A", channels: ["@one"], options: { home: false } },
    { id: "b", name: "B", channels: ["@two"], enabled: false },
    { id: "c", name: "C", channels: ["@three"] }
  ]);
  const home = p.entriesForSurface(profiles, "home");
  assert.deepEqual(plain(home.map((e) => e.handle)), ["@three"]);
  const search = p.entriesForSurface(profiles, "search");
  assert.deepEqual(plain(search.map((e) => e.handle)), ["@one", "@three"]);
  assert.deepEqual(p.entriesForSurface(profiles, "playback").length, 2);
  assert.deepEqual(plain(p.entriesForSurface(null, "home")), []);
});

test("allEntries ignores disabled profiles", () => {
  const profiles = p.normalizeProfiles([
    { id: "a", name: "A", channels: ["@one"] },
    { id: "b", name: "B", channels: ["@two"], enabled: false }
  ]);
  assert.equal(p.allEntries(profiles).length, 1);
});

test("newProfile starts enabled with every surface on and no channels", () => {
  const profile = p.newProfile(" Focus ");
  assert.equal(profile.name, "Focus");
  assert.equal(profile.enabled, true);
  assert.deepEqual(plain(profile.channels), []);
  for (const surface of p.SURFACES) assert.equal(profile.options[surface], true, surface);
});

test("migrate with neither profiles nor channels yields one empty profile", () => {
  const profiles = p.migrate({});
  assert.equal(profiles.length, 1);
  assert.deepEqual(plain(profiles[0].channels), []);
  assert.equal(m.parseChannelInput("@x").ok, true); // sanity: matching is present
});
