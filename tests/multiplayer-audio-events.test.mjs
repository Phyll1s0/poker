import assert from "node:assert/strict";
import test from "node:test";

import {
  MULTIPLAYER_AUDIO_EVENT_MAX_AGE_MS,
  multiplayerAudioTransition,
} from "../lib/multiplayer-audio-events.ts";

const now = 2_000_000;

function frame(overrides = {}) {
  return {
    roomId: "room-a",
    handId: "hand-a",
    actionSeq: 0,
    recentActions: [],
    boardCount: 0,
    hasResult: false,
    ...overrides,
  };
}

function action(seq, kind, occurredAt = now) {
  return { seq, action: kind, occurredAt };
}

test("seeds initial, reconnect and new-hand cursors without replaying sounds", () => {
  const current = frame({ actionSeq: 2, recentActions: [action(1, "call"), action(2, "check")] });
  assert.deepEqual(multiplayerAudioTransition(null, current, now), []);
  assert.deepEqual(multiplayerAudioTransition(current, current, now), []);
  assert.deepEqual(multiplayerAudioTransition(current, { ...current, handId: "hand-b" }, now), []);
  assert.deepEqual(multiplayerAudioTransition(current, { ...current, roomId: "room-b" }, now), []);
});

test("plays every unseen accepted action in sequence and never repeats a poll", () => {
  const previous = frame();
  const next = frame({
    actionSeq: 4,
    recentActions: [
      action(1, "call", now - 400),
      action(2, "check", now - 310),
      action(3, "raise", now - 150),
      action(4, "fold", now - 40),
    ],
  });
  assert.deepEqual(multiplayerAudioTransition(previous, next, now), [
    { sound: "call", delaySeconds: 0 },
    { sound: "check", delaySeconds: 0.12 },
    { sound: "raise", delaySeconds: 0.25 },
    { sound: "fold", delaySeconds: 0.37 },
  ]);
  assert.deepEqual(multiplayerAudioTransition(next, next, now), []);
});

test("uses the accepted-action cursor when overlapping polls repeat journal entries", () => {
  const previous = frame({ actionSeq: 2 });
  const next = frame({
    actionSeq: 4,
    recentActions: [
      action(4, "fold", now - 10),
      action(1, "call", now - 200),
      action(3, "raise", now - 20),
      action(2, "check", now - 100),
    ],
  });

  assert.deepEqual(multiplayerAudioTransition(previous, next, now), [
    { sound: "raise", delaySeconds: 0 },
    { sound: "fold", delaySeconds: 0.12 },
  ]);
});

test("skips stale background actions while still allowing current actions", () => {
  const next = frame({
    actionSeq: 2,
    recentActions: [
      action(1, "raise", now - MULTIPLAYER_AUDIO_EVENT_MAX_AGE_MS - 1),
      action(2, "call", now - 20),
    ],
  });
  assert.deepEqual(multiplayerAudioTransition(frame(), next, now), [
    { sound: "call", delaySeconds: 0 },
  ]);
});

test("matches public-card sounds to the staggered board animation", () => {
  const cues = multiplayerAudioTransition(frame(), frame({ boardCount: 3 }), now);
  assert.deepEqual(cues, [
    { sound: "deal", delaySeconds: 0 },
    { sound: "deal", delaySeconds: 0.3 },
    { sound: "deal", delaySeconds: 0.6 },
  ]);
});

test("lets the final action finish before dealing the next street", () => {
  const cues = multiplayerAudioTransition(frame(), frame({
    actionSeq: 1,
    recentActions: [action(1, "call", now - 10)],
    boardCount: 3,
  }), now);
  assert.deepEqual(cues.map((cue) => ({
    ...cue,
    delaySeconds: Number(cue.delaySeconds.toFixed(2)),
  })), [
    { sound: "call", delaySeconds: 0 },
    { sound: "deal", delaySeconds: 0.28 },
    { sound: "deal", delaySeconds: 0.58 },
    { sound: "deal", delaySeconds: 0.88 },
  ]);
});

test("delays settlement until an all-in runout finishes dealing", () => {
  const cues = multiplayerAudioTransition(frame(), frame({ boardCount: 5, hasResult: true }), now);
  assert.equal(cues.at(-1).sound, "win");
  assert.equal(cues.at(-1).delaySeconds, 1.72);
});

test("lets the accepted action finish before a no-runout settlement cue", () => {
  const next = frame({
    actionSeq: 1,
    recentActions: [action(1, "fold", now - 10)],
    hasResult: true,
  });
  assert.deepEqual(multiplayerAudioTransition(frame(), next, now), [
    { sound: "fold", delaySeconds: 0 },
    { sound: "win", delaySeconds: 0.32 },
  ]);
});
