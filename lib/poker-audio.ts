import type { MultiplayerChatReactionTone } from "./multiplayer-chat.ts";
import {
  MULTIPLAYER_REACTION_VOICE_STYLES,
  multiplayerReactionVoiceLine,
} from "./multiplayer-reaction-voice.ts";

export type PokerSound = "check" | "call" | "raise" | "fold" | "deal" | "win";

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let pokerAudioEnabled = true;
let pendingReactionVoiceTimer: number | null = null;
let activeReactionUtterance: SpeechSynthesisUtterance | null = null;
let reactionVoiceWatchdog: number | null = null;
let lastReactionVoiceStartedAt = -Infinity;

const REACTION_VOICE_COOLDOWN_MS = 1_450;
const REACTION_VOICE_WATCHDOG_MS = 4_000;

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
  if (typeof window !== "undefined") window.speechSynthesis?.getVoices();
  return context.state === "running";
}

function clearReactionVoiceWatchdog() {
  if (reactionVoiceWatchdog === null || typeof window === "undefined") return;
  window.clearTimeout(reactionVoiceWatchdog);
  reactionVoiceWatchdog = null;
}

/** Stops only RangeCraft's reaction voice; normal card and chip sounds continue. */
export function stopPokerReactionVoice() {
  if (typeof window === "undefined") return;
  if (pendingReactionVoiceTimer !== null) {
    window.clearTimeout(pendingReactionVoiceTimer);
    pendingReactionVoiceTimer = null;
  }
  clearReactionVoiceWatchdog();
  if (activeReactionUtterance) {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // A browser speech implementation may disappear while a PWA is closing.
    }
  }
  activeReactionUtterance = null;
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

const FEMALE_CHINESE_VOICE_HINT = /(?:ting[- ]?ting|婷婷|xiaoxiao|晓晓|xiaoyi|晓伊|huihui|慧慧|yaoyao|瑶瑶|mei[- ]?jia|美佳|sin[- ]?ji|善怡|female|woman|女声)/i;
const MALE_CHINESE_VOICE_HINT = /(?:yunxi|云希|yunyang|云扬|kangkang|康康|male|man|男声)/i;

function preferredReactionVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  let voices: SpeechSynthesisVoice[];
  try {
    voices = window.speechSynthesis.getVoices();
  } catch {
    return null;
  }
  const chinese = voices.filter((voice) => /^zh(?:-|_)/i.test(voice.lang));
  const simplifiedChinese = chinese.filter((voice) => /^zh(?:-|_)(?:cn|hans)(?:-|_|$)/i.test(voice.lang));
  const namedFemale = chinese.filter((voice) => FEMALE_CHINESE_VOICE_HINT.test(voice.name));
  const namedFemaleSimplified = namedFemale.filter((voice) => simplifiedChinese.includes(voice));
  const localNamedFemaleSimplified = namedFemaleSimplified.filter((voice) => voice.localService);
  const localNamedFemale = namedFemale.filter((voice) => voice.localService);
  const nonMaleChinese = chinese.filter((voice) => !MALE_CHINESE_VOICE_HINT.test(voice.name));
  const nonMaleSimplified = simplifiedChinese.filter((voice) => !MALE_CHINESE_VOICE_HINT.test(voice.name));
  const localNonMaleSimplified = nonMaleSimplified.filter((voice) => voice.localService);
  const localNonMaleChinese = nonMaleChinese.filter((voice) => voice.localService);
  const candidates = localNamedFemaleSimplified.length
    ? localNamedFemaleSimplified
    : namedFemaleSimplified.length
      ? namedFemaleSimplified
      : localNamedFemale.length
        ? localNamedFemale
        : namedFemale.length
          ? namedFemale
          : localNonMaleSimplified.length
            ? localNonMaleSimplified
            : nonMaleSimplified.length
              ? nonMaleSimplified
              : localNonMaleChinese.length
                ? localNonMaleChinese
                : nonMaleChinese;
  if (!candidates.length) return null;
  return candidates[0] ?? null;
}

function schedulePokerReactionVoice(
  reactionTone: MultiplayerChatReactionTone,
  messageId: string,
  delaySeconds: number,
  expiresAt?: number,
) {
  if (typeof window === "undefined" || typeof SpeechSynthesisUtterance === "undefined") return;
  const synthesizer = window.speechSynthesis;
  if (!synthesizer) return;

  // Calls for one poll arrive synchronously. Replacing the pending timer makes
  // only the newest reaction speak while every reaction keeps its short cue.
  if (pendingReactionVoiceTimer !== null) window.clearTimeout(pendingReactionVoiceTimer);
  pendingReactionVoiceTimer = window.setTimeout(() => {
    pendingReactionVoiceTimer = null;
    if (
      !pokerAudioEnabled
      || document.visibilityState === "hidden"
      || (expiresAt !== undefined && Date.now() > expiresAt)
      || activeReactionUtterance
      || synthesizer.speaking
      || synthesizer.pending
      || Date.now() - lastReactionVoiceStartedAt < REACTION_VOICE_COOLDOWN_MS
    ) return;

    const style = MULTIPLAYER_REACTION_VOICE_STYLES[reactionTone];
    let utterance: SpeechSynthesisUtterance;
    try {
      utterance = new SpeechSynthesisUtterance(
        multiplayerReactionVoiceLine(reactionTone, messageId),
      );
    } catch {
      return;
    }
    const voice = preferredReactionVoice();
    utterance.lang = voice?.lang || "zh-CN";
    utterance.pitch = style.pitch;
    utterance.rate = style.rate;
    utterance.volume = style.volume;
    if (voice) utterance.voice = voice;

    const release = () => {
      if (activeReactionUtterance !== utterance) return;
      activeReactionUtterance = null;
      clearReactionVoiceWatchdog();
    };
    utterance.onend = release;
    utterance.onerror = release;
    activeReactionUtterance = utterance;
    try {
      synthesizer.speak(utterance);
      lastReactionVoiceStartedAt = Date.now();
      reactionVoiceWatchdog = window.setTimeout(() => {
        if (activeReactionUtterance !== utterance) return;
        try {
          synthesizer.cancel();
        } catch {
          // Releasing our lock still prevents an unavailable engine from queueing forever.
        }
        release();
      }, REACTION_VOICE_WATCHDOG_MS);
    } catch {
      release();
    }
  }, Math.max(0, delaySeconds * 1_000) + 70);
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

/** A quiet character stinger that also keeps reactions distinct without speech support. */
function vocalSyllable(
  context: AudioContext,
  at: number,
  startFrequency: number,
  endFrequency: number,
  duration: number,
  volume: number,
  vowel: "ah" | "eh" | "oo" = "eh",
) {
  if (!masterGain) return;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  const formants = vowel === "ah"
    ? [[780, 1], [1_220, 0.58]]
    : vowel === "oo"
      ? [[420, 1], [920, 0.48]]
      : [[560, 1], [1_650, 0.42]];
  oscillator.type = "sawtooth";
  oscillator.frequency.setValueAtTime(startFrequency, at);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), at + duration);
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), at + 0.018);
  envelope.gain.setValueAtTime(Math.max(0.001, volume * 0.72), at + duration * 0.58);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(envelope);
  formants.forEach(([frequency, level]) => {
    const filter = context.createBiquadFilter();
    const formantGain = context.createGain();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(frequency, at);
    filter.Q.value = 4.8;
    formantGain.gain.value = level;
    envelope.connect(filter);
    filter.connect(formantGain);
    formantGain.connect(masterGain!);
  });
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
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

/** Characterful table-talk cues with a short Chinese voice when available. */
export function playPokerReactionSound(
  reactionTone: MultiplayerChatReactionTone,
  delaySeconds = 0,
  messageId?: string,
  expiresAt?: number,
) {
  if (!pokerAudioEnabled) return;
  const context = getAudioContext();
  if (context?.state === "running") {
    const at = context.currentTime + Math.max(0, delaySeconds);
    if (reactionTone === "praise") {
      noise(context, at, 0.075, 1_450, 0.065, "bandpass");
      tone(context, at + 0.035, 392, 523, 0.2, 0.085, "sine");
    } else if (reactionTone === "lucky") {
      [0, 1, 2].forEach((index) => chipClick(context, at + index * 0.06, 0.16));
      tone(context, at + 0.16, 659, 988, 0.2, 0.085, "triangle");
    } else if (reactionTone === "frustrated") {
      vocalSyllable(context, at, 235, 190, 0.2, 0.065, "eh");
      tone(context, at + 0.055, 440, 280, 0.22, 0.045, "triangle");
    } else if (reactionTone === "taunt") {
      vocalSyllable(context, at, 260, 315, 0.11, 0.07, "eh");
      vocalSyllable(context, at + 0.13, 285, 235, 0.13, 0.065, "eh");
    } else if (reactionTone === "surprised") {
      noise(context, at, 0.11, 2_100, 0.06, "highpass");
      vocalSyllable(context, at + 0.025, 235, 420, 0.22, 0.065, "ah");
      tone(context, at + 0.12, 380, 780, 0.22, 0.045, "sine");
    } else {
      woodenKnock(context, at, 0.11);
      woodenKnock(context, at + 0.18, 0.09);
      vocalSyllable(context, at + 0.04, 225, 195, 0.22, 0.045, "oo");
    }
  }
  if (messageId) schedulePokerReactionVoice(reactionTone, messageId, delaySeconds, expiresAt);
}
