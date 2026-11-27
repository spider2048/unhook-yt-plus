import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/shared/behavior.js", import.meta.url), "utf8");
const sandbox = { URL };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "behavior.js" });
const b = sandbox.YCB.behavior;
const plain = (value) => JSON.parse(JSON.stringify(value));

test("IDS holds the behavior ids", () => {
  assert.equal(b.IDS.length, 25);
  for (const id of ["homeFeed", "shorts", "autoplay", "annotations", "moreFromYouTube"]) {
    assert.ok(b.IDS.indexOf(id) !== -1, id);
  }
});

test("normalizeBehavior keeps strict booleans and drops unknown keys", () => {
  const out = b.normalizeBehavior({ comments: true, shorts: "yes", autoplay: 1, bogus: true });
  assert.deepEqual(plain(out.comments), true);
  assert.deepEqual(plain(out.shorts), false);
  assert.deepEqual(plain(out.autoplay), false);
  assert.equal("bogus" in out, false);
  assert.equal(Object.keys(out).length, b.IDS.length);
  assert.deepEqual(plain(b.normalizeBehavior(null)), plain(b.normalizeBehavior({})));
});

test("register validates ids, keeps first registration, and rejects duplicates", () => {
  assert.equal(b.register({ id: "comments", css: "/*c*/" }), true);
  assert.equal(b.register({ id: "not-a-behavior", css: "x" }), false);
  assert.equal(b.register({ id: "comments", css: "/*second*/" }), false);
  assert.equal(b.register(null), false);
  assert.ok(b.cssBundle().indexOf("/*c*/") !== -1);
  assert.ok(b.cssBundle().indexOf("/*second*/") === -1);
});

test("tokens and enabledSpecs follow the behavior object", () => {
  assert.equal(b.register({ id: "shorts", css: "/*s*/" }), true);
  const obj = b.normalizeBehavior({ comments: true, shorts: true });
  assert.deepEqual(plain(b.tokens(obj).sort()), ["comments", "shorts"]);
  const specs = b.enabledSpecs(obj);
  assert.equal(specs.length, 2);
  assert.deepEqual(plain(specs.map((s) => s.id).sort()), ["comments", "shorts"]);
});

test("tokens ignores enabled ids that were never registered", () => {
  const obj = b.normalizeBehavior({ comments: true, shorts: true, autoplay: true });
  assert.deepEqual(plain(b.tokens(obj).sort()), ["comments", "shorts"]);
  assert.equal(b.tokens(obj).indexOf("autoplay"), -1);
});

test("isMixHref detects radio playlists and rejects normal lists", () => {
  assert.equal(b.isMixHref("/watch?v=x&list=RDABC&start_radio=1"), true);
  assert.equal(b.isMixHref("/watch?v=x&list=RDABC"), true);
  assert.equal(b.isMixHref("https://www.youtube.com/watch?v=x&list=PL123&start_radio=1"), true);
  assert.equal(b.isMixHref("/watch?v=x&list=PL123"), false);
  assert.equal(b.isMixHref("/watch?v=x"), false);
  assert.equal(b.isMixHref(""), false);
});

test("matchesInaptShelfTitle is anchored and whitespace tolerant", () => {
  assert.equal(b.matchesInaptShelfTitle("  People   also watched "), true);
  assert.equal(b.matchesInaptShelfTitle("For You"), true);
  assert.equal(b.matchesInaptShelfTitle("for you proposed"), false);
  assert.equal(b.matchesInaptShelfTitle("People also watched more of this"), false);
  assert.equal(b.matchesInaptShelfTitle(""), false);
  assert.equal(b.matchesInaptShelfTitle(null), false);
});
