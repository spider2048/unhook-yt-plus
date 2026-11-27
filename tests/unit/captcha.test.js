import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/shared/captcha.js", import.meta.url), "utf8");
const sandbox = { crypto: globalThis.crypto };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "captcha.js" });
const c = sandbox.YCB.captcha;

function stubCrypto(values) {
  return {
    getRandomValues(target) {
      for (let i = 0; i < target.length; i += 1) target[i] = values[i % values.length];
      return target;
    }
  };
}

test("generates codes of the requested length from the safe alphabet", () => {
  for (const length of [32, 64]) {
    const code = c.generateCode(length);
    assert.equal(code.length, length);
    for (const char of code) assert.ok(c.ALPHABET.includes(char), char);
  }
  assert.equal(c.generateCode(64).length, 64);
  assert.equal(c.generateCode(undefined).length, 32, "defaults to 32");
  assert.equal(c.generateCode(7).length, 32, "only 32 or 64 are allowed");
  assert.equal(c.generateCode(64).includes("I"), false);
  assert.equal(c.generateCode(64).includes("O"), false);
  assert.equal(c.generateCode(64).includes("0"), false);
  assert.equal(c.generateCode(64).includes("1"), false);
});

test("is unbiased and deterministic for a fixed byte source", () => {
  const code = c.generateCode(32, stubCrypto([0, 1, 31, 32, 255, 254]));
  assert.equal(code, "AB9A98".repeat(5) + "AB");
});

test("generates distinct codes", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(c.generateCode(32));
  assert.equal(seen.size, 200);
});

test("normalises answers: case, spaces and punctuation are ignored", () => {
  assert.equal(c.normalizeAnswer("ab c-d!e"), "ABCDE");
  assert.equal(c.normalizeAnswer(null), "");
  assert.equal(c.normalizeAnswer(undefined), "");
  assert.equal(c.normalizeAnswer("A B\tC\nD"), "ABCD");
});

test("verifies answers", () => {
  const code = "ABCD2345";
  assert.equal(c.verifyAnswer(code, "abcd2345"), true);
  assert.equal(c.verifyAnswer(code, "ABCD 2345"), true);
  assert.equal(c.verifyAnswer(code, "ABCD 234-5"), true);
  assert.equal(c.verifyAnswer(code, "ABCD2346"), false);
  assert.equal(c.verifyAnswer(code, "ABCD234"), false, "length mismatch");
  assert.equal(c.verifyAnswer(code, ""), false);
  assert.equal(c.verifyAnswer("", ""), false);
});

test("groups characters for display", () => {
  assert.equal(c.formatGroups("ABCDEFGHIJ"), "ABCDEFGH IJ");
  assert.equal(c.formatGroups("ABCDEFGH", 4), "ABCD EFGH");
  assert.equal(c.formatGroups(""), "");
});

test("pickLength only accepts 32 or 64", () => {
  assert.equal(c.pickLength(64), 64);
  assert.equal(c.pickLength("64"), 64);
  assert.equal(c.pickLength(32), 32);
  assert.equal(c.pickLength("nonsense"), 32);
});
