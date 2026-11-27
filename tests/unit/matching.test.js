import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/shared/matching.js", import.meta.url), "utf8");
const sandbox = { URL };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "matching.js" });
const m = sandbox.YCB.matching;
// Sandbox objects come from another realm, so compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

const UC = "UC" + "a".repeat(22);

test("parses handles from bare input, URLs and deep links", () => {
  const cases = [
    "@Foo_Bar",
    "https://www.youtube.com/@Foo_Bar",
    "https://youtube.com/@Foo_Bar",
    "youtube.com/@Foo_Bar",
    "https://m.youtube.com/@Foo_Bar/videos",
    "https://www.youtube.com/@Foo_Bar?si=abc"
  ];
  for (const input of cases) {
    const result = m.parseChannelInput(input);
    assert.equal(result.ok, true, input);
    assert.equal(result.entry.handle, "@Foo_Bar", input);
    assert.equal(result.entry.id, null, input);
    assert.equal(result.entry.name, null, input);
  }
});

test("parses channel IDs from bare input and URLs", () => {
  const bare = m.parseChannelInput(UC);
  assert.deepEqual(plain(bare.entry), { handle: null, id: UC, name: null });

  const url = m.parseChannelInput(`https://www.youtube.com/channel/${UC}/videos`);
  assert.deepEqual(plain(url.entry), { handle: null, id: UC, name: null });
});

test("parses legacy /c/ and /user/ paths as names", () => {
  assert.equal(m.parseChannelInput("https://www.youtube.com/c/SomeOne").entry.name, "SomeOne");
  assert.equal(m.parseChannelInput("https://www.youtube.com/user/SomeOne").entry.name, "SomeOne");
  assert.equal(m.parseChannelInput("https://www.youtube.com/user/Some%20One").entry.name, "Some One");
});

test("treats other input as an exact channel name", () => {
  const result = m.parseChannelInput("  Some Channel  ");
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.entry), { handle: null, id: null, name: "Some Channel" });
  assert.equal(m.parseChannelInput("ab").entry.name, "ab");
});

test("rejects unusable input", () => {
  assert.equal(m.parseChannelInput("").error, "empty");
  assert.equal(m.parseChannelInput("   ").error, "empty");
  assert.equal(m.parseChannelInput("https://vimeo.com/@someone").error, "host");
  assert.equal(m.parseChannelInput("https://www.youtube.com/feed/subscriptions").error, "path");
  assert.equal(m.parseChannelInput("UCtooShort").error, "id");
  assert.equal(m.parseChannelInput("x".repeat(81)).error, "name");
});

test("reads channel identity from links", () => {
  assert.deepEqual(plain(m.channelFromHref("/@Handle")), { handle: "@Handle", id: null, name: null });
  assert.deepEqual(plain(m.channelFromHref(`/channel/${UC}`)), { handle: null, id: UC, name: null });
  assert.deepEqual(plain(m.channelFromHref("/c/Legacy Name")), { handle: null, id: null, name: "Legacy Name" });
  assert.equal(m.channelFromHref("/watch?v=abc"), null);
  assert.equal(m.channelFromHref("/"), null);
  assert.equal(m.channelFromHref(""), null);
  assert.deepEqual(plain(m.channelFromHref("https://www.youtube.com/@Url")), { handle: "@Url", id: null, name: null });
});

test("matches channels by id, handle or exact name", () => {
  const byHandle = { handle: "@Foo", id: null, name: null };
  assert.equal(m.matchesChannel({ handle: "@foo", name: "Anything" }, byHandle), true);
  assert.equal(m.matchesChannel({ handle: "@bar", name: "Foo" }, byHandle), false, "name must not match a handle entry");
  assert.equal(m.matchesChannel({ id: UC, handle: null }, byHandle), false);

  const byId = { handle: null, id: UC, name: null };
  assert.equal(m.matchesChannel({ id: UC, name: "Different" }, byId), true);
  assert.equal(m.matchesChannel({ id: "UC" + "b".repeat(22) }, byId), false);

  const byName = { handle: null, id: null, name: "Some  Channel" };
  assert.equal(m.matchesChannel({ name: " some channel " }, byName), true);
  assert.equal(m.matchesChannel({ name: "Some Other Channel" }, byName), false);

  assert.equal(m.matchesChannel(null, byName), false);
  assert.equal(m.matchesChannel({ name: "x" }, null), false);
});

test("matches legacy /c/ names against name entries", () => {
  const entry = { handle: null, id: null, name: "Legacy Name" };
  assert.equal(m.matchesChannel({ legacy: "legacy name" }, entry), true);
});

test("addEntry dedupes and removeEntry removes by key", () => {
  let list = [];
  let result = m.addEntry(list, { handle: "@Foo", id: null, name: null });
  assert.equal(result.added, true);
  list = result.list;

  result = m.addEntry(list, { handle: "@foo", id: null, name: null });
  assert.equal(result.added, false);
  assert.equal(result.list.length, 1);

  const key = m.entryKey(list[0]);
  assert.equal(key, "handle:foo");
  list = m.removeEntry(list, key);
  assert.equal(list.length, 0);
});

test("normalizeList drops junk, caps names and dedupes", () => {
  const normalized = m.normalizeList([
    null,
    "string",
    { handle: "not-a-handle" },
    { handle: "@Good" },
    { handle: "@good" },
    { id: "nope" },
    { id: UC },
    { name: "   " },
    { name: "x".repeat(200) },
    { name: "Named", handle: "@ignored" }
  ]);
  assert.equal(normalized.length, 4);
  assert.deepEqual(plain(normalized[0]), { handle: "@Good", id: null, name: null });
  assert.deepEqual(plain(normalized[1]), { handle: null, id: UC, name: null });
  assert.equal(normalized[2].name.length, 80);
  assert.deepEqual(plain(normalized[3]), { handle: "@ignored", id: null, name: null });
  assert.deepEqual(plain(m.normalizeList("not an array")), []);
});

test("describes entries", () => {
  assert.equal(m.describeEntry({ handle: "@Foo" }), "@Foo");
  assert.equal(m.describeEntry({ id: UC }), UC);
  assert.equal(m.describeEntry({ name: "Name" }), "Name");
  assert.equal(m.entryKind({ handle: "@Foo" }), "handle");
  assert.equal(m.entryKind({ id: UC }), "channel id");
  assert.equal(m.entryKind({ name: "Name" }), "name");
});
