/*
 * Captcha code generation and answer normalisation.
 *
 * The alphabet is 32 unambiguous characters (no I, O, 0, 1). 32 divides 256,
 * so `byte % 32` is unbiased. Codes are compared case-insensitively and
 * ignore anything that is not a letter or digit, so spaces in the rendered
 * image cause no trouble.
 */
(function (root) {
  "use strict";

  if (root.YCB && root.YCB.captcha) return;

  var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var LENGTHS = [32, 64];

  function pickLength(value) {
    var n = Number(value);
    return n === 64 ? 64 : 32;
  }

  function generateCode(length, cryptoObj) {
    var len = pickLength(length);
    var source = cryptoObj || root.crypto;
    if (!source || typeof source.getRandomValues !== "function") {
      throw new Error("crypto.getRandomValues is unavailable");
    }
    var bytes = new Uint8Array(len);
    source.getRandomValues(bytes);
    var out = "";
    for (var i = 0; i < len; i += 1) {
      out += ALPHABET.charAt(bytes[i] % ALPHABET.length);
    }
    return out;
  }

  function normalizeAnswer(value) {
    return String(value == null ? "" : value)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  function verifyAnswer(code, answer) {
    var expected = normalizeAnswer(code);
    var given = normalizeAnswer(answer);
    if (!expected || !given) return false;
    if (expected.length !== given.length) return false;
    var diff = 0;
    for (var i = 0; i < expected.length; i += 1) {
      diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
    }
    return diff === 0;
  }

  function formatGroups(code, size) {
    var step = size || 8;
    var out = [];
    var value = String(code == null ? "" : code);
    for (var i = 0; i < value.length; i += step) out.push(value.slice(i, i + step));
    return out.join(" ");
  }

  root.YCB = root.YCB || {};
  root.YCB.captcha = {
    ALPHABET: ALPHABET,
    LENGTHS: LENGTHS,
    pickLength: pickLength,
    generateCode: generateCode,
    normalizeAnswer: normalizeAnswer,
    verifyAnswer: verifyAnswer,
    formatGroups: formatGroups
  };
})(globalThis);
