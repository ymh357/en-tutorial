// Self-proving tests for the pure onExpired retry state machine
// (nextRetryState, components/listening/media-source.ts). No DOM needed —
// this pins the state transitions independent of the <video> element that
// drives them in createVideoPlayer.
//
// Scope note: the StrictMode `destroyed` guard around this reducer's side
// effects is structural (T6-reviewed) and the retry CONTROL FLOW (fetch URL
// shape, dedup) is covered by the route tests (captions.route.test.ts /
// media.route.test.ts). This file's self-proving boundary is the reducer's
// pure transition table only.
import test from "node:test";
import assert from "node:assert/strict";
import { nextRetryState, type RetryState } from "./media-source";

const initState: RetryState = { retried: false, retrying: false, ready: false };

test("nextRetryState: first error, hasCallback=true -> initiates retry (retried+retrying true, ready reset)", () => {
  const decision = nextRetryState(initState, { type: "error" }, true);
  assert.deepEqual(decision.state, { retried: true, retrying: true, ready: false });
  assert.equal(decision.try, true);
  assert.equal(decision.surface, false);
});

test("nextRetryState: error while a retry is already in-flight (retrying=true) -> inert, state unchanged", () => {
  const state: RetryState = { retried: true, retrying: true, ready: false };
  const decision = nextRetryState(state, { type: "error" }, true);
  assert.deepEqual(decision.state, state);
  assert.equal(decision.try, false);
  assert.equal(decision.surface, false);
});

test("nextRetryState: error after a retry already completed (retried=true, retrying=false) -> surface, no retry", () => {
  const state: RetryState = { retried: true, retrying: false, ready: true };
  const decision = nextRetryState(state, { type: "error" }, true);
  assert.deepEqual(decision.state, state);
  assert.equal(decision.try, false);
  assert.equal(decision.surface, true);
});

test("nextRetryState: error with hasExpiredCallback=false (never retried) -> surface immediately, no retry", () => {
  const decision = nextRetryState(initState, { type: "error" }, false);
  assert.deepEqual(decision.state, initState);
  assert.equal(decision.try, false);
  assert.equal(decision.surface, true);
});

test("nextRetryState: resolved event -> retrying flips false, no try/surface, other fields preserved", () => {
  const state: RetryState = { retried: true, retrying: true, ready: false };
  const decision = nextRetryState(state, { type: "resolved" }, true);
  assert.deepEqual(decision.state, { retried: true, retrying: false, ready: false });
  assert.equal(decision.try, false);
  assert.equal(decision.surface, false);
});

test("nextRetryState: rejected event -> retrying flips false and surfaces the failure", () => {
  const state: RetryState = { retried: true, retrying: true, ready: false };
  const decision = nextRetryState(state, { type: "rejected" }, true);
  assert.deepEqual(decision.state, { retried: true, retrying: false, ready: false });
  assert.equal(decision.try, false);
  assert.equal(decision.surface, true);
});
