import assert from "node:assert/strict";
import test from "node:test";
import { MULTIPLAYER_CHAT_REACTION_CATALOG } from "../lib/multiplayer-chat.ts";
import { multiplayerReactionVoiceIndex, renderMultiplayerReactionVoice } from "../lib/multiplayer-reaction-voice.ts";

function rms(samples, start, end, rate) {
  const segment = samples.slice(Math.round(start * rate), Math.round(end * rate));
  return Math.sqrt(segment.reduce((sum, value) => sum + value * value, 0) / segment.length);
}

function pitchAt(samples, start, end, rate) {
  const first = Math.round(start * rate);
  const last = Math.round(end * rate);
  let best = -Infinity;
  let bestLag = 0;
  for (let lag = Math.ceil(rate / 550); lag <= Math.floor(rate / 180); lag += 1) {
    let dot = 0, leftPower = 0, rightPower = 0;
    for (let i = first; i + lag < last; i += 1) {
      dot += samples[i] * samples[i + lag];
      leftPower += samples[i] ** 2; rightPower += samples[i + lag] ** 2;
    }
    const correlation = dot / Math.sqrt(leftPower * rightPower || 1);
    if (correlation > best) { best = correlation; bestLag = lag; }
  }
  return rate / bestLag;
}

test("every emote renders a distinct short, finite, softly bounded wordless clip", () => {
  const signatures = new Set();
  for (const { tone } of MULTIPLAYER_CHAT_REACTION_CATALOG) {
    const { samples, sampleRate, duration } = renderMultiplayerReactionVoice(tone, "preview");
    assert.ok(duration >= 0.3 && duration <= 0.8);
    assert.ok(samples.every(Number.isFinite));
    assert.ok(Math.max(...samples.map(Math.abs)) <= 0.781);
    assert.ok(rms(samples, 0, duration, sampleRate) > 0.1);
    assert.ok(rms(samples, 0, duration, sampleRate) <= 0.221);
    assert.ok(Math.abs(samples[0]) < 0.001 && Math.abs(samples.at(-1)) < 0.001);
    signatures.add(Buffer.from(samples.buffer).toString("base64"));
  }
  assert.equal(signatures.size, MULTIPLAYER_CHAT_REACTION_CATALOG.length);
});

test("happy emote PCM contains two separate falling-pitch ha attacks", () => {
  for (const id of ["1", "2", "3"]) {
    const { samples, sampleRate } = renderMultiplayerReactionVoice("lucky", id);
    assert.ok(rms(samples, 0.05, 0.19, sampleRate) > 0.05);
    assert.ok(rms(samples, 0.25, 0.30, sampleRate) < 0.005);
    assert.ok(rms(samples, 0.37, 0.54, sampleRate) > 0.05);
    for (const offset of [0, 0.32]) {
      const beginning = pitchAt(samples, offset + 0.04, offset + 0.09, sampleRate);
      const ending = pitchAt(samples, offset + 0.15, offset + 0.20, sampleRate);
      assert.ok(beginning > ending * 1.18, `${id}: pitch should fall, ${beginning} -> ${ending}`);
    }
  }
});

test("large message ids deterministically choose bounded voice variants on every device", () => {
  for (const { tone } of MULTIPLAYER_CHAT_REACTION_CATALOG) {
    const hugeId = "900719925474099312345678901234567890";
    assert.deepEqual(renderMultiplayerReactionVoice(tone, hugeId), renderMultiplayerReactionVoice(tone, hugeId));
    const variants = new Set(Array.from({ length: 30 }, (_, i) => multiplayerReactionVoiceIndex(tone, String(i))));
    assert.equal(variants.size, 3);
  }
  assert.throws(() => renderMultiplayerReactionVoice("lucky", "1", 8000), /sample rate/);
});
