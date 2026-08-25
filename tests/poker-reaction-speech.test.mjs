import assert from "node:assert/strict";
import test from "node:test";

import { multiplayerReactionVoiceLine } from "../lib/multiplayer-reaction-voice.ts";
import {
  playPokerReactionSound,
  setPokerAudioEnabled,
  stopPokerReactionVoice,
} from "../lib/poker-audio.ts";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("reaction speech keeps only the newest pending line and mute cancels owned speech", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalUtterance = globalThis.SpeechSynthesisUtterance;
  const originalNow = Date.now;
  const spoken = [];
  let cancelCount = 0;
  let now = 10_000;

  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.lang = "";
      this.pitch = 1;
      this.rate = 1;
      this.volume = 1;
      this.voice = null;
      this.onend = null;
      this.onerror = null;
    }
  }

  const speechSynthesis = {
    speaking: false,
    pending: false,
    getVoices: () => [],
    speak: (utterance) => spoken.push(utterance),
    cancel: () => { cancelCount += 1; },
  };

  try {
    globalThis.window = {
      speechSynthesis,
      setTimeout,
      clearTimeout,
    };
    globalThis.document = { visibilityState: "visible" };
    globalThis.SpeechSynthesisUtterance = FakeUtterance;
    Date.now = () => now;

    await setPokerAudioEnabled(true);
    playPokerReactionSound("praise", 0, "101");
    playPokerReactionSound("taunt", 0, "102");
    await wait(100);

    assert.equal(spoken.length, 1);
    assert.equal(spoken[0].text, multiplayerReactionVoiceLine("taunt", "102"));
    assert.equal(spoken[0].lang, "zh-CN");
    assert.ok(spoken[0].pitch < 1);
    spoken[0].onend?.();

    now += 2_000;
    playPokerReactionSound("praise", 0, "expired", now - 1);
    await wait(100);
    assert.equal(spoken.length, 1, "a line that expires before its timer fires should stay silent");

    now += 2_000;
    playPokerReactionSound("lucky", 0.2, "103");
    await setPokerAudioEnabled(false);
    await wait(260);
    assert.equal(spoken.length, 1, "muting should clear a delayed line without backfill");

    now += 2_000;
    await setPokerAudioEnabled(true);
    playPokerReactionSound("surprised", 0, "104");
    await wait(100);
    assert.equal(spoken.length, 2);
    await setPokerAudioEnabled(false);
    assert.equal(cancelCount, 1, "muting should cancel the reaction utterance we own");
  } finally {
    stopPokerReactionVoice();
    Date.now = originalNow;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalUtterance === undefined) delete globalThis.SpeechSynthesisUtterance;
    else globalThis.SpeechSynthesisUtterance = originalUtterance;
  }
});
