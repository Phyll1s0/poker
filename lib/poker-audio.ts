import type { MultiplayerChatReactionTone } from "./multiplayer-chat.ts";
import { multiplayerReactionVoiceIndex, renderMultiplayerReactionVoice } from "./multiplayer-reaction-voice.ts";

export type PokerSound = "check" | "call" | "raise" | "fold" | "deal" | "win";

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let pokerAudioEnabled = true;
let pendingReactionVoiceTimer: number | null = null;
let activeReactionVoice: AudioBufferSourceNode | null = null;
let lastReactionVoiceStartedAt = -Infinity;
const reactionBufferCache = new Map<string, AudioBuffer>();
const REACTION_VOICE_COOLDOWN_MS = 900;

export function isPokerAudioEnabled() {
  return pokerAudioEnabled;
}

function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (audioContext && masterGain) return audioContext;

  const AudioContextConstructor = window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;

  audioContext = new AudioContextConstructor();
  masterGain = audioContext.createGain();
  masterGain.gain.value = 0.24;

  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 12;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.18;
  masterGain.connect(compressor);
  compressor.connect(audioContext.destination);
  return audioContext;
}

export async function unlockPokerAudio() {
  const context = getAudioContext();
  if (!context) return false;
  if (context.state === "suspended") await context.resume();
  return context.state === "running";
}

/** Stops only this table's wordless reaction; card and chip sounds continue. */
export function stopPokerReactionVoice() {
  if (typeof window === "undefined") return;
  if (pendingReactionVoiceTimer !== null) {
    window.clearTimeout(pendingReactionVoiceTimer);
    pendingReactionVoiceTimer = null;
  }
  const source = activeReactionVoice;
  activeReactionVoice = null;
  if (source) {
    source.onended = null;
    try { source.stop(); } catch { /* The short clip may already have ended. */ }
    source.disconnect();
  }
  lastReactionVoiceStartedAt = -Infinity;
}

export async function setPokerAudioEnabled(enabled: boolean) {
  pokerAudioEnabled = enabled;
  if (!enabled) stopPokerReactionVoice();
  if (!enabled && !audioContext) return;
  const context = getAudioContext();
  if (!context || !masterGain) return;
  if (enabled && context.state === "suspended") await context.resume();
  masterGain.gain.cancelScheduledValues(context.currentTime);
  masterGain.gain.setTargetAtTime(enabled ? 0.24 : 0.0001, context.currentTime, 0.018);
}

function schedulePokerReactionVoice(
  reactionTone: MultiplayerChatReactionTone,
  messageId: string,
  delaySeconds: number,
  expiresAt?: number,
) {
  if (typeof window === "undefined") return;
  // Keep only the newest pending emote in a polling burst, with no queue of
  // overlapping laughs. Stale, hidden and muted reactions are never backfilled.
  if (pendingReactionVoiceTimer !== null) window.clearTimeout(pendingReactionVoiceTimer);
  pendingReactionVoiceTimer = window.setTimeout(() => {
    pendingReactionVoiceTimer = null;
    if (
      !pokerAudioEnabled
      || (typeof document !== "undefined" && document.visibilityState === "hidden")
      || (expiresAt !== undefined && Date.now() > expiresAt)
      || activeReactionVoice
      || Date.now() - lastReactionVoiceStartedAt < REACTION_VOICE_COOLDOWN_MS
    ) return;
    const context = getAudioContext();
    if (!context || context.state !== "running" || !masterGain) return;
    const key = `${reactionTone}:${multiplayerReactionVoiceIndex(reactionTone, messageId)}`;
    let buffer = reactionBufferCache.get(key);
    if (!buffer) {
      const clip = renderMultiplayerReactionVoice(reactionTone, messageId);
      buffer = context.createBuffer(1, clip.samples.length, clip.sampleRate);
      buffer.copyToChannel(clip.samples, 0);
      reactionBufferCache.set(key, buffer); // Six emotions x three variants, bounded.
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(masterGain);
    const release = () => {
      if (activeReactionVoice === source) activeReactionVoice = null;
      source.disconnect();
    };
    source.onended = release;
    activeReactionVoice = source;
    try {
      source.start();
      lastReactionVoiceStartedAt = Date.now();
    } catch {
      release();
    }
  }, Math.max(0, delaySeconds * 1000));
}

function tone(
  context: AudioContext,
  at: number,
  frequency: number,
  endFrequency: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine",
) {
  if (!masterGain) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, at);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), at + duration);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain);
  gain.connect(masterGain);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
}

function noise(
  context: AudioContext,
  at: number,
  duration: number,
  frequency: number,
  volume: number,
  filterType: BiquadFilterType = "bandpass",
) {
  if (!masterGain) return;
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = filterType;
  filter.frequency.setValueAtTime(frequency, at);
  filter.Q.value = filterType === "bandpass" ? 1.4 : 0.7;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  source.start(at);
  source.stop(at + duration + 0.01);
}

function woodenKnock(context: AudioContext, at: number, volume = 0.78) {
  noise(context, at, 0.055, 620, volume * 0.5, "lowpass");
  tone(context, at, 155, 82, 0.075, volume, "sine");
  tone(context, at, 285, 120, 0.042, volume * 0.35, "triangle");
}

function chipClick(context: AudioContext, at: number, volume = 0.28) {
  // 偏低、偏短的陶土筹码声，避免原来 2.5–3.2 kHz 的尖锐瞬态。
  noise(context, at, 0.05, 1050, volume * 0.09, "lowpass");
  tone(context, at, 1180, 720, 0.07, volume * 0.72, "triangle");
  tone(context, at + 0.01, 1680, 1080, 0.052, volume * 0.22, "sine");
}


export function playPokerSound(sound: PokerSound, delaySeconds = 0) {
  if (!pokerAudioEnabled) return;
  const context = getAudioContext();
  if (!context || context.state !== "running") return;
  const at = context.currentTime + Math.max(0, delaySeconds);

  if (sound === "check") {
    woodenKnock(context, at);
    woodenKnock(context, at + 0.115, 0.58);
  } else if (sound === "call") {
    chipClick(context, at, 0.27);
    chipClick(context, at + 0.07, 0.2);
  } else if (sound === "raise") {
    [0, 0.055, 0.112, 0.175].forEach((offset, index) => chipClick(context, at + offset, 0.3 - index * 0.035));
    tone(context, at, 145, 96, 0.16, 0.12, "sine");
  } else if (sound === "fold") {
    noise(context, at, 0.17, 1250, 0.34, "bandpass");
    noise(context, at + 0.035, 0.1, 2600, 0.16, "highpass");
  } else if (sound === "deal") {
    noise(context, at, 0.105, 1750, 0.27, "bandpass");
    tone(context, at + 0.035, 420, 250, 0.055, 0.11, "triangle");
  } else if (sound === "win") {
    [523, 659, 784].forEach((frequency, index) => tone(context, at + index * 0.09, frequency, frequency * 0.98, 0.22, 0.2, "sine"));
    [0.03, 0.08, 0.14, 0.2].forEach((offset, index) => chipClick(context, at + offset, 0.32 - index * 0.035));
  }
}

/** Original nonverbal cartoon emotes; never read chat text or speak a phrase. */
export function playPokerReactionSound(
  reactionTone: MultiplayerChatReactionTone,
  delaySeconds = 0,
  messageId = "preview",
  expiresAt?: number,
) {
  if (!pokerAudioEnabled) return;
  schedulePokerReactionVoice(reactionTone, messageId, delaySeconds, expiresAt);
}
