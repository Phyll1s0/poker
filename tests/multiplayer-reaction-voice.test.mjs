import assert from "node:assert/strict";
import test from "node:test";

import { MULTIPLAYER_CHAT_REACTION_CATALOG } from "../lib/multiplayer-chat.ts";
import {
  MULTIPLAYER_REACTION_VOICE_LINES,
  MULTIPLAYER_REACTION_VOICE_STYLES,
  multiplayerReactionVoiceIndex,
  multiplayerReactionVoiceLine,
} from "../lib/multiplayer-reaction-voice.ts";

test("every reaction has several short original voice lines and a safe delivery style", () => {
  const allLines = [];
  for (const reaction of MULTIPLAYER_CHAT_REACTION_CATALOG) {
    const lines = MULTIPLAYER_REACTION_VOICE_LINES[reaction.tone];
    const style = MULTIPLAYER_REACTION_VOICE_STYLES[reaction.tone];
    assert.ok(lines.length >= 3, `${reaction.tone} should not repeat one fixed phrase`);
    assert.equal(new Set(lines).size, lines.length);
    lines.forEach((line) => {
      assert.ok(Array.from(line).length >= 3 && Array.from(line).length <= 7);
      assert.match(line, /[\p{Script=Han}]/u);
      allLines.push(line);
    });
    assert.ok(style.pitch >= 1.1 && style.pitch <= 1.35);
    assert.ok(style.rate >= 1.2 && style.rate <= 1.35);
    assert.ok(style.volume >= 0.45 && style.volume <= 0.75);
  }
  assert.equal(new Set(allLines).size, allLines.length);
});

test("tone plus server message id selects one deterministic variant without numeric coercion", () => {
  const hugeId = "900719925474099312345678901234567890";
  for (const reaction of MULTIPLAYER_CHAT_REACTION_CATALOG) {
    const first = multiplayerReactionVoiceLine(reaction.tone, hugeId);
    const second = multiplayerReactionVoiceLine(reaction.tone, hugeId);
    assert.equal(first, second);
    assert.ok(MULTIPLAYER_REACTION_VOICE_LINES[reaction.tone].includes(first));
    assert.equal(
      first,
      MULTIPLAYER_REACTION_VOICE_LINES[reaction.tone][
        multiplayerReactionVoiceIndex(reaction.tone, hugeId)
      ],
    );
  }
});

test("different confirmed message ids exercise multiple voice variants", () => {
  for (const reaction of MULTIPLAYER_CHAT_REACTION_CATALOG) {
    const variants = new Set(
      Array.from({ length: 60 }, (_, index) => (
        multiplayerReactionVoiceLine(reaction.tone, String(index + 1))
      )),
    );
    assert.ok(variants.size >= 2, `${reaction.tone} should vary across messages`);
  }
});
