#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MULTIPLAYER_CHAT_REACTION_CATALOG } from "../lib/multiplayer-chat.ts";
import { renderMultiplayerReactionVoice } from "../lib/multiplayer-reaction-voice.ts";

// Audition the exact production PCM without requiring a live multiplayer room.
// Generated WAVs are original synthesis, with no microphone or third-party audio.
const destination = process.argv[2];
if (!destination) throw new Error("Usage: node --experimental-strip-types scripts/render-reaction-audio.mjs OUTPUT_DIRECTORY");
await mkdir(destination, { recursive: true });
for (const { tone } of MULTIPLAYER_CHAT_REACTION_CATALOG) {
  const { samples, sampleRate, duration } = renderMultiplayerReactionVoice(tone, "preview");
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  let peak = 0;
  let squareSum = 0;
  samples.forEach((sample, index) => {
    peak = Math.max(peak, Math.abs(sample)); squareSum += sample * sample;
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2);
  });
  const file = resolve(destination, `${tone}.wav`);
  await writeFile(file, wav);
  console.log(JSON.stringify({ tone, duration, peak, rms: Math.sqrt(squareSum / samples.length), file }));
}
