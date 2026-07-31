// Self-proving tests for parseBilibili (lib/subtitle-parse.ts).
// Pins: seconds->ms conversion, trim, empty-content filtering, missing
// `from` defaulting to 0, and toSentence's `to<=from` -> audioEndMs=undefined
// rule (shared with parseJson3/parseSrt/parseVtt).
import test from "node:test";
import assert from "node:assert/strict";
import { parseBilibili } from "./subtitle-parse";

test("parseBilibili: converts seconds to ms, trims text, filters empty content, defaults missing from to 0", () => {
  const fixture = {
    body: [
      { from: 1.5, to: 3.0, content: " hi " },
      { from: 3, to: 3, content: "" }, // empty content after nothing to trim -> filtered
      { content: "x" }, // missing from/to -> from=0, to=0 -> to<=from -> audioEndMs undefined
    ],
  };
  const result = parseBilibili(fixture);
  assert.deepEqual(result, [
    { text: "hi", audioStartMs: 1500, audioEndMs: 3000 },
    { text: "x", audioStartMs: 0, audioEndMs: undefined },
  ]);
});

test("parseBilibili: to<=from yields audioEndMs undefined (toSentence rule)", () => {
  const result = parseBilibili({ body: [{ from: 5, to: 5, content: "same" }] });
  assert.deepEqual(result, [{ text: "same", audioStartMs: 5000, audioEndMs: undefined }]);
  const resultLess = parseBilibili({ body: [{ from: 5, to: 4, content: "less" }] });
  assert.deepEqual(resultLess, [{ text: "less", audioStartMs: 5000, audioEndMs: undefined }]);
});

test("parseBilibili: non-array body returns []", () => {
  assert.deepEqual(parseBilibili({ body: "not-an-array" }), []);
  assert.deepEqual(parseBilibili({}), []);
  assert.deepEqual(parseBilibili(null), []);
  assert.deepEqual(parseBilibili(undefined), []);
});

test("parseBilibili: whitespace-only content is filtered (trim then length check)", () => {
  assert.deepEqual(parseBilibili({ body: [{ from: 0, to: 1, content: "   " }] }), []);
});
