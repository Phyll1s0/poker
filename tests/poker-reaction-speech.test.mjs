import assert from "node:assert/strict";
import test from "node:test";
import { renderMultiplayerReactionVoice } from "../lib/multiplayer-reaction-voice.ts";
import { playPokerReactionSound, setPokerAudioEnabled, stopPokerReactionVoice } from "../lib/poker-audio.ts";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("wordless playback replaces pending emotes, respects mute/visibility/expiry and never touches TTS", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNow = Date.now;
  const started = [];
  let stopCount = 0;
  let now = 10000;
  const param = () => ({ value: 0, cancelScheduledValues() {}, setTargetAtTime() {} });
  class FakeAudioContext {
    state = "running";
    currentTime = 0;
    destination = {};
    createGain() { return { gain: param(), connect() {} }; }
    createDynamicsCompressor() {
      return { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect() {} };
    }
    createBuffer(channels, length, sampleRate) {
      return { channels, sampleRate, data: new Float32Array(length), copyToChannel(data) { this.data.set(data); } };
    }
    createBufferSource() {
      return {
        buffer: null, onended: null, connect() {}, disconnect() {},
        start() { started.push(this); }, stop() { stopCount += 1; },
      };
    }
    async resume() {}
  }
  try {
    globalThis.window = {
      AudioContext: FakeAudioContext, setTimeout, clearTimeout,
      get speechSynthesis() { throw new Error("Wordless emotes must never touch speech synthesis"); },
    };
    globalThis.document = { visibilityState: "visible" };
    Date.now = () => now;
    await setPokerAudioEnabled(true);
    playPokerReactionSound("praise", 0, "101");
    playPokerReactionSound("taunt", 0, "102");
    await wait(20);
    assert.equal(started.length, 1);
    assert.deepEqual(started[0].buffer.data, renderMultiplayerReactionVoice("taunt", "102").samples);
    playPokerReactionSound("lucky", 0, "overlap");
    await wait(20);
    assert.equal(started.length, 1, "another clip cannot overlap an active emote");
    started[0].onended();

    now += 2000;
    playPokerReactionSound("praise", 0, "expired", now - 1);
    await wait(20);
    assert.equal(started.length, 1);
    globalThis.document.visibilityState = "hidden";
    playPokerReactionSound("thinking", 0, "hidden");
    await wait(20);
    assert.equal(started.length, 1);
    globalThis.document.visibilityState = "visible";
    playPokerReactionSound("lucky", 0.05, "delayed");
    await setPokerAudioEnabled(false);
    await wait(80);
    assert.equal(started.length, 1, "mute cancels pending clips");

    now += 2000;
    await setPokerAudioEnabled(true);
    playPokerReactionSound("surprised", 0, "104");
    await wait(20);
    assert.equal(started.length, 2);
    await setPokerAudioEnabled(false);
    assert.equal(stopCount, 1, "mute stops the active owned buffer, not unrelated device audio");
  } finally {
    stopPokerReactionVoice();
    Date.now = originalNow;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
