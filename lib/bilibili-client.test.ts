// Self-proving tests for pure client-safe Bilibili helpers (lib/bilibili-client.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { extractBvid, isBilibiliLink } from "./bilibili-client";

test("extractBvid: canonical URL matches the BV token, b23/youtube/empty return null", () => {
  assert.equal(extractBvid("https://www.bilibili.com/video/BV1xxxxxxxxx"), "BV1xxxxxxxxx");
  assert.equal(extractBvid("https://b23.tv/abcd1234"), null);
  assert.equal(extractBvid("https://www.youtube.com/watch?v=abc123"), null);
  assert.equal(extractBvid(""), null);
});

test("isBilibiliLink: true for b23.tv, bilibili.com/watch, and canonical BV URLs; false for youtube/random", () => {
  assert.equal(isBilibiliLink("https://b23.tv/abcd1234"), true);
  assert.equal(isBilibiliLink("https://www.bilibili.com/watch?bvid=BV1xxxxxxxxx"), true);
  assert.equal(isBilibiliLink("https://www.bilibili.com/video/BV1xxxxxxxxx"), true);
  assert.equal(isBilibiliLink("https://www.youtube.com/watch?v=abc123"), false);
  assert.equal(isBilibiliLink("https://example.com/nope"), false);
});

test("isBilibiliLink proves its own necessity: b23.tv has no BV token (extractBvid null) yet is still a Bilibili link", () => {
  const b23Url = "https://b23.tv/abcd1234";
  assert.equal(extractBvid(b23Url), null);
  assert.equal(isBilibiliLink(b23Url), true);
});
