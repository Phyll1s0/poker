import assert from "node:assert/strict";
import test from "node:test";

import { MULTIPLAYER_CHAT_REACTION_CATALOG } from "../lib/multiplayer-chat.ts";
import {
  MULTIPLAYER_REACTION_AUDIO_BATCH_LIMIT,
  MULTIPLAYER_REACTION_AUDIO_FUTURE_TOLERANCE_MS,
  MULTIPLAYER_REACTION_AUDIO_GAP_SECONDS,
  MULTIPLAYER_REACTION_AUDIO_MAX_AGE_MS,
  multiplayerReactionAudioCues,
} from "../lib/multiplayer-reaction-audio.ts";

const now = 2_000_000;

function message(id, overrides = {}) {
  return {
    id: String(id),
    seat: Number(id) % 6,
    handle: `玩家${id}`,
    kind: "reaction",
    content: "👍",
    createdAt: now - 100,
    ...overrides,
  };
}

test("initial hydration and repeated polls never replay reaction history", () => {
  const incoming = [message(1), message(2)];
  assert.deepEqual(multiplayerReactionAudioCues(null, incoming, now), []);
  assert.deepEqual(multiplayerReactionAudioCues("2", incoming, now), []);
});

test("every reaction tone maps to one server-confirmed sound cue", () => {
  MULTIPLAYER_CHAT_REACTION_CATALOG.forEach((reaction, index) => {
    assert.deepEqual(multiplayerReactionAudioCues("0", [message(index + 1, {
      content: reaction.emoji,
    })], now), [{
      messageId: String(index + 1),
      tone: reaction.tone,
      delaySeconds: 0,
      expiresAt: now - 100 + MULTIPLAYER_REACTION_AUDIO_MAX_AGE_MS,
    }]);
  });
});

test("text, unknown, stale and implausibly future reactions remain silent", () => {
  assert.deepEqual(multiplayerReactionAudioCues("0", [
    message(1, { kind: "text", content: "👍" }),
    message(2, { content: "🧨" }),
    message(3, { createdAt: now - MULTIPLAYER_REACTION_AUDIO_MAX_AGE_MS - 1 }),
    message(4, { createdAt: now + MULTIPLAYER_REACTION_AUDIO_FUTURE_TOLERANCE_MS + 1 }),
  ], now), []);
});

test("bursts are decimal-id ordered, deduplicated and limited to the newest gentle sequence", () => {
  const incoming = [
    message(10, { content: "🔥" }),
    message(8, { content: "😂" }),
    message(9, { content: "😅" }),
    message(10, { content: "😮" }),
    message(7, { content: "👍" }),
  ];
  const cues = multiplayerReactionAudioCues("6", incoming, now);

  assert.equal(cues.length, MULTIPLAYER_REACTION_AUDIO_BATCH_LIMIT);
  assert.deepEqual(cues, [
    { messageId: "8", tone: "lucky", delaySeconds: 0, expiresAt: now - 100 + MULTIPLAYER_REACTION_AUDIO_MAX_AGE_MS },
    { messageId: "9", tone: "frustrated", delaySeconds: MULTIPLAYER_REACTION_AUDIO_GAP_SECONDS, expiresAt: now - 100 + MULTIPLAYER_REACTION_AUDIO_MAX_AGE_MS },
    { messageId: "10", tone: "surprised", delaySeconds: MULTIPLAYER_REACTION_AUDIO_GAP_SECONDS * 2, expiresAt: now - 100 + MULTIPLAYER_REACTION_AUDIO_MAX_AGE_MS },
  ]);
});

test("advancing the cursor while muted prevents sounds from being backfilled later", () => {
  const incoming = [message(11, { content: "🤔" })];
  assert.deepEqual(multiplayerReactionAudioCues("10", incoming, now), [
    { messageId: "11", tone: "thinking", delaySeconds: 0, expiresAt: now - 100 + MULTIPLAYER_REACTION_AUDIO_MAX_AGE_MS },
  ]);
  assert.deepEqual(multiplayerReactionAudioCues("11", incoming, now), []);
});
