// Self-proving tests for the pure/mockable helpers in lib/bilibili.ts.
// Each assertion computes its own expected value independently (same
// algorithm, re-derived in-test) rather than hardcoding a magic string, so
// the test proves the module's math, not just "some string equals another
// string I copy-pasted from a run".
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  getMixinKey,
  wbiSign,
  pickEnglishSubtitle,
  resolveBvid,
  MIXIN_KEY_ENC_TABS,
} from "./bilibili";

test("getMixinKey: applies the fixed 64-entry permutation table, output length 32", () => {
  // Real Bilibili img_key/sub_key are 32-char hex each (64 chars combined,
  // matching MIXIN_KEY_ENC_TABS' 64 entries). Derived deterministically here
  // rather than hand-typed, so the fixture length is verifiably correct.
  const imgKey = crypto.createHash("md5").update("img").digest("hex");
  const subKey = crypto.createHash("md5").update("sub").digest("hex");
  const orig = imgKey + subKey;
  assert.equal(orig.length, 64);
  // Independently re-derive via the same published permutation table.
  const expected = MIXIN_KEY_ENC_TABS.map((i) => orig[i]).join("").slice(0, 32);
  const actual = getMixinKey(orig);
  assert.equal(actual.length, 32);
  assert.equal(actual, expected);
});

test("wbiSign: w_rid is 32-char lowercase hex, wts matches stubbed Date.now, params sorted+urlencoded, w_rid exactly reproducible", async () => {
  const imgKey = crypto.createHash("md5").update("img").digest("hex");
  const subKey = crypto.createHash("md5").update("sub").digest("hex");
  const fixedMs = 1785500000 * 1000;
  const originalNow = Date.now;
  Date.now = () => fixedMs;
  let result;
  try {
    result = wbiSign({ bvid: "BV1xxxxxxxxx", cid: "12345" }, imgKey, subKey);
  } finally {
    Date.now = originalNow;
  }

  assert.match(result.w_rid, /^[0-9a-f]{32}$/);
  assert.equal(result.wts, String(Math.floor(fixedMs / 1000)));

  // Independently re-derive the full signature: mixin key, sorted+urlencoded
  // query (including wts), md5(query + mixinKey) -> compare byte-for-byte.
  const mixinKey = getMixinKey(imgKey + subKey);
  const signedForQuery: Record<string, string> = {
    bvid: "BV1xxxxxxxxx",
    cid: "12345",
    wts: String(Math.floor(fixedMs / 1000)),
  };
  const query = Object.keys(signedForQuery)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(signedForQuery[k])}`)
    .join("&");
  const expectedWRid = crypto.createHash("md5").update(query + mixinKey).digest("hex");

  assert.equal(result.w_rid, expectedWRid);
  // Params present and stringified.
  assert.equal(result.bvid, "BV1xxxxxxxxx");
  assert.equal(result.cid, "12345");
});

test("pickEnglishSubtitle: prefers unlocked en-US over locked en-US, falls back to en, returns null when none/only locked", () => {
  assert.deepEqual(
    pickEnglishSubtitle([
      { lan: "en", subtitle_url: "//a" },
      { lan: "en-US", is_lock: true, subtitle_url: "//b" },
      { lan: "en-US", subtitle_url: "//c" },
    ]),
    { lan: "en-US", subtitle_url: "//c" }
  );
  assert.deepEqual(
    pickEnglishSubtitle([
      { lan: "zh", subtitle_url: "//z" },
      { lan: "en", subtitle_url: "//e" },
    ]),
    { lan: "en", subtitle_url: "//e" }
  );
  assert.equal(pickEnglishSubtitle([{ lan: "zh", subtitle_url: "//z" }]), null);
  assert.equal(
    pickEnglishSubtitle([
      { lan: "en-US", is_lock: true, subtitle_url: "//a" },
      { lan: "en", is_lock: true, subtitle_url: "//b" },
    ]),
    null
  );
  assert.equal(pickEnglishSubtitle(null), null);
  assert.equal(pickEnglishSubtitle(undefined), null);
  assert.equal(pickEnglishSubtitle([]), null);
});

test("resolveBvid: canonical URL resolves without any fetch call", async () => {
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    calls++;
    throw new Error("fetch should not be called for a canonical URL");
  }) as typeof fetch;
  try {
    const result = await resolveBvid("https://www.bilibili.com/video/BV1yyyyyyyyy");
    assert.equal(result, "BV1yyyyyyyyy");
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("resolveBvid: b23.tv short link resolves via fetch redirect target (res.url)", async () => {
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    calls++;
    return { url: "https://www.bilibili.com/video/BV1xxxxxxxxx" } as Response;
  }) as typeof fetch;
  try {
    const result = await resolveBvid("https://b23.tv/abcd1234");
    assert.equal(result, "BV1xxxxxxxxx");
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("resolveBvid: non-Bilibili URL returns null without calling fetch", async () => {
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    calls++;
    throw new Error("fetch should not be called for a non-Bilibili URL");
  }) as typeof fetch;
  try {
    const result = await resolveBvid("https://example.com/nope");
    assert.equal(result, null);
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("resolveBvid: b23.tv link where fetch throws resolves to null (graceful)", async () => {
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    calls++;
    throw new Error("network down");
  }) as typeof fetch;
  try {
    const result = await resolveBvid("https://b23.tv/abcd1234");
    assert.equal(result, null);
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
